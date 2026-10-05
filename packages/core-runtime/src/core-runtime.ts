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
  AuraDomainEvent,
  ActionProposalRequest,
  AuraCommand,
  AuraDomainEventDraft,
  AuraSharedState,
  CommandEnvelope,
  CommandReceipt,
  ConnectivityMode,
  JourneyState,
  JourneyStop,
  ActiveTask,
  TaskActionRecord,
  TaskCondition,
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
  /** Dedicated, non-persistent competition host only. */
  allowDemoReset?: boolean;
  sessionId?: string;
  registry?: DisplayRegistry;
  now?: () => number;
  eventHistoryLimit?: number;
  /** Restored user Journey, loaded from an explicitly configured local store. */
  initialJourney?: JourneyState;
  /** Synchronous write-through hook; called before a Journey mutation is published. */
  persistJourney?: (journey: JourneyState) => void;
  /** Local write-through hook for compact task lifecycle state. */
  initialTasks?: ActiveTask[];
  persistTasks?: (tasks: ActiveTask[]) => void;
  /** Production recovery checks are injected from authoritative evidence adapters. */
  revalidateTask?: (task: Readonly<ActiveTask>) => TaskResumeRevalidation;
}

export interface TaskResumeRevalidation {
  candidateFresh: boolean;
  capabilityConfirmed: boolean;
  authorizationCurrent: boolean;
  priorActionOutcomeKnown: boolean;
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
  private readonly allowDemoReset: boolean;
  private readonly now: () => number;
  private readonly registry: DisplayRegistry | undefined;
  private readonly persistJourney: ((journey: JourneyState) => void) | undefined;
  private readonly persistTasks: ((tasks: ActiveTask[]) => void) | undefined;
  private readonly revalidateTask: ((task: Readonly<ActiveTask>) => TaskResumeRevalidation) | undefined;
  private readonly commandReceipts = new Map<string, StoredCommandReceipt>();
  private readonly signalReceipts = new Map<
    string,
    { fingerprint: string; receipt: ContextIngestReceipt }
  >();

