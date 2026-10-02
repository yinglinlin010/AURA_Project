import { randomUUID } from "node:crypto";
import {
  assertDisplayRegistry,
  findRegisteredSender,
} from "../../../contracts/protocol/src/registry.js";
import {
  PROTOCOL_VERSION,
  STANDARD_DISPLAY_ROLES,
} from "../../../contracts/protocol/src/types.js";
import type {
  ActionProposal,
  ActionProposalRequest,
  AuraCommand,
  AuraDomainEventDraft,
  AuraSharedState,
  CommandEnvelope,
  CommandReceipt,
  ConnectivityMode,
  JourneyState,
  JourneyStop,
  SignalFreshness,
  SignalSource,
  ContextIngestReceipt,
  ContextSignal,
  DisplayRegistry,
  DisplayRole,
  PolicyDecision,
  PresenceSnapshot,
  ProposalStatus,
  VehicleState,
} from "../../../contracts/protocol/src/types.js";
import {
  createSafetyOverride,
  evaluateActionProposal,
  evaluateConsent,
  reduceState,
  createInitialState,
} from "../../core-domain/src/index.js";
import { EventBus } from "./event-bus.js";
import { TaskCancellationRegistry } from "./task-cancellations.js";

export interface CoreRuntimeOptions {
  sessionId?: string;
  registry?: DisplayRegistry;
  now?: () => number;
  eventHistoryLimit?: number;
  /** Restored user Journey, loaded from an explicitly configured local store. */
  initialJourney?: JourneyState;
  /** Synchronous write-through hook; called before a Journey mutation is published. */
  persistJourney?: (journey: JourneyState) => void;
}

interface StoredCommandReceipt {
  fingerprint: string;
  receipt: CommandReceipt;
}

export interface RuntimeProposalOutcome {
  proposal: ActionProposal;
  decision: PolicyDecision;
}

export class CoreRuntime {
  readonly sessionId: string;
  readonly eventBus: EventBus;
  readonly taskCancellations = new TaskCancellationRegistry();

  private state: AuraSharedState;
  private readonly now: () => number;
  private readonly registry: DisplayRegistry | undefined;
  private readonly persistJourney: ((journey: JourneyState) => void) | undefined;
  private readonly commandReceipts = new Map<string, StoredCommandReceipt>();
  private readonly signalReceipts = new Map<
    string,
    { fingerprint: string; receipt: ContextIngestReceipt }
  >();

  constructor(options: CoreRuntimeOptions = {}) {
    this.sessionId = options.sessionId ?? randomUUID();
    this.now = options.now ?? Date.now;
    this.registry = options.registry;
    this.persistJourney = options.persistJourney;
    this.state = {
      ...createInitialState(),
      journey: structuredClone(options.initialJourney ?? { stops: [] }),
    };
    if (this.registry) assertDisplayRegistry(this.registry);
    this.eventBus = new EventBus({
      sessionId: this.sessionId,
      ...(options.eventHistoryLimit === undefined
        ? {}
        : { historyLimit: options.eventHistoryLimit }),
    });
    this.eventBus.subscribe((event) => {
      this.state = reduceState(this.state, event);
    });
  }

  getState(): AuraSharedState {
    return structuredClone(this.state);
  }

  updateConnectivity(input: {
    mode: ConnectivityMode;
    source: SignalSource;
    evidence: string;
    freshness?: SignalFreshness;
    traceId: string;
    commandId?: string | null;
  }): void {
    assertId(input.traceId, "INVALID_TRACE_ID");
    if (!("online degraded offline".split(" ").includes(input.mode))) throw new Error("INVALID_CONNECTIVITY_MODE");
    if (!("sensor simulated api derived cache".split(" ").includes(input.source))) throw new Error("INVALID_CONNECTIVITY_SOURCE");
    if (typeof input.evidence !== "string" || !input.evidence.trim() || input.evidence.length > 128) throw new Error("INVALID_CONNECTIVITY_EVIDENCE");
    const freshness = input.freshness ?? "fresh";
    if (!("fresh cached stale unknown".split(" ").includes(freshness))) throw new Error("INVALID_CONNECTIVITY_FRESHNESS");
    const observedAt = this.now();
    this.emit({
      type: "connectivity.state.changed",
      sessionId: this.sessionId,
      traceId: input.traceId,
      commandId: input.commandId ?? null,
      occurredAt: observedAt,
      payload: { mode: input.mode, source: input.source, observedAt, freshness, evidence: input.evidence },
    });
  }

