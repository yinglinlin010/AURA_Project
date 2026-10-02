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
} from "../../../contracts/protocol/src/types.js";
import type { ScenarioDefinition, ScenarioStep } from "../../../contracts/scenarios/src/types.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/index.js";
import type { IntelligenceRouter } from "../../../packages/core-runtime/src/intelligence-router.js";
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
}

export interface ScenarioRunResult {
  scenarioId: string;
  startedAt: number;
  finishedAt: number;
  completedSteps: number;
  commandReceipts: CommandReceipt[];
  signalReceipts: ContextIngestReceipt[];
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
}

export class ScenarioRunner {
  private readonly runtime: CoreRuntime;
  private readonly registry: DisplayRegistry;
  private readonly now: () => number;
  private readonly sleep: (durationMs: number) => Promise<void>;
  private readonly timeScale: number;
  private readonly router: IntelligenceRouter | undefined;

  constructor(options: ScenarioRunnerOptions) {
    this.runtime = options.runtime;
    this.registry = options.registry;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? delay;
    this.timeScale = options.timeScale ?? 1;
    this.router = options.router;
    if (!Number.isFinite(this.timeScale) || this.timeScale < 0) {
      throw new Error("INVALID_SCENARIO_TIME_SCALE");
    }
  }

  async run(scenario: ScenarioDefinition, startedAt = this.now()): Promise<ScenarioRunResult> {
    assertScenarioDefinition(scenario);
    const commandReceipts: CommandReceipt[] = [];
    const signalReceipts: ContextIngestReceipt[] = [];
    const connectivityTransitions: ScenarioRunResult["connectivityTransitions"] = [];
    const routingObservations: ScenarioRunResult["routingObservations"] = [];
    const perceptionObservations: ScenarioRunResult["perceptionObservations"] = [];
    const proposalLifecycle: ScenarioRunResult["proposalLifecycle"] = [];
    const safetyObservations: ScenarioRunResult["safetyObservations"] = [];
    const timeline = [...scenario.timeline].sort(
      (left, right) => left.atMs - right.atMs,
    );
    const traceId = `scenario:${scenario.id}`;

    for (const step of timeline) {
      await this.sleepUntil(startedAt + step.atMs * this.timeScale);
      if (step.kind === "signal") {
        const sessionBefore = this.runtime.sessionId;
        const before = step.signal.type === "connectivity.mode" ? this.runtime.getState() : undefined;
        const signal: ContextSignal = {
          signalId: `sim:${scenario.id}:${step.id}`,
          type: step.signal.type,
          value: step.signal.value,
          source: "simulated",
          timestamp: startedAt + step.atMs,
          freshness: "fresh",
          ...(step.signal.confidence === undefined
            ? {}
            : { confidence: step.signal.confidence }),
        };
        signalReceipts.push(this.runtime.ingestSignal(signal, traceId));
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
        commandReceipts.push(
          this.runtime.submitCommand({
            protocolVersion: PROTOCOL_VERSION,
            kind: "command",
            messageId: `sim:${scenario.id}:${step.id}`,
            commandId: `sim:${scenario.id}:${step.id}`,
            sessionId: this.runtime.sessionId,
            traceId,
            sentAt: startedAt + step.atMs,
            sender: { displayId: display.displayId, deviceId: display.deviceId },
            command: step.command,
          }),
        );
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

    return {
      scenarioId: scenario.id,
      startedAt,
      finishedAt: this.now(),
      completedSteps: timeline.length,
      commandReceipts,
      signalReceipts,
      connectivityTransitions,
      routingObservations,
      perceptionObservations,
      proposalLifecycle,
      safetyObservations,
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
