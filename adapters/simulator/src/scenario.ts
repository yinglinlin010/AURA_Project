import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { default as Ajv, type AnySchema, type ValidateFunction } from "ajv";
import { parse } from "yaml";
import { findEnabledDisplay } from "../../../contracts/protocol/src/registry.js";
import { PROTOCOL_VERSION } from "../../../contracts/protocol/src/types.js";
import type {
  CommandReceipt,
  ContextIngestReceipt,
  ContextSignal,
  DisplayRegistry,
  PolicyDecision,
  SignalFreshness,
} from "../../../contracts/protocol/src/types.js";
import type { ScenarioDefinition, ScenarioExpected, ScenarioMetricName, ScenarioStateFieldExpectation, ScenarioStep, ScenarioVoiceState } from "../../../contracts/scenarios/src/types.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/index.js";
import type { IntelligenceRouter } from "../../../packages/core-runtime/src/intelligence-router.js";
import type { VoiceRuntime, VoiceRuntimeEvent, VoiceRuntimeState } from "../../../packages/core-runtime/src/voice-runtime.js";
import { assessParkingAssistance } from "../../../packages/perception/src/parking-assistance.js";
import { createSimulatedParkingObservation } from "../../perception/parking-context-simulator.js";

export interface ScenarioRunnerOptions {
  runtime: CoreRuntime;
  registry: DisplayRegistry;
  now?: () => number;
  sleep?: (durationMs: number) => Promise<void>;
  /** 1 follows authored timing; 0 replays immediately; values between them accelerate a run. */
  timeScale?: number;
  router?: IntelligenceRouter;
  voice?: VoiceRuntime;
}

export interface ScenarioRunResult {
  scenarioId: string;
  startedAt: number;
  finishedAt: number;
  completedSteps: number;
  commandReceipts: CommandReceipt[];
  decisionObservations: Array<{ stepId: string; decision: PolicyDecision }>;
  signalReceipts: ContextIngestReceipt[];
  signalObservations: Array<{ stepId: string; signalId: string; type: string; freshness: SignalFreshness }>;
  connectivityTransitions: Array<{
    stepId: string;
    from: string;
    to: string;
    source: string;
    freshness: string;
    sessionPreserved: boolean;
    journeyPreserved: boolean;
    proposalStatusesPreserved: boolean;
  }>;
  routingObservations: Array<{
    stepId: string;
    availability: string;
    sessionIdBefore: string;
    sessionIdAfter: string;
    journeyStopIdsBefore: string[];
    journeyStopIdsAfter: string[];
    proposalStatusesBefore: Record<string, { status: string; consentGranted?: boolean }>;
    proposalStatusesAfter: Record<string, { status: string; consentGranted?: boolean }>;
    connectivityBefore: string;
    connectivityAfter: string;
  }>;
  perceptionObservations: Array<{
    stepId: string;
    observation: ReturnType<typeof createSimulatedParkingObservation>;
    assessment: ReturnType<typeof assessParkingAssistance>;
    proposalDecision?: { proposalId: string; outcome: string; reasonCode: string; status: string };
  }>;
  proposalLifecycle: Array<{
    stepId: string;
    currentLoad?: string;
    proposals: Array<{
      proposalId: string;
      kind: string;
      targetRole: string;
      status: string;
      consentGranted?: boolean;
      lastReasonCode?: string;
      provenance?: { reality: string; source: { kind: string; sourceId: string }; freshness: { state: string; ageMs: number | null; maxAgeMs: number } };
    }>;
  }>;
  safetyObservations: Array<{
    stepId: string;
    activeWarning: import("../../../contracts/protocol/src/types.js").SafetyWarningState | null;
  }>;
  voiceEvents: VoiceRuntimeEvent[];
  initialVoiceState: VoiceRuntimeState | null;
  expectationResults: Array<{ path: string; expected: unknown; actual: unknown; passed: true }>;
  voiceStepObservations: Array<{
    stepId: string;
    kind: "voice.start" | "voice.text" | "voice.barge_in" | "voice.stop" | "voice.consent";
    state: string;
    proposalId?: string;
    policyDecision?: { outcome: string; reasonCode: string; consentRequired: boolean };
    consentStatus?: string;
    consentAccepted?: boolean;
    journeyStopIds?: string[];
  }>;
}