  createSnapshot(displayId?: string, presence: PresenceSnapshot = { state: "IDLE", revision: 0 }) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      stateRevision: this.state.revision,
      sequence: this.eventBus.sequence,
      generatedAt: this.now(),
      ...(displayId === undefined ? {} : { displayId }),
      state: this.getState(),
      presence,
    } as const;
  }

  getDisplayRegistry(): DisplayRegistry | undefined {
    return this.registry ? structuredClone(this.registry) : undefined;
  }

  ingestSignal(
    signal: ContextSignal,
    traceId: string = randomUUID(),
    commandId: string | null = null,
  ): ContextIngestReceipt {
    assertContextSignal(signal);
    assertId(traceId, "INVALID_TRACE_ID");

    const fingerprint = stableStringify(signal);
    const prior = this.signalReceipts.get(signal.signalId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error("SIGNAL_ID_REUSED");
      return prior.receipt;
    }

    this.emit({
      type: "context.signal.received",
      eventId: `context:${this.sessionId}:${signal.signalId}`,
      sessionId: this.sessionId,
      traceId,
      commandId,
      occurredAt: this.now(),
      payload: { signal },
    });

    const safetyOverride = createSafetyOverride(
      signal,
      this.state.activeTasks,
      traceId,
      randomUUID(),
      this.now(),
    );
    let policyDecision: PolicyDecision | undefined;
    if (safetyOverride) {
      policyDecision = safetyOverride.decision;
      this.emit({
        type: "safety.override.activated",
        sessionId: this.sessionId,
        traceId,
        commandId,
        occurredAt: this.now(),
        payload: {
          signal,
          decision: safetyOverride.decision,
          interruptedTaskIds: safetyOverride.interruptedTasks.map((task) => task.taskId),
          warning: safetyOverride.warning,
        },
      });

      for (const task of safetyOverride.interruptedTasks) {
        this.taskCancellations.cancel(task.taskId, safetyOverride.decision.reasonCode);
        this.emit({
          type: "task.interrupted",
          sessionId: this.sessionId,
          traceId,
          commandId,
          occurredAt: this.now(),
          payload: { taskId: task.taskId, reasonCode: safetyOverride.decision.reasonCode },
        });
        if (task.taskId.startsWith("action:")) {
          const proposalId = task.taskId.slice("action:".length);
          const proposal = this.state.activeProposals.find(
            (candidate) => candidate.proposalId === proposalId,
          );
          if (proposal?.status === "executing") {
            this.changeProposalStatus(
              proposalId,
              "interrupted",
              safetyOverride.decision.reasonCode,
              traceId,
              commandId,
            );
          }
        }
      }
    }

    this.applyKnownSignal(signal, traceId, commandId);
    const receipt: ContextIngestReceipt = {
      signalId: signal.signalId,
      traceId,
      stateRevision: this.state.revision,
      sequence: this.eventBus.sequence,
      ...(policyDecision === undefined ? {} : { policyDecision }),
    };
    this.signalReceipts.set(signal.signalId, { fingerprint, receipt });
    return receipt;
  }

  submitCommand(envelope: CommandEnvelope): CommandReceipt {
    const invalidEnvelopeReason = validateEnvelope(envelope, this.sessionId);
    if (invalidEnvelopeReason) {
      return rejectedReceipt(envelope, this.state.revision, invalidEnvelopeReason);
    }

    const fingerprint = stableStringify({
      command: envelope.command,
      sender: envelope.sender,
      sessionId: envelope.sessionId,
      traceId: envelope.traceId,
    });
    const prior = this.commandReceipts.get(envelope.commandId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        return rejectedReceipt(envelope, this.state.revision, "IDEMPOTENCY_KEY_REUSED");
      }
      return { ...prior.receipt, replayed: true };
    }

    const sender = this.registry
      ? findRegisteredSender(this.registry, envelope.sender.displayId, envelope.sender.deviceId)
      : undefined;
    if (!sender) {
      return this.rememberCommand(envelope, fingerprint, "REJECTED", "UNREGISTERED_SENDER");
    }

    let status: CommandReceipt["status"] = "RECEIVED";
    let reasonCode: string | undefined;
    try {
      const outcome = this.processCommand(envelope, sender.role);
      status = outcome.status;
      reasonCode = outcome.reasonCode;
    } catch (error) {
      status = "REJECTED";
      reasonCode = error instanceof Error ? safeReasonCode(error.message) : "COMMAND_REJECTED";
    }

    return this.rememberCommand(envelope, fingerprint, status, reasonCode);
  }

  proposeAction(
    request: ActionProposalRequest,
    requestedByRole: DisplayRole,
    traceId: string,
    commandId: string | null = null,
  ): RuntimeProposalOutcome {
    assertId(request.proposalId, "INVALID_PROPOSAL_ID");
    assertId(traceId, "INVALID_TRACE_ID");
    if ((request.kind as string) === "WARN" || (request.priority as string) === "urgent") {
      throw new Error("GENERIC_PROPOSAL_CANNOT_CLAIM_SAFETY_SUPERVISOR");
    }
    if (request.kind === "ADD_TRIP_STOP" && request.targetRole !== "center") {
      throw new Error("JOURNEY_STOP_MUST_ROUTE_TO_CENTER");
    }
    if (request.kind === "ADD_TRIP_STOP" && !request.requiresConsent) {
      throw new Error("JOURNEY_STOP_REQUIRES_DRIVER_CONSENT");
    }
    if (request.kind === "SHOW_GUIDANCE" && (
      request.targetRole !== "center" ||
      !request.requiresConsent ||
      request.payload.guidanceMode !== "simulator_only" ||
      request.payload.vehicleControlAllowed !== false ||
      request.payload.diagnosisAllowed !== false ||
      request.payload.automaticActionAllowed !== false ||
      request.payload.reality !== "simulated" ||
      (request.payload.source as { kind?: unknown } | undefined)?.kind !== "simulator"
    )) {
      throw new Error("PARKING_GUIDANCE_MUST_BE_SIMULATED_AND_CONSENT_GATED");
    }
    if (request.payload.discoveryMode === "route_preview") {
      const payload = request.payload;
      const allowedKeys = new Set([
        "discoveryMode", "placeLabel", "routeDistanceMeters", "routeDurationSeconds",
        "placeProvider", "placeObservedAt", "placeFreshness", "placeAttribution",
        "provider", "source", "observedAt", "freshness", "attribution", "attributionUrl",
      ]);
      if (
        request.kind !== "SHOW_INFORMATION" || request.targetRole !== "center" || !request.requiresConsent ||
        Object.keys(payload).some((key) => !allowedKeys.has(key)) ||
        typeof payload.placeLabel !== "string" || payload.placeLabel.trim().length === 0 || payload.placeLabel.length > 256 ||
        payload.placeProvider !== "mapbox-search-box" ||
        typeof payload.placeObservedAt !== "number" || !Number.isSafeInteger(payload.placeObservedAt) || payload.placeObservedAt < 0 ||
        payload.placeFreshness !== "fresh" || typeof payload.placeAttribution !== "string" || payload.placeAttribution.trim().length === 0 ||
        payload.provider !== "mapbox-directions-v5" || payload.source !== "api" ||
        typeof payload.observedAt !== "number" || !Number.isSafeInteger(payload.observedAt) || payload.observedAt < 0 || payload.freshness !== "fresh" ||
        typeof payload.routeDistanceMeters !== "number" || !Number.isFinite(payload.routeDistanceMeters) || payload.routeDistanceMeters < 0 ||
        typeof payload.routeDurationSeconds !== "number" || !Number.isFinite(payload.routeDurationSeconds) || payload.routeDurationSeconds < 0 ||
        typeof payload.attribution !== "string" || payload.attribution.trim().length === 0 ||
        typeof payload.attributionUrl !== "string" || payload.attributionUrl.trim().length === 0
      ) {
        throw new Error("TRANSIENT_ROUTE_PREVIEW_PROPOSAL_INVALID");
      }
    }
    if (this.state.activeProposals.some((proposal) => proposal.proposalId === request.proposalId)) {
      throw new Error("PROPOSAL_ID_ALREADY_EXISTS");
    }

    const proposal: ActionProposal = {
      ...structuredClone(request),
      requestedByRole,
      createdAt: this.now(),
      status: "proposed",
      traceId,
    };
    this.emit({
      type: "proposal.created",
      sessionId: this.sessionId,
      traceId,
      commandId,
      occurredAt: this.now(),
      payload: { proposal },
    });

    const decision = this.evaluateProposal(proposal);
    this.emit({
      type: "proposal.policy.decided",
      sessionId: this.sessionId,
      traceId,
      commandId,
      occurredAt: this.now(),
      payload: { decision },
    });
    this.changeProposalStatus(
      proposal.proposalId,
      statusForOutcome(decision),
      decision.reasonCode,
      traceId,
      commandId,
    );

    return {
      proposal: this.state.activeProposals.find(
        (candidate) => candidate.proposalId === request.proposalId,
      ) ?? proposal,
      decision,
    };
  }

  startTask(input: {
    taskId: string;
    traceId: string;
    priority: "primary" | "secondary" | "critical";
  }): AbortSignal {
    assertId(input.taskId, "INVALID_TASK_ID");
    assertId(input.traceId, "INVALID_TRACE_ID");
    const existing = this.state.activeTasks.find(
      (task) => task.taskId === input.taskId && task.status === "running",
    );
    if (existing) throw new Error("TASK_ALREADY_RUNNING");
    const signal = this.taskCancellations.register(input.taskId);
    this.emit({
      type: "task.registered",
      sessionId: this.sessionId,
      traceId: input.traceId,
      commandId: null,
      occurredAt: this.now(),
      payload: {
        task: {
          ...input,
          status: "running",
          startedAt: this.now(),
        },
      },
    });
    return signal;
  }

  completeTask(taskId: string, traceId: string): void {
    const task = this.state.activeTasks.find(
      (candidate) => candidate.taskId === taskId && candidate.status === "running",
    );
    if (!task) return;
    this.taskCancellations.complete(taskId);
    this.emit({
      type: "task.completed",
      sessionId: this.sessionId,
      traceId,
      commandId: null,
      occurredAt: this.now(),
      payload: { taskId },
    });
  }

  setDisplayConnection(
    displayId: string,
    connected: boolean,
    traceId: string,
  ): void {
    assertId(displayId, "INVALID_DISPLAY_ID");
    this.emit({
      type: "display.connection.changed",
      sessionId: this.sessionId,
      traceId,
      commandId: null,
      occurredAt: this.now(),
      payload: { displayId, connected, lastSeenAt: this.now() },
    });
  }

  private processCommand(
    envelope: CommandEnvelope,
    senderRole: DisplayRole,
  ): { status: CommandReceipt["status"]; reasonCode?: string } {
    const command = envelope.command;
    switch (command.type) {
      case "connectivity.mode.report": {
        const signal: ContextSignal<{ mode: ConnectivityMode; evidence: string }> = {
          signalId: `command:${envelope.commandId}`,
          type: "connectivity.mode",
          value: command.payload,
          source: "simulated",
          timestamp: envelope.sentAt,
          freshness: "fresh",
        };
        this.ingestSignal(signal, envelope.traceId, envelope.commandId);
        return { status: "RECEIVED" };
      }
      case "vehicle.telemetry.report": {
        const signal: ContextSignal<Partial<VehicleState>> = {
          signalId: `command:${envelope.commandId}`,
          type: "vehicle.telemetry",
          value: command.payload.vehicle,
          source: "sensor",
          timestamp: envelope.sentAt,
        };
        this.ingestSignal(signal, envelope.traceId, envelope.commandId);
        return { status: "RECEIVED" };
      }
      case "driver.cognitive_load.report": {
        const signal: ContextSignal<{ level: string; confidence?: number }> = {
          signalId: `command:${envelope.commandId}`,
          type: "driver.cognitive_load",
          value: {
            level: command.payload.level,
            ...(command.payload.confidence === undefined
              ? {}
              : { confidence: command.payload.confidence }),
          },
          source: "sensor",
          timestamp: command.payload.timestamp,
          ...(command.payload.confidence === undefined
            ? {}
            : { confidence: command.payload.confidence }),
        };
        this.ingestSignal(signal, envelope.traceId, envelope.commandId);
        return { status: "RECEIVED" };
      }
      case "action.propose":
        return this.handleProposal(command, envelope, senderRole);
      case "action.consent":
        return this.handleConsent(command, envelope, senderRole);
    }
  }

  private handleProposal(
    command: Extract<AuraCommand, { type: "action.propose" }>,
    envelope: CommandEnvelope,
    senderRole: DisplayRole,
  ): { status: CommandReceipt["status"]; reasonCode?: string } {
    try {
      const { decision } = this.proposeAction(
        command.payload.proposal,
        senderRole,
        envelope.traceId,
        envelope.commandId,
      );
      return decision.outcome === "REJECT"
        ? { status: "REJECTED", reasonCode: decision.reasonCode }
        : { status: "RECEIVED", reasonCode: decision.reasonCode };
    } catch (error) {
      return {
        status: "REJECTED",
        reasonCode: error instanceof Error ? safeReasonCode(error.message) : "PROPOSAL_REJECTED",
      };
    }
  }

  private handleConsent(
    command: Extract<AuraCommand, { type: "action.consent" }>,
    envelope: CommandEnvelope,
    responderRole: DisplayRole,
  ): { status: CommandReceipt["status"]; reasonCode?: string } {
    const result = evaluateConsent(
      this.state,
      command.payload.proposalId,
      responderRole,
      command.payload.decision,
    );
    if (!result.accepted) {
      return { status: "REJECTED", reasonCode: result.reasonCode };
    }

    const decision = command.payload.decision === "approve"
      ? this.evaluateProposal(result.proposal, true)
      : undefined;

    // A consented Journey update is not acknowledged until its durable write
    // succeeds. This keeps the consent event and shared state aligned with the
    // restart-visible result.
    if (decision?.outcome === "EXECUTE" && result.proposal.kind === "ADD_TRIP_STOP") {
      this.persistJourneyForProposal(result.proposal);
    }

    this.emit({
      type: "proposal.consent.recorded",
      sessionId: this.sessionId,
      traceId: result.proposal.traceId,
      commandId: envelope.commandId,
      occurredAt: this.now(),
      payload: {
        proposalId: result.proposal.proposalId,
        decision: command.payload.decision,
        responderRole,
      },
    });

    if (decision) {
      this.emit({
        type: "proposal.policy.decided",
        sessionId: this.sessionId,
        traceId: envelope.traceId,
        commandId: envelope.commandId,
        occurredAt: this.now(),
        payload: { decision },
      });
    }

    if (decision && decision.outcome !== "EXECUTE") {
      this.changeProposalStatus(
        result.proposal.proposalId,
        statusForOutcome(decision),
        decision.reasonCode,
        envelope.traceId,
        envelope.commandId,
      );
      return { status: "RECEIVED", reasonCode: decision.reasonCode };
    }

    if (decision?.outcome === "EXECUTE" && result.proposal.kind === "ADD_TRIP_STOP") {
      this.addJourneyStop(result.proposal, envelope.traceId, envelope.commandId);
      return { status: "RECEIVED", reasonCode: "JOURNEY_STOP_ADDED" };
    }

    if (decision?.outcome === "EXECUTE" && result.proposal.payload.discoveryMode === "route_preview") {
      this.changeProposalStatus(
        result.proposal.proposalId,
        "completed",
        "TRANSIENT_ROUTE_PREVIEW_ACKNOWLEDGED_NO_JOURNEY_CHANGE",
        envelope.traceId,
        envelope.commandId,
      );
      return { status: "RECEIVED", reasonCode: "TRANSIENT_ROUTE_PREVIEW_ACKNOWLEDGED_NO_JOURNEY_CHANGE" };
    }

    this.changeProposalStatus(
      result.proposal.proposalId,
      result.status,
      result.reasonCode,
      envelope.traceId,
      envelope.commandId,
    );

    if (result.status === "executing") {
      this.startTask({
        taskId: `action:${result.proposal.proposalId}`,
        traceId: result.proposal.traceId,
        priority: result.proposal.priority === "secondary" ? "secondary" : "primary",
      });
    }
    return { status: "RECEIVED", reasonCode: result.reasonCode };
  }

  private evaluateProposal(proposal: ActionProposal, consentGranted = false): PolicyDecision {
    const allowedRoles = new Set<DisplayRole>(
      this.registry
        ? this.registry.displays.filter((display) => display.enabled).map((display) => display.role)
        : STANDARD_DISPLAY_ROLES,
    );
    return evaluateActionProposal({
      proposal,
      state: this.state,
      allowedRoles,
      decisionId: randomUUID(),
      decidedAt: this.now(),
      consentGranted,
    });
  }

  private applyKnownSignal(
    signal: ContextSignal,
    traceId: string,
    commandId: string | null,
  ): void {
    const vehiclePatch = vehiclePatchFromSignal(signal);
    if (vehiclePatch) {
      this.emit({
        type: "vehicle.state.updated",
        sessionId: this.sessionId,
        traceId,
        commandId,
        occurredAt: this.now(),
        payload: { vehicle: vehiclePatch },
      });
    }

    const load = cognitiveLoadFromSignal(signal);
    if (load) {
      this.emit({
        type: "driver.load.updated",
        sessionId: this.sessionId,
        traceId,
        commandId,
        occurredAt: this.now(),
        payload: load,
      });
      if (load.level === "low" || load.level === "normal") {
        this.releaseDeferredProposals(traceId, commandId);
      }
    }

    if (signal.type === "connectivity.mode") {
      const value = signal.value as { mode: ConnectivityMode; evidence?: string };
      this.updateConnectivity({
        mode: value.mode,
        source: signal.source,
        evidence: value.evidence ?? `SIGNAL:${signal.signalId}`,
        freshness: signal.freshness ?? "fresh",
        traceId,
        commandId,
      });
    }
  }

  private releaseDeferredProposals(traceId: string, commandId: string | null): void {
    const deferred = this.state.activeProposals.filter((proposal) => proposal.status === "deferred");
    for (const prior of deferred) {
      const proposal = { ...prior, status: "proposed" as const };
      const decision = this.evaluateProposal(proposal, prior.consentGranted === true);
      if (decision.outcome === "EXECUTE" && proposal.kind === "ADD_TRIP_STOP") {
        try {
          this.persistJourneyForProposal(proposal);
        } catch {
          this.changeProposalStatus(
            proposal.proposalId,
            "deferred",
            "JOURNEY_PERSISTENCE_FAILED",
            traceId,
            commandId,
          );
          continue;
        }
      }
      this.emit({
        type: "proposal.policy.decided",
        sessionId: this.sessionId,
        traceId,
        commandId,
        occurredAt: this.now(),
        payload: { decision },
      });
      if (decision.outcome === "EXECUTE" && proposal.kind === "ADD_TRIP_STOP") {
        this.addJourneyStop(proposal, traceId, commandId);
      } else {
        const status = statusForOutcome(decision);
        this.changeProposalStatus(
          proposal.proposalId,
          status,
          decision.outcome === "ROUTE" ? "DEFER_RELEASED_DRIVER_LOAD_LOW" : decision.reasonCode,
          traceId,
          commandId,
        );
        if (decision.outcome === "EXECUTE") {
          this.startTask({
            taskId: `action:${proposal.proposalId}`,
            traceId: proposal.traceId,
            priority: proposal.priority === "secondary" ? "secondary" : "primary",
          });
        }
      }
    }
  }

  private addJourneyStop(
    proposal: ActionProposal,
    traceId: string,
    commandId: string | null,
  ): void {
    const stop = journeyStopFromProposal(proposal, this.now());
    this.emit({
      type: "journey.stop.added",
      sessionId: this.sessionId,
      traceId,
      commandId,
      occurredAt: this.now(),
      payload: { stop },
    });
    this.changeProposalStatus(
      proposal.proposalId,
      "completed",
      "JOURNEY_STOP_ADDED",
      traceId,
      commandId,
    );
  }

  private persistJourneyForProposal(proposal: ActionProposal): void {
    if (!this.persistJourney) return;
    const stop = journeyStopFromProposal(proposal, this.now());
    const journey = {
      ...this.state.journey,
      stops: [...this.state.journey.stops.filter((candidate) => candidate.stopId !== stop.stopId), stop],
    };
    this.persistJourney(structuredClone(journey));
  }

  private changeProposalStatus(
    proposalId: string,
    status: ProposalStatus,
    reasonCode: string,
    traceId: string,
    commandId: string | null,
  ): void {
    this.emit({
      type: "proposal.status.changed",
      sessionId: this.sessionId,
      traceId,
      commandId,
      occurredAt: this.now(),
      payload: { proposalId, status, reasonCode },
    });
  }

  private rememberCommand(
    envelope: CommandEnvelope,
    fingerprint: string,
    status: CommandReceipt["status"],
    reasonCode?: string,
  ): CommandReceipt {
    const receipt: CommandReceipt = {
      commandId: envelope.commandId,
      traceId: envelope.traceId,
      status,
      stateRevision: this.state.revision,
      replayed: false,
      ...(reasonCode === undefined ? {} : { reasonCode }),
    };
    this.commandReceipts.set(envelope.commandId, { fingerprint, receipt });
    return receipt;
  }

  private emit(draft: AuraDomainEventDraft): void {
    this.eventBus.publish(draft);
  }
}