  constructor(options: CoreRuntimeOptions = {}) {
    this.sessionId = options.sessionId ?? randomUUID();
    this.now = options.now ?? Date.now;
    this.registry = options.registry;
    this.allowDemoReset = options.allowDemoReset === true && !options.persistJourney && !options.persistTasks;
    this.persistJourney = options.persistJourney;
    this.persistTasks = options.persistTasks;
    this.revalidateTask = options.revalidateTask;
    const recoveredTasks = structuredClone(options.initialTasks ?? []).map((task) => {
      const recovered = task.status === "running" || task.status === "interrupted"
        ? {
            ...task,
            status: "interrupted" as const,
            interruptionReason: task.interruptionReason ?? "HOST_RESTART_RECOVERY_REQUIRED",
            pauseReason: task.pauseReason ?? "HOST_RESTART_RECOVERY_REQUIRED",
            ...(task.actionRecords === undefined ? {} : {
              actionRecords: task.actionRecords.map((action) =>
                ["pending", "running", "paused"].includes(action.status)
                  ? { ...action, status: "unknown" as const, reasonCode: "HOST_RESTART_OUTCOME_RECONCILIATION_REQUIRED", updatedAt: Math.max(action.updatedAt, this.now()) }
                  : action,
              ),
            }),
          }
        : task;
      return recovered;
    });
    this.state = {
      ...createInitialState(),
      journey: structuredClone(options.initialJourney ?? { stops: [] }),
      activeTasks: recoveredTasks,
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
    if (recoveredTasks.length > 0) this.persistTasks?.(recoveredTasks);
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
        this.markUnresolvedActionsForSafetyInterrupt(task.taskId, traceId, commandId);
        const interruption: AuraDomainEventDraft = {
          type: "task.interrupted",
          sessionId: this.sessionId,
          traceId,
          commandId,
          occurredAt: this.now(),
          payload: { taskId: task.taskId, reasonCode: safetyOverride.decision.reasonCode },
        };
        // Safety interruption must be reflected in live state even when
        // durable storage is unavailable. On restart, persisted `running`
        // tasks are recovered as interrupted and remain fail-closed.
        this.emitSafetyCriticalTaskEvent(interruption);
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
      proposalId: request.proposalId,
      kind: request.kind,
      summary: request.summary,
      targetRole: request.targetRole,
      priority: request.priority,
      requiresConsent: request.requiresConsent,
      payload: structuredClone(request.payload),
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
    goal?: string;
    conditions?: TaskCondition[];
  }): AbortSignal {
    assertId(input.taskId, "INVALID_TASK_ID");
    assertId(input.traceId, "INVALID_TRACE_ID");
    const existing = this.state.activeTasks.find((task) => task.taskId === input.taskId);
    if (existing) throw new Error(existing.status === "running" ? "TASK_ALREADY_RUNNING" : "TASK_ID_TERMINAL_OR_USED");
    validateTaskGoal(input.goal);
    validateTaskConditions(input.conditions);
    const signal = this.taskCancellations.register(input.taskId);
    try {
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
            version: 1,
            ...(input.goal === undefined ? {} : { goal: input.goal }),
            ...(input.conditions === undefined ? {} : { conditions: structuredClone(input.conditions) }),
          },
        },
      });
    } catch (error) {
      this.taskCancellations.cancel(input.taskId, "TASK_START_NOT_PERSISTED");
      throw error;
    }
    return signal;
  }

  updateTaskProgress(input: {
    taskId: string;
    traceId: string;
    goal?: string;
    conditions?: TaskCondition[];
    currentStep?: string;
    pauseReason?: string;
  }): ActiveTask {
    assertId(input.taskId, "INVALID_TASK_ID");
    assertId(input.traceId, "INVALID_TRACE_ID");
    const prior = this.state.activeTasks.find((candidate) => candidate.taskId === input.taskId);
    if (!prior || prior.status === "completed" || prior.status === "cancelled") throw new Error("TASK_NOT_UPDATABLE");
    validateTaskGoal(input.goal);
    validateTaskConditions(input.conditions);
    validateOptionalTaskText(input.currentStep, "INVALID_TASK_STEP");
    validateOptionalTaskText(input.pauseReason, "INVALID_TASK_PAUSE_REASON");
    const task: ActiveTask = {
      ...prior,
      version: (prior.version ?? 1) + 1,
      ...(input.goal === undefined ? {} : { goal: input.goal }),
      ...(input.conditions === undefined ? {} : { conditions: mergeTaskConditions(prior.conditions ?? [], input.conditions) }),
      ...(input.currentStep === undefined ? {} : { currentStep: input.currentStep }),
      ...(input.pauseReason === undefined ? {} : { pauseReason: input.pauseReason }),
    };
    this.emit({
      type: "task.updated", sessionId: this.sessionId, traceId: input.traceId,
      commandId: null, occurredAt: this.now(), payload: { task },
    });
    return structuredClone(task);
  }

  recordTaskAction(input: {
    taskId: string;
    traceId: string;
    actionId: string;
    idempotencyKey: string;
    status: TaskActionRecord["status"];
    reasonCode?: string;
  }): ActiveTask {
    const prior = this.state.activeTasks.find((candidate) => candidate.taskId === input.taskId);
    if (!prior || prior.status === "completed") throw new Error("TASK_NOT_UPDATABLE");
    for (const [value, reason] of [[input.actionId, "INVALID_ACTION_ID"], [input.idempotencyKey, "INVALID_ACTION_IDEMPOTENCY_KEY"], [input.traceId, "INVALID_TRACE_ID"]] as const) assertId(value, reason);
    validateOptionalTaskText(input.reasonCode, "INVALID_ACTION_REASON");
    const actions = prior.actionRecords ?? [];
    if (actions.length >= 50 && !actions.some((action) => action.idempotencyKey === input.idempotencyKey)) throw new Error("TOO_MANY_TASK_ACTIONS");
    const existing = actions.find((action) => action.idempotencyKey === input.idempotencyKey);
    if (prior.status === "cancelled" && input.status !== "cancelled") throw new Error("TASK_NOT_UPDATABLE");
    if (existing && existing.actionId !== input.actionId) throw new Error("TASK_ACTION_IDEMPOTENCY_KEY_REUSED");
    const actionIdOwner = actions.find((action) => action.actionId === input.actionId);
    if (actionIdOwner && actionIdOwner.idempotencyKey !== input.idempotencyKey) throw new Error("TASK_ACTION_ID_REUSED");
    if (existing && existing.status === input.status && existing.reasonCode === input.reasonCode) return structuredClone(prior);
    const allowedTransitions: Record<TaskActionRecord["status"], TaskActionRecord["status"][]> = {
      pending: ["running", "paused", "succeeded", "failed", "cancelled", "unknown"],
      running: ["paused", "succeeded", "failed", "cancelled", "unknown"],
      paused: ["running", "failed", "cancelled", "unknown"],
      unknown: ["succeeded", "failed", "cancelled"],
      succeeded: [], failed: [], cancelled: [],
    };
    if (existing && !allowedTransitions[existing.status].includes(input.status)) throw new Error("TASK_ACTION_ALREADY_TERMINAL");
    const now = this.now();
    const record: TaskActionRecord = {
      actionId: input.actionId,
      idempotencyKey: input.idempotencyKey,
      status: input.status,
      startedAt: existing?.startedAt ?? now,
      updatedAt: now,
      ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
    };
    const task: ActiveTask = {
      ...prior,
      version: (prior.version ?? 1) + 1,
      actionRecords: existing
        ? actions.map((action) => action.idempotencyKey === input.idempotencyKey ? record : action)
        : [...actions, record],
    };
    this.emit({
      type: "task.updated", sessionId: this.sessionId, traceId: input.traceId,
      commandId: null, occurredAt: now, payload: { task },
    });
    return structuredClone(task);
  }

  completeTask(taskId: string, traceId: string): void {
    const task = this.state.activeTasks.find(
      (candidate) => candidate.taskId === taskId && candidate.status === "running",
    );
    if (!task) return;
    if (task.actionRecords?.some((action) => ["pending", "running", "paused", "unknown"].includes(action.status))) {
      throw new Error("TASK_ACTION_RECONCILIATION_REQUIRED");
    }
    this.emit({
      type: "task.completed",
      sessionId: this.sessionId,
      traceId,
      commandId: null,
      occurredAt: this.now(),
      payload: { taskId },
    });
    this.taskCancellations.complete(taskId);
  }

  cancelTask(taskId: string, traceId: string, reasonCode = "CANCELLED_BY_USER"): void {
    assertId(taskId, "INVALID_TASK_ID");
    assertId(traceId, "INVALID_TRACE_ID");
    const task = this.state.activeTasks.find((candidate) => candidate.taskId === taskId && candidate.status === "running");
    if (!task) return;
    this.emit({
      type: "task.cancelled",
      sessionId: this.sessionId,
      traceId,
      commandId: null,
      occurredAt: this.now(),
      payload: { taskId, reasonCode },
    });
    this.taskCancellations.cancel(taskId, reasonCode);
  }

  /** Resume only after the caller rechecks every recovery boundary. This never runs automatically. */
  resumeTask(input: {
    taskId: string;
    traceId: string;
  }): AbortSignal {
    assertId(input.taskId, "INVALID_TASK_ID");
    assertId(input.traceId, "INVALID_TRACE_ID");
    const task = this.state.activeTasks.find((candidate) => candidate.taskId === input.taskId);
    if (!task || task.status !== "interrupted") throw new Error("TASK_NOT_RESUMABLE");
    if (task.conditions?.some((condition) => condition.classification !== "unknown" && condition.expiresAt !== undefined && condition.expiresAt <= this.now())) {
      throw new Error("TASK_CONDITION_EXPIRED");
    }
    if (task.actionRecords?.some((action) => action.status === "unknown")) throw new Error("TASK_ACTION_RECONCILIATION_REQUIRED");
    const revalidation = this.revalidateTask?.(structuredClone(task));
    if (!revalidation || !revalidation.candidateFresh || !revalidation.capabilityConfirmed ||
        !revalidation.authorizationCurrent || !revalidation.priorActionOutcomeKnown) {
      throw new Error("TASK_RECOVERY_REVALIDATION_REQUIRED");
    }
    const signal = this.taskCancellations.register(input.taskId);
    try {
      this.emit({
        type: "task.resumed",
        sessionId: this.sessionId,
        traceId: input.traceId,
        commandId: null,
        occurredAt: this.now(),
        payload: { taskId: input.taskId },
      });
    } catch (error) {
      this.taskCancellations.cancel(input.taskId, "TASK_RESUME_NOT_PERSISTED");
      throw error;
    }
    return signal;
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
    if (senderRole === "cluster") {
      // Preserve the existing shared-Journey denial reason without granting any consent authority.
      const consent = command.type === "action.consent"
        ? evaluateConsent(this.state, command.payload.proposalId, senderRole, command.payload.decision) : undefined;
      return { status: "REJECTED", reasonCode: consent && !consent.accepted && consent.reasonCode === "JOURNEY_CONSENT_REQUIRES_CENTER"
        ? consent.reasonCode : "CLUSTER_READ_ONLY" };
    }
    if (senderRole === "interactive_window" && (
      command.type !== "action.propose" ||
      command.payload.proposal.kind !== "ADD_TRIP_STOP" ||
      command.payload.proposal.targetRole !== "center" ||
      !command.payload.proposal.requiresConsent
    )) return { status: "REJECTED", reasonCode: "WINDOW_COMMAND_NOT_ALLOWED" };
    switch (command.type) {
      case "demo.reset": {
        if (!this.allowDemoReset || senderRole !== "center") return { status: "REJECTED", reasonCode: "DEMO_RESET_DISABLED" };
        this.emit({ type: "demo.reset", sessionId: this.sessionId, traceId: envelope.traceId, commandId: envelope.commandId, occurredAt: this.now(), payload: { state: createInitialState() } });
        return { status: "RECEIVED", reasonCode: "DEMO_RESET" };
      }
      case "rear.mode.set": {
        if (senderRole !== "rear") return { status: "REJECTED", reasonCode: "REAR_ZONE_AUTHORITY_REQUIRED" };
        if (!["normal", "quiet"].includes(command.payload.mode)) return { status: "REJECTED", reasonCode: "INVALID_REAR_MODE" };
        const mode = command.payload.mode;
        this.emit({ type: "rear.experience.changed", sessionId: this.sessionId, traceId: envelope.traceId, commandId: envelope.commandId, occurredAt: this.now(), payload: {
          experience: { mode, decidedAt: this.now(), traceId: envelope.traceId, reasonCode: mode === "quiet" ? "LOCAL_REAR_QUIET_MODE" : "REAR_RESUME_REQUESTED", source: "scenario-fixture", liveJourney: this.state.connectivity.mode !== "online" ? "unavailable" : mode === "quiet" ? "available_but_held" : "presented" },
          decision: "EXECUTE", actor: "rear", reasonCode: mode === "quiet" ? "LOCAL_REAR_QUIET_MODE" : "REAR_RESUME_REQUESTED",
        } });
        return { status: "RECEIVED", reasonCode: mode === "quiet" ? "LOCAL_REAR_QUIET_MODE" : "REAR_RESUME_REQUESTED" };
      }
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
          // These commands originate from the simulator HMI. Real vehicle
          // sensors must enter through a separately trusted adapter path.
          source: "simulated",
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
          // The Developer Console is a simulated control surface, not a
          // sensor authority. Real load estimates use a trusted adapter.
          source: "simulated",
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
      try {
        this.startTask({
          taskId: `action:${result.proposal.proposalId}`,
          traceId: result.proposal.traceId,
          priority: result.proposal.priority === "secondary" ? "secondary" : "primary",
        });
      } catch {
        // Do not leave a proposal marked executing when its durable task record
        // could not be created. A later approval must be an explicit new flow.
        this.changeProposalStatus(
          result.proposal.proposalId,
          "rejected",
          "TASK_START_NOT_PERSISTED",
          envelope.traceId,
          envelope.commandId,
        );
        return { status: "REJECTED", reasonCode: "TASK_START_NOT_PERSISTED" };
      }
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
      if (load.level === "high" || load.level === "critical") {
        // A Premium Journey consent prompt must yield when driver attention changes.
        for (const proposal of this.state.activeProposals.filter(p => p.status === "awaiting_consent" && p.payload?.competitionScenario === "premium-journey")) {
          const decision = this.evaluateProposal(proposal);
          if (decision.outcome === "DEFER") {
            this.emit({ type: "proposal.policy.decided", sessionId: this.sessionId, traceId, commandId, occurredAt: this.now(), payload: { decision } });
            this.changeProposalStatus(proposal.proposalId, "deferred", decision.reasonCode, traceId, commandId);
          }
        }
      }
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
      // Deferral invalidates the original authorization. Revalidation must
      // return to the driver for a fresh consent decision.
      const decision = this.evaluateProposal(proposal);
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

  /** Trusted server coordinator only; not a client-side authorization bypass. */
  replaceCabinJourney(placeIds: string[], traceId: string): void {
    const stops = placeIds.map(id => [...this.state.journey.stops].reverse().find(stop => stop.placeId === id));
    if (stops.some(stop => !stop)) throw new Error("JOURNEY_STOP_NOT_FOUND");
    const journey = { stops: stops as JourneyStop[] };
    this.persistJourney?.(structuredClone(journey));
    this.emit({type: "journey.stops.replaced", sessionId: this.sessionId, traceId, commandId: null, occurredAt: this.now(), payload: journey});
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
    if (draft.type.startsWith("task.")) {
      const next = reduceState(this.state, draft as AuraDomainEvent);
      // Fail before publishing the lifecycle event if durable recovery state
      // cannot be written. Task mutations therefore remain restart-safe.
      this.persistTasks?.(next.activeTasks);
    }
    this.eventBus.publish(draft);
  }

  private markUnresolvedActionsForSafetyInterrupt(taskId: string, traceId: string, commandId: string | null): void {
    const task = this.state.activeTasks.find((candidate) => candidate.taskId === taskId);
    if (!task || !task.actionRecords?.some((action) => ["pending", "running", "paused"].includes(action.status))) return;
    const occurredAt = this.now();
    const updated: ActiveTask = {
      ...task,
      version: (task.version ?? 1) + 1,
      actionRecords: task.actionRecords.map((action) =>
        ["pending", "running", "paused"].includes(action.status)
          ? { ...action, status: "unknown", reasonCode: "SAFETY_INTERRUPT_OUTCOME_RECONCILIATION_REQUIRED", updatedAt: Math.max(action.updatedAt, occurredAt) }
          : action,
      ),
    };
    const draft: AuraDomainEventDraft = {
      type: "task.updated", sessionId: this.sessionId, traceId, commandId,
      occurredAt, payload: { task: updated },
    };
    // Mark the live ledger as unresolved even if the store is unavailable;
    // restart recovery applies the same conservative transition.
    this.emitSafetyCriticalTaskEvent(draft);
  }

  private emitSafetyCriticalTaskEvent(draft: AuraDomainEventDraft): void {
    const next = reduceState(this.state, draft as AuraDomainEvent);
    try { this.persistTasks?.(next.activeTasks); }
    catch { /* Safety state must still reach the live reducer and HMI. */ }
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

function validateTaskGoal(goal: string | undefined): void {
  if (goal !== undefined && (typeof goal !== "string" || goal.trim().length === 0 || goal.length > 1_000)) {
    throw new Error("INVALID_TASK_GOAL");
  }
}

function validateOptionalTaskText(value: string | undefined, reasonCode: string): void {
  if (value !== undefined && (typeof value !== "string" || value.trim().length === 0 || value.length > 500)) {
    throw new Error(reasonCode);
  }
}

function validateTaskConditions(conditions: TaskCondition[] | undefined): void {
  if (conditions === undefined) return;
  if (!Array.isArray(conditions) || conditions.length > 20) throw new Error("INVALID_TASK_CONDITIONS");
  const keys = new Set<string>();
  for (const condition of conditions) {
    if (!condition || typeof condition.key !== "string" || condition.key.trim().length === 0 || condition.key.length > 128 || keys.has(condition.key) ||
        !["confirmed", "inferred", "unknown"].includes(condition.classification) ||
        (condition.value !== undefined && (typeof condition.value !== "string" || condition.value.length > 500)) ||
        (condition.source !== undefined && !["sensor", "simulated", "api", "derived", "cache"].includes(condition.source)) ||
        (condition.observedAt !== undefined && (!Number.isSafeInteger(condition.observedAt) || condition.observedAt < 0)) ||
        (condition.expiresAt !== undefined && (!Number.isSafeInteger(condition.expiresAt) || condition.expiresAt < 0)) ||
        (condition.classification === "unknown" && condition.value !== undefined)) {
      throw new Error("INVALID_TASK_CONDITION");
    }
    keys.add(condition.key);
  }
}

function mergeTaskConditions(current: TaskCondition[], updates: TaskCondition[]): TaskCondition[] {
  const byKey = new Map(current.map((condition) => [condition.key, condition]));
  for (const condition of updates) byKey.set(condition.key, structuredClone(condition));
  return [...byKey.values()];
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