export class ScenarioRunner {
  private readonly runtime: CoreRuntime;
  private readonly registry: DisplayRegistry;
  private readonly now: () => number;
  private readonly sleep: (durationMs: number) => Promise<void>;
  private readonly timeScale: number;
  private readonly router: IntelligenceRouter | undefined;
  private readonly voice: VoiceRuntime | undefined;

  constructor(options: ScenarioRunnerOptions) {
    this.runtime = options.runtime;
    this.registry = options.registry;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? delay;
    this.timeScale = options.timeScale ?? 1;
    this.router = options.router;
    this.voice = options.voice;
    if (!Number.isFinite(this.timeScale) || this.timeScale < 0) {
      throw new Error("INVALID_SCENARIO_TIME_SCALE");
    }
  }

  async run(scenario: ScenarioDefinition, startedAt = this.now()): Promise<ScenarioRunResult> {
    assertScenarioDefinition(scenario);
    const initialSharedState = this.runtime.getState();
    const commandReceipts: CommandReceipt[] = [];
    const commandReceiptsByStep = new Map<string, CommandReceipt>();
    const decisionObservations: ScenarioRunResult["decisionObservations"] = [];
    const signalReceipts: ContextIngestReceipt[] = [];
    const signalObservations: ScenarioRunResult["signalObservations"] = [];
    const connectivityTransitions: ScenarioRunResult["connectivityTransitions"] = [];
    const routingObservations: ScenarioRunResult["routingObservations"] = [];
    const perceptionObservations: ScenarioRunResult["perceptionObservations"] = [];
    const proposalLifecycle: ScenarioRunResult["proposalLifecycle"] = [];
    const safetyObservations: ScenarioRunResult["safetyObservations"] = [];
    const voiceEvents: VoiceRuntimeEvent[] = [];
    const voiceStepObservations: ScenarioRunResult["voiceStepObservations"] = [];
    const initialVoiceState = this.voice?.currentState ?? null;
    const proposalAliases = new Map<string, string>();
    const unsubscribeVoice = this.voice?.subscribe((event) => voiceEvents.push(event));
    const timeline = [...scenario.timeline].sort(
      (left, right) => left.atMs - right.atMs,
    );
    const traceId = `scenario:${scenario.id}`;

    try {
      for (const step of timeline) {
      await this.sleepUntil(startedAt + step.atMs * this.timeScale);
      const stepSequenceBefore = this.runtime.eventBus.sequence;
      if (step.kind === "signal") {
        const sessionBefore = this.runtime.sessionId;
        const before = step.signal.type === "connectivity.mode" ? this.runtime.getState() : undefined;
        const signal: ContextSignal = {
          signalId: `sim:${scenario.id}:${step.id}`,
          type: step.signal.type,
          value: step.signal.value,
          source: "simulated",
          timestamp: startedAt + step.atMs,
          ...(step.signal.freshness === undefined ? {} : { freshness: step.signal.freshness }),
          ...(step.signal.confidence === undefined
            ? {}
            : { confidence: step.signal.confidence }),
        };
        signalReceipts.push(this.runtime.ingestSignal(signal, traceId));
        signalObservations.push({ stepId: step.id, signalId: signal.signalId, type: signal.type, freshness: signal.freshness ?? "fresh" });
        if (before) {
          const after = this.runtime.getState();
          const beforeStops = before.journey.stops.map((stop) => stop.stopId);
          const afterStops = after.journey.stops.map((stop) => stop.stopId);
          const beforeStatuses = Object.fromEntries(before.activeProposals.map((proposal) => [proposal.proposalId, { status: proposal.status, ...(proposal.consentGranted === undefined ? {} : { consentGranted: proposal.consentGranted }) }]));
          const afterStatuses = Object.fromEntries(after.activeProposals.map((proposal) => [proposal.proposalId, { status: proposal.status, ...(proposal.consentGranted === undefined ? {} : { consentGranted: proposal.consentGranted }) }]));
          const journeyPreserved = JSON.stringify(beforeStops) === JSON.stringify(afterStops);
          const proposalStatusesPreserved = JSON.stringify(beforeStatuses) === JSON.stringify(afterStatuses);
          const sessionPreserved = sessionBefore === this.runtime.sessionId;
          if (!sessionPreserved || !journeyPreserved || !proposalStatusesPreserved) {
            throw new Error(`CONNECTIVITY_TRANSITION_RESET_GOVERNED_STATE:${step.id}`);
          }
          connectivityTransitions.push({
            stepId: step.id,
            from: before.connectivity.mode,
            to: after.connectivity.mode,
            source: after.connectivity.source,
            freshness: after.connectivity.freshness,
            sessionPreserved,
            journeyPreserved,
            proposalStatusesPreserved,
          });
        }
      } else if (step.kind === "command") {
        const display = findEnabledDisplay(this.registry, step.displayId);
        if (!display) throw new Error(`SCENARIO_DISPLAY_NOT_ENABLED:${step.displayId}`);
        const receipt = this.runtime.submitCommand({
            protocolVersion: PROTOCOL_VERSION,
            kind: "command",
            messageId: `sim:${scenario.id}:${step.id}`,
            commandId: `sim:${scenario.id}:${step.id}`,
            sessionId: this.runtime.sessionId,
            traceId,
            sentAt: startedAt + step.atMs,
            sender: { displayId: display.displayId, deviceId: display.deviceId },
            command: step.command,
          });
        commandReceipts.push(receipt);
        commandReceiptsByStep.set(step.id, receipt);
      } else if (step.kind === "intent") {
        if (!this.router) throw new Error(`SCENARIO_ROUTER_REQUIRED:${step.id}`);
        const sessionIdBefore = this.runtime.sessionId;
        const before = this.runtime.getState();
        const journeyStopIdsBefore = before.journey.stops.map((stop) => stop.stopId);
        const proposalStatusesBefore = Object.fromEntries(
          before.activeProposals.map((proposal) => [proposal.proposalId, {
            status: proposal.status,
            ...(proposal.consentGranted === undefined ? {} : { consentGranted: proposal.consentGranted }),
          }]),
        );
        const result = await this.router.handle({
          requestId: `scenario:${scenario.id}:${step.id}`,
          traceId,
          text: step.text,
          requestedByRole: step.requestedByRole,
        });
        const sessionIdAfter = this.runtime.sessionId;
        const after = this.runtime.getState();
        const journeyStopIdsAfter = after.journey.stops.map((stop) => stop.stopId);
        const proposalStatusesAfter = Object.fromEntries(
          after.activeProposals.map((proposal) => [proposal.proposalId, {
            status: proposal.status,
            ...(proposal.consentGranted === undefined ? {} : { consentGranted: proposal.consentGranted }),
          }]),
        );
        if (step.expectedAvailability && result.availability !== step.expectedAvailability) {
          throw new Error(`SCENARIO_ROUTE_MISMATCH:${step.id}:${result.availability ?? "unknown"}:${step.expectedAvailability}`);
        }
        routingObservations.push({
          stepId: step.id,
          availability: result.availability ?? "unknown",
          sessionIdBefore,
          sessionIdAfter,
          journeyStopIdsBefore,
          journeyStopIdsAfter,
          proposalStatusesBefore,
          proposalStatusesAfter,
          connectivityBefore: before.connectivity.mode,
          connectivityAfter: after.connectivity.mode,
        });
      } else if (step.kind === "voice.start") {
        if (!this.voice) throw new Error(`SCENARIO_VOICE_RUNTIME_REQUIRED:${step.id}`);
        await this.voice.start(`scenario:${scenario.id}:${step.id}`);
        voiceStepObservations.push({ stepId: step.id, kind: step.kind, state: this.voice.currentState });
      } else if (step.kind === "voice.text") {
        if (!this.voice) throw new Error(`SCENARIO_VOICE_RUNTIME_REQUIRED:${step.id}`);
        const voiceTraceId = `scenario:${scenario.id}:${step.id}`;
        const sequenceBefore = this.runtime.eventBus.sequence;
        await this.voice.sendText(step.text, voiceTraceId);
        const proposal = this.runtime.getState().activeProposals.find((candidate) => candidate.traceId === voiceTraceId);
        const decisionEvent = this.runtime.eventBus.eventsAfter(sequenceBefore).find((event) =>
          event.type === "proposal.policy.decided" && event.traceId === voiceTraceId,
        );
        if (step.proposalAlias) {
          if (!proposal) throw new Error(`SCENARIO_VOICE_PROPOSAL_NOT_CREATED:${step.id}`);
          proposalAliases.set(step.proposalAlias, proposal.proposalId);
        }
        voiceStepObservations.push({
          stepId: step.id,
          kind: step.kind,
          state: this.voice.currentState,
          ...(proposal ? { proposalId: proposal.proposalId } : {}),
          ...(decisionEvent?.type === "proposal.policy.decided"
            ? { policyDecision: {
                outcome: decisionEvent.payload.decision.outcome,
                reasonCode: decisionEvent.payload.decision.reasonCode,
                consentRequired: decisionEvent.payload.decision.consentRequired,
              } }
            : {}),
        });
      } else if (step.kind === "voice.barge_in") {
        if (!this.voice) throw new Error(`SCENARIO_VOICE_RUNTIME_REQUIRED:${step.id}`);
        const frame = Buffer.alloc(640);
        for (let offset = 0; offset < frame.length; offset += 2) frame.writeInt16LE(1000, offset);
        await this.voice.sendAudioChunk(frame, "audio/pcm;rate=16000", `scenario:${scenario.id}:${step.id}`);
        voiceStepObservations.push({ stepId: step.id, kind: step.kind, state: this.voice.currentState });
      } else if (step.kind === "voice.stop") {
        if (!this.voice) throw new Error(`SCENARIO_VOICE_RUNTIME_REQUIRED:${step.id}`);
        await this.voice.stop(`scenario:${scenario.id}:${step.id}`, "VOICE_STOP_COMMAND");
        voiceStepObservations.push({ stepId: step.id, kind: step.kind, state: this.voice.currentState });
      } else if (step.kind === "voice.consent") {
        const proposalId = proposalAliases.get(step.proposalAlias);
        if (!proposalId) throw new Error(`SCENARIO_VOICE_PROPOSAL_ALIAS_NOT_FOUND:${step.proposalAlias}`);
        const display = findEnabledDisplay(this.registry, step.displayId);
        if (!display) throw new Error(`SCENARIO_DISPLAY_NOT_ENABLED:${step.displayId}`);
        const commandId = `sim:${scenario.id}:${step.id}`;
        const sequenceBefore = this.runtime.eventBus.sequence;
        const consentReceipt = this.runtime.submitCommand({
          protocolVersion: PROTOCOL_VERSION,
          kind: "command",
          messageId: commandId,
          commandId,
          sessionId: this.runtime.sessionId,
          traceId: `scenario:${scenario.id}:${step.id}`,
          sentAt: startedAt + step.atMs,
          sender: { displayId: display.displayId, deviceId: display.deviceId },
          command: { type: "action.consent", payload: { proposalId, decision: step.decision } },
        });
        commandReceipts.push(consentReceipt);
        commandReceiptsByStep.set(step.id, consentReceipt);
        const consentEvents = this.runtime.eventBus.eventsAfter(sequenceBefore);
        const consentAccepted = consentEvents.some((event) =>
          event.type === "proposal.consent.recorded" &&
          event.commandId === commandId &&
          event.payload.proposalId === proposalId &&
          event.payload.decision === step.decision,
        );
        const consentPolicyEvent = consentEvents.find((event) =>
          event.type === "proposal.policy.decided" && event.commandId === commandId,
        );
        voiceStepObservations.push({
          stepId: step.id,
          kind: step.kind,
          state: this.voice?.currentState ?? "UNAVAILABLE",
          proposalId,
          consentStatus: consentReceipt.status,
          consentAccepted,
          ...(consentPolicyEvent?.type === "proposal.policy.decided"
            ? { policyDecision: {
                outcome: consentPolicyEvent.payload.decision.outcome,
                reasonCode: consentPolicyEvent.payload.decision.reasonCode,
                consentRequired: consentPolicyEvent.payload.decision.consentRequired,
              } }
            : {}),
          journeyStopIds: this.runtime.getState().journey.stops.map((stop) => stop.stopId),
        });
      } else if (step.kind === "perception.parking") {
        const observation = createSimulatedParkingObservation(`scenario:${scenario.id}:${step.id}`, step.cues);
        const assessment = assessParkingAssistance(observation);
        let proposalDecision: ScenarioRunResult["perceptionObservations"][number]["proposalDecision"];
        if (assessment.outcome === "OFFER" && assessment.offer) {
          const result = this.runtime.proposeAction({
            proposalId: step.proposalId,
            kind: "SHOW_GUIDANCE",
            summary: assessment.offer.text,
            targetRole: "center",
            priority: "secondary",
            requiresConsent: true,
            payload: {
              guidanceMode: "simulator_only",
              vehicleControlAllowed: false,
              diagnosisAllowed: false,
              automaticActionAllowed: false,
              reality: observation.reality,
              source: observation.source,
              observedAt: observation.observedAt,
              freshness: observation.freshness,
              confidence: observation.confidence,
              assessmentId: assessment.assessmentId,
              helpLikelihood: assessment.helpLikelihood,
            },
          }, "center", traceId);
          proposalDecision = {
            proposalId: step.proposalId,
            outcome: result.decision.outcome,
            reasonCode: result.decision.reasonCode,
            status: result.proposal.status,
          };
        }
        perceptionObservations.push({
          stepId: step.id,
          observation: structuredClone(observation),
          assessment: structuredClone(assessment),
          ...(proposalDecision ? { proposalDecision } : {}),
        });
      } else {
        this.runtime.startTask({
          ...step.task,
          traceId,
        });
      }
      for (const event of this.runtime.eventBus.eventsAfter(stepSequenceBefore)) {
        if (event.type === "proposal.policy.decided") {
          decisionObservations.push({ stepId: step.id, decision: structuredClone(event.payload.decision) });
        }
      }
      const state = this.runtime.getState();
      proposalLifecycle.push({
        stepId: step.id,
        ...(state.driver.currentLoad === undefined ? {} : { currentLoad: state.driver.currentLoad }),
        proposals: state.activeProposals.map((proposal) => {
          const payload = proposal.payload;
          const source = payload.source as { kind?: unknown; sourceId?: unknown } | undefined;
          const freshness = payload.freshness as { state?: unknown; ageMs?: unknown; maxAgeMs?: unknown } | undefined;
          const reality = payload.reality;
          const provenance = typeof reality === "string" &&
            typeof source?.kind === "string" && typeof source.sourceId === "string" &&
            typeof freshness?.state === "string" &&
            (typeof freshness.ageMs === "number" || freshness.ageMs === null) &&
            typeof freshness.maxAgeMs === "number"
            ? { reality, source: { kind: source.kind, sourceId: source.sourceId }, freshness: { state: freshness.state, ageMs: freshness.ageMs as number | null, maxAgeMs: freshness.maxAgeMs } }
            : undefined;
          return {
            proposalId: proposal.proposalId,
            kind: proposal.kind,
            targetRole: proposal.targetRole,
            status: proposal.status,
            ...(proposal.consentGranted === undefined ? {} : { consentGranted: proposal.consentGranted }),
            ...(proposal.lastReasonCode === undefined ? {} : { lastReasonCode: proposal.lastReasonCode }),
            ...(provenance ? { provenance } : {}),
          };
        }),
      });
      safetyObservations.push({
        stepId: step.id,
        activeWarning: state.activeSafetyWarning ? structuredClone(state.activeSafetyWarning) : null,
      });
      }
    } finally {
      unsubscribeVoice?.();
    }

    const finishedAt = this.now();
    const finalSharedState = this.runtime.getState();
    const expectationResults = assertScenarioExpectations(scenario.expected, {
      initialSharedState,
      finalSharedState,
      commandReceiptsByStep,
      decisionObservations,
      proposalLifecycle,
      proposalAliases,
      registry: this.registry,
      runtime: this.runtime,
      completedSteps: timeline.length,
      signalReceiptCount: signalReceipts.length,
      signalObservations,
      startedAt,
      finishedAt,
      initialVoiceState,
      voiceEvents,
      voiceStepObservations,
    });
    return {
      scenarioId: scenario.id,
      startedAt,
      finishedAt,
      completedSteps: timeline.length,
      commandReceipts,
      decisionObservations,
      signalReceipts,
      signalObservations,
      connectivityTransitions,
      routingObservations,
      perceptionObservations,
      proposalLifecycle,
      safetyObservations,
      voiceEvents,
      initialVoiceState,
      expectationResults,
      voiceStepObservations,
    };
  }