export function assertContextSignal(signal: ContextSignal): void {
  if (!signal || typeof signal !== "object") throw new Error("INVALID_CONTEXT_SIGNAL");
  assertId(signal.signalId, "INVALID_SIGNAL_ID");
  assertId(signal.type, "INVALID_SIGNAL_TYPE");
  if (!Number.isInteger(signal.timestamp) || signal.timestamp < 0) {
    throw new Error("INVALID_SIGNAL_TIMESTAMP");
  }
  if (
    signal.confidence !== undefined &&
    (!Number.isFinite(signal.confidence) || signal.confidence < 0 || signal.confidence > 1)
  ) {
    throw new Error("INVALID_SIGNAL_CONFIDENCE");
  }
  if (!(["sensor", "simulated", "api", "derived", "cache"] as unknown[]).includes(signal.source)) {
    throw new Error("INVALID_SIGNAL_SOURCE");
  }
  if (
    signal.freshness !== undefined &&
    !(["fresh", "cached", "stale", "unknown"] as unknown[]).includes(signal.freshness)
  ) {
    throw new Error("INVALID_SIGNAL_FRESHNESS");
  }
  validateKnownSignal(signal);
}

function validateEnvelope(envelope: CommandEnvelope, sessionId: string): string | undefined {
  if (
    !isRecord(envelope) ||
    !isRecord(envelope.sender) ||
    !isRecord(envelope.command) ||
    envelope.protocolVersion !== PROTOCOL_VERSION ||
    envelope.kind !== "command"
  ) {
    return "INVALID_COMMAND_ENVELOPE";
  }
  if (envelope.sessionId !== sessionId) return "SESSION_MISMATCH";
  if (!Number.isFinite(envelope.sentAt) || envelope.sentAt < 0) return "INVALID_SENT_AT";
  try {
    assertId(envelope.commandId, "INVALID_COMMAND_ID");
    assertId(envelope.traceId, "INVALID_TRACE_ID");
    assertId(envelope.sender.deviceId, "INVALID_DEVICE_ID");
    assertId(envelope.sender.displayId, "INVALID_DISPLAY_ID");
  } catch (error) {
    return error instanceof Error ? error.message : "INVALID_COMMAND_ENVELOPE";
  }
  return undefined;
}

function rejectedReceipt(
  envelope: CommandEnvelope,
  stateRevision: number,
  reasonCode: string,
): CommandReceipt {
  return {
    commandId: envelope?.commandId ?? "unknown",
    traceId: envelope?.traceId ?? "unknown",
    status: "REJECTED",
    stateRevision,
    replayed: false,
    reasonCode,
  };
}

function statusForOutcome(decision: PolicyDecision): ProposalStatus {
  switch (decision.outcome) {
    case "DEFER":
      return "deferred";
    case "ROUTE":
      return decision.consentRequired ? "awaiting_consent" : "routed";
    case "EXECUTE":
      return "executing";
    case "ASK":
      return "awaiting_consent";
    case "REJECT":
      return "rejected";
  }
}

function validateKnownSignal(signal: ContextSignal): void {
  switch (signal.type) {
    case "connectivity.mode": {
      if (
        !isRecord(signal.value) ||
        Object.keys(signal.value).some((key) => key !== "mode" && key !== "evidence") ||
        !("online degraded offline".split(" ").includes(String(signal.value.mode)))
      ) {
        throw new Error("INVALID_CONNECTIVITY_MODE");
      }
      if (signal.value.evidence !== undefined && (typeof signal.value.evidence !== "string" || !signal.value.evidence.trim() || signal.value.evidence.length > 128)) {
        throw new Error("INVALID_CONNECTIVITY_EVIDENCE");
      }
      return;
    }
    case "vehicle.telemetry": {
      if (!isRecord(signal.value)) throw new Error("INVALID_VEHICLE_TELEMETRY");
      const entries = Object.entries(signal.value);
      const allowed = new Set(["speedKph", "gear", "steeringAngleDeg", "drivingState"]);
      if (entries.length === 0 || entries.some(([key]) => !allowed.has(key))) {
        throw new Error("INVALID_VEHICLE_TELEMETRY");
      }
      const vehicle = signal.value;
      if (
        (vehicle.speedKph !== undefined &&
          (typeof vehicle.speedKph !== "number" || !Number.isFinite(vehicle.speedKph) || vehicle.speedKph < 0)) ||
        (vehicle.steeringAngleDeg !== undefined &&
          (typeof vehicle.steeringAngleDeg !== "number" || !Number.isFinite(vehicle.steeringAngleDeg))) ||
        (vehicle.gear !== undefined && !isGear(vehicle.gear)) ||
        (vehicle.drivingState !== undefined && !isDrivingState(vehicle.drivingState))
      ) {
        throw new Error("INVALID_VEHICLE_TELEMETRY");
      }
      return;
    }
    case "vehicle.speed_kph":
      if (typeof signal.value !== "number" || !Number.isFinite(signal.value) || signal.value < 0) {
        throw new Error("INVALID_VEHICLE_SPEED");
      }
      return;
    case "vehicle.gear":
      if (!isGear(signal.value)) throw new Error("INVALID_VEHICLE_GEAR");
      return;
    case "vehicle.steering_angle_deg":
      if (typeof signal.value !== "number" || !Number.isFinite(signal.value)) {
        throw new Error("INVALID_STEERING_ANGLE");
      }
      return;
    case "vehicle.driving_state":
      if (!isDrivingState(signal.value)) throw new Error("INVALID_DRIVING_STATE");
      return;
    case "driver.cognitive_load": {
      const value = isRecord(signal.value) ? signal.value : undefined;
      const level = value?.level ?? signal.value;
      const confidence = value?.confidence ?? signal.confidence;
      if (
        level !== "low" &&
        level !== "normal" &&
        level !== "high" &&
        level !== "critical" &&
        level !== "unknown"
      ) {
        throw new Error("INVALID_COGNITIVE_LOAD");
      }
      if (
        confidence !== undefined &&
        (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)
      ) {
        throw new Error("INVALID_COGNITIVE_LOAD_CONFIDENCE");
      }
    }
  }
}