  private async sleepUntil(deadline: number): Promise<void> {
    const remaining = deadline - this.now();
    if (remaining > 0) await this.sleep(remaining);
  }
}

export function loadScenarioFile(path: string): ScenarioDefinition {
  const absolutePath = resolve(path);
  const parsed: unknown = parse(readFileSync(absolutePath, "utf8"));
  assertScenarioDefinition(parsed);
  return parsed;
}

/** Validate an in-memory scenario with the same schema and ID checks as a YAML file. */
export function assertScenarioDefinition(value: unknown): asserts value is ScenarioDefinition {
  const validator = getScenarioValidator();
  if (!validator(value)) {
    const details = validator.errors?.map((error) => `${error.instancePath} ${error.message}`).join("; ");
    throw new Error(`INVALID_SCENARIO:${details ?? "schema validation failed"}`);
  }
  const stepIds = new Set<string>();
  for (const step of (value as ScenarioDefinition).timeline) {
    if (stepIds.has(step.id)) throw new Error(`DUPLICATE_SCENARIO_STEP_ID:${step.id}`);
    stepIds.add(step.id);
  }
}

function assertScenarioExpectations(
  expected: ScenarioExpected | undefined,
  actual: {
    initialSharedState: ReturnType<CoreRuntime["getState"]>;
    finalSharedState: ReturnType<CoreRuntime["getState"]>;
    commandReceiptsByStep: Map<string, CommandReceipt>;
    decisionObservations: ScenarioRunResult["decisionObservations"];
    proposalLifecycle: ScenarioRunResult["proposalLifecycle"];
    proposalAliases: Map<string, string>;
    registry: DisplayRegistry;
    runtime: CoreRuntime;
    completedSteps: number;
    signalReceiptCount: number;
    signalObservations: ScenarioRunResult["signalObservations"];
    startedAt: number;
    finishedAt: number;
    initialVoiceState: VoiceRuntimeState | null;
    voiceEvents: VoiceRuntimeEvent[];
    voiceStepObservations: ScenarioRunResult["voiceStepObservations"];
  },
): ScenarioRunResult["expectationResults"] {
  const results: ScenarioRunResult["expectationResults"] = [];
  const check = (path: string, wanted: unknown, observed: unknown): void => {
    if (JSON.stringify(wanted) !== JSON.stringify(observed)) {
      throw new Error(`SCENARIO_EXPECTATION_FAILED:${path}:expected=${JSON.stringify(wanted)}:actual=${JSON.stringify(observed)}`);
    }
    results.push({ path, expected: wanted, actual: observed, passed: true });
  };
  const readPointer = (root: unknown, path: string): unknown => {
    if (path === "") return root;
    return path.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
      .reduce<unknown>((value, key) => value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, root);
  };
  const checkFields = (prefix: string, state: unknown, fields: ScenarioStateFieldExpectation[]): void => {
    for (const field of fields) check(`${prefix}${field.path}`, field.equals, readPointer(state, field.path));
  };

  if (expected?.initialState) checkFields("initialState", actual.initialSharedState, expected.initialState.fields);
  if (expected?.finalState) checkFields("finalState", actual.finalSharedState, expected.finalState.fields);
  for (const command of expected?.commands ?? []) {
    const receipt = actual.commandReceiptsByStep.get(command.stepId);
    check(`commands.${command.stepId}.status`, command.status, receipt?.status);
    if (command.reasonCode !== undefined) check(`commands.${command.stepId}.reasonCode`, command.reasonCode, receipt?.reasonCode);
  }
  for (const decisionExpected of expected?.decisions ?? []) {
    const decision = actual.decisionObservations.find((item) => item.stepId === decisionExpected.stepId &&
      (!decisionExpected.proposalId || item.decision.proposalId === decisionExpected.proposalId))?.decision;
    check(`decisions.${decisionExpected.stepId}.outcome`, decisionExpected.outcome, decision?.outcome);
    if (decisionExpected.reasonCode !== undefined) check(`decisions.${decisionExpected.stepId}.reasonCode`, decisionExpected.reasonCode, decision?.reasonCode);
    if (decisionExpected.consentRequired !== undefined) check(`decisions.${decisionExpected.stepId}.consentRequired`, decisionExpected.consentRequired, decision?.consentRequired);
  }
  for (const item of expected?.signalFreshness ?? []) {
    check(`signalFreshness.${item.stepId}`, item.state, actual.signalObservations.find((signal) => signal.stepId === item.stepId)?.freshness);
  }
  for (const action of expected?.actions ?? []) {
    const aliasedProposalId = action.proposalAlias ? actual.proposalAliases.get(action.proposalAlias) : undefined;
    if (action.proposalAlias && !aliasedProposalId) {
      throw new Error(`SCENARIO_EXPECTATION_FAILED:actions.${action.stepId}.proposalAlias:unknown_alias=${action.proposalAlias}`);
    }
    const proposalId = action.proposalId ?? aliasedProposalId;
    const proposal = actual.proposalLifecycle.find((item) => item.stepId === action.stepId)?.proposals.find((item) =>
      (!proposalId || item.proposalId === proposalId) && (!action.kind || item.kind === action.kind) && (!action.targetRole || item.targetRole === action.targetRole));
    if (action.proposalId || action.proposalAlias) check(`actions.${action.stepId}.proposalId`, proposalId, proposal?.proposalId);
    if (action.kind !== undefined) check(`actions.${action.stepId}.kind`, action.kind, proposal?.kind);
    if (action.targetRole !== undefined) check(`actions.${action.stepId}.targetRole`, action.targetRole, proposal?.targetRole);
    if (action.status !== undefined) check(`actions.${action.stepId}.status`, action.status, proposal?.status);
  }
  for (const displayExpected of expected?.displays ?? []) {
    const display = findEnabledDisplay(actual.registry, displayExpected.displayId);
    check(`displays.${displayExpected.displayId}.enabled`, true, Boolean(display));
    if (displayExpected.role !== undefined) check(`displays.${displayExpected.displayId}.role`, displayExpected.role, display?.role);
    if (displayExpected.stateFields) checkFields(`displays.${displayExpected.displayId}.state`, actual.runtime.createSnapshot(displayExpected.displayId).state, displayExpected.stateFields);
  }
  const voiceTransitionCount = actual.voiceEvents.filter((event) => event.type === "state").length;
  const metrics: Record<ScenarioMetricName, number> = {
    completedSteps: actual.completedSteps,
    commandReceiptCount: actual.commandReceiptsByStep.size,
    signalReceiptCount: actual.signalReceiptCount,
    policyDecisionCount: actual.decisionObservations.length,
    journeyStopCount: actual.finalSharedState.journey.stops.length,
    voiceTransitionCount,
    stateRevision: actual.finalSharedState.revision,
    durationMs: actual.finishedAt - actual.startedAt,
  };
  for (const metric of expected?.metrics ?? []) {
    const observed = metrics[metric.name];
    if (metric.equals !== undefined) check(`metrics.${metric.name}.equals`, metric.equals, observed);
    if (metric.min !== undefined && observed < metric.min) throw new Error(`SCENARIO_EXPECTATION_FAILED:metrics.${metric.name}.min:expected>=${metric.min}:actual=${observed}`);
    if (metric.min !== undefined) results.push({ path: `metrics.${metric.name}.min`, expected: metric.min, actual: observed, passed: true });
    if (metric.max !== undefined && observed > metric.max) throw new Error(`SCENARIO_EXPECTATION_FAILED:metrics.${metric.name}.max:expected<=${metric.max}:actual=${observed}`);
    if (metric.max !== undefined) results.push({ path: `metrics.${metric.name}.max`, expected: metric.max, actual: observed, passed: true });
  }
  results.push(...assertVoiceExpectations(expected, {
    initialVoiceState: actual.initialVoiceState,
    voiceEvents: actual.voiceEvents,
    voiceStepObservations: actual.voiceStepObservations,
    proposalAliases: actual.proposalAliases,
    journeyStopIds: actual.finalSharedState.journey.stops.map((stop) => stop.stopId),
  }));
  return results;
}