function vehiclePatchFromSignal(signal: ContextSignal): Partial<VehicleState> | undefined {
  switch (signal.type) {
    case "vehicle.telemetry":
      if (!isRecord(signal.value)) return undefined;
      return signal.value as Partial<VehicleState>;
    case "vehicle.speed_kph":
      return typeof signal.value === "number" ? { speedKph: signal.value } : undefined;
    case "vehicle.gear":
      return isGear(signal.value) ? { gear: signal.value } : undefined;
    case "vehicle.steering_angle_deg":
      return typeof signal.value === "number" ? { steeringAngleDeg: signal.value } : undefined;
    case "vehicle.driving_state":
      return isDrivingState(signal.value) ? { drivingState: signal.value } : undefined;
    default:
      return undefined;
  }
}

function cognitiveLoadFromSignal(
  signal: ContextSignal,
): { level: "low" | "normal" | "high" | "critical"; confidence?: number; timestamp: number } | undefined {
  if (signal.type !== "driver.cognitive_load") return undefined;
  const value = isRecord(signal.value) ? signal.value : undefined;
  const level = value?.level ?? signal.value;
  if (level !== "low" && level !== "normal" && level !== "high" && level !== "critical") {
    return undefined;
  }
  const confidence = value?.confidence ?? signal.confidence;
  return {
    level,
    timestamp: signal.timestamp,
    ...(typeof confidence === "number" ? { confidence } : {}),
  };
}

function journeyStopFromProposal(
  proposal: ActionProposal,
  addedAt: number,
): { stopId: string; sourceProposalId: string; label: string; category?: string; placeId?: string; addedAt: number } {
  const payload = proposal.payload;
  const label = firstString(payload, ["label", "name", "title", "placeName"]) ?? proposal.summary;
  const category = firstString(payload, ["category"]);
  const placeId = firstString(payload, ["placeId"]);
  return {
    stopId: proposal.proposalId,
    sourceProposalId: proposal.proposalId,
    label,
    ...(category === undefined ? {} : { category }),
    ...(placeId === undefined ? {} : { placeId }),
    addedAt,
  };
}

function firstString(value: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      const maxLength = key === "placeId" ? 256 : key === "category" ? 128 : 500;
      return candidate.trim().slice(0, maxLength);
    }
  }
  return undefined;
}

function safeReasonCode(value: string): string {
  return /^[A-Z0-9_:-]{1,96}$/.test(value) ? value : "COMMAND_REJECTED";
}

function assertId(value: unknown, reasonCode: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new Error(reasonCode);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGear(value: unknown): value is VehicleState["gear"] {
  return value === "P" || value === "R" || value === "N" || value === "D" || value === "UNKNOWN";
}

function isDrivingState(value: unknown): value is NonNullable<VehicleState["drivingState"]> {
  return value === "parked" || value === "driving" || value === "reversing" || value === "unknown";
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalize(value[key])]),
  );
}