function assertVoiceExpectations(
  expected: ScenarioExpected | undefined,
  actual: {
    initialVoiceState: VoiceRuntimeState | null;
    voiceEvents: VoiceRuntimeEvent[];
    voiceStepObservations: ScenarioRunResult["voiceStepObservations"];
    proposalAliases: Map<string, string>;
    journeyStopIds: string[];
  },
): ScenarioRunResult["expectationResults"] {
  const voiceExpected = expected?.voice;
  if (!voiceExpected) return [];
  const results: ScenarioRunResult["expectationResults"] = [];
  const check = (path: string, wanted: unknown, observed: unknown): void => {
    if (JSON.stringify(wanted) !== JSON.stringify(observed)) {
      const expectedText = JSON.stringify(wanted) ?? "undefined";
      const actualText = JSON.stringify(observed) ?? "undefined";
      throw new Error(`SCENARIO_EXPECTATION_FAILED:${path}:expected=${expectedText}:actual=${actualText}`);
    }
    results.push({ path, expected: wanted, actual: observed, passed: true });
  };

  for (const policyExpected of voiceExpected.policyDecisions ?? []) {
    const observation = actual.voiceStepObservations.find((item) => item.stepId === policyExpected.stepId);
    const decision = observation?.policyDecision;
    check(`voice.policyDecisions.${policyExpected.stepId}.outcome`, policyExpected.outcome, decision?.outcome);
    if (policyExpected.reasonCode !== undefined) {
      check(`voice.policyDecisions.${policyExpected.stepId}.reasonCode`, policyExpected.reasonCode, decision?.reasonCode);
    }
    if (policyExpected.consentRequired !== undefined) {
      check(`voice.policyDecisions.${policyExpected.stepId}.consentRequired`, policyExpected.consentRequired, decision?.consentRequired);
    }
  }

  for (const consentExpected of voiceExpected.consents ?? []) {
    const observation = actual.voiceStepObservations.find((item) => item.stepId === consentExpected.stepId);
    check(`voice.consents.${consentExpected.stepId}.proposalId`, actual.proposalAliases.get(consentExpected.proposalAlias), observation?.proposalId);
    check(`voice.consents.${consentExpected.stepId}.accepted`, consentExpected.accepted, observation?.consentAccepted);
    if (consentExpected.receiptStatus !== undefined) {
      check(`voice.consents.${consentExpected.stepId}.receiptStatus`, consentExpected.receiptStatus, observation?.consentStatus);
    }
  }

  if (voiceExpected.journey) {
    const expectedStopIds = voiceExpected.journey.stopProposalAliases.map((alias) => {
      const proposalId = actual.proposalAliases.get(alias);
      if (!proposalId) throw new Error(`SCENARIO_EXPECTATION_FAILED:voice.journey.stopProposalAliases:unknown_alias=${alias}`);
      return proposalId;
    });
    check("voice.journey.stopCount", voiceExpected.journey.stopCount, actual.journeyStopIds.length);
    check("voice.journey.stopProposalAliases", expectedStopIds, actual.journeyStopIds);
  }

  for (const stateExpected of voiceExpected.statesAtSteps ?? []) {
    const observation = actual.voiceStepObservations.find((item) => item.stepId === stateExpected.stepId);
    check(`voice.statesAtSteps.${stateExpected.stepId}`, stateExpected.state, observation?.state);
  }

  if (voiceExpected.requiredTransitions?.length) {
    const states: ScenarioVoiceState[] = [];
    if (actual.initialVoiceState !== null) states.push(actual.initialVoiceState);
    for (const event of actual.voiceEvents) {
      if (event.type === "state") states.push(event.state);
    }
    const transitions = states.slice(1).map((to, index) => ({ from: states[index]!, to }));
    let cursor = 0;
    for (const required of voiceExpected.requiredTransitions) {
      const foundAt = transitions.findIndex((transition, index) =>
        index >= cursor && transition.from === required.from && transition.to === required.to,
      );
      if (foundAt < 0) {
        throw new Error(`SCENARIO_EXPECTATION_FAILED:voice.requiredTransitions:missing=${required.from}->${required.to}:actual=${JSON.stringify(transitions)}`);
      }
      cursor = foundAt + 1;
      results.push({
        path: `voice.requiredTransitions.${required.from}->${required.to}`,
        expected: required,
        actual: transitions[foundAt],
        passed: true,
      });
    }
  }
  return results;
}

let scenarioValidator: ValidateFunction | undefined;

function getScenarioValidator(): ValidateFunction {
  if (scenarioValidator) return scenarioValidator;
  const protocolPath = resolve(process.cwd(), "contracts/protocol/schemas/protocol.schema.json");
  const scenarioPath = resolve(process.cwd(), "contracts/scenarios/schemas/scenario.schema.json");
  const protocolSchema = JSON.parse(readFileSync(protocolPath, "utf8")) as AnySchema;
  const scenarioSchema = JSON.parse(readFileSync(scenarioPath, "utf8")) as AnySchema;
  const ajv = new Ajv.default({ allErrors: true, strict: false });
  ajv.addSchema(protocolSchema);
  const validator = ajv.compile(scenarioSchema);
  scenarioValidator = validator;
  return validator;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs));
}
