import type {
  SimulatedParkingAction,
  SimulatedParkingCapability,
  SimulatedParkingOutcomeReport,
  SimulatedParkingRequest,
} from "./types.js";

/** Deterministic, in-memory simulation seam. No network, vehicle I/O, actuator
 * commands, inferred safety thresholds, or automatic completion. Authorization
 * represents a fixture supplied by a trusted caller, not proof of real consent.
 * Runtime/Action Gate integration and durable action reconciliation are separate.
 */
export class SimulatedParkingAdapter {
  private readonly now: () => number;
  private capability: SimulatedParkingCapability;
  private readonly actions = new Map<string, SimulatedParkingAction>();
  private readonly reports = new Map<string, { fingerprint: string; action: SimulatedParkingAction }>();

  constructor(options: { now?: () => number; capability?: SimulatedParkingCapability } = {}) {
    this.now = options.now ?? Date.now;
    const now = this.now();
    this.capability = {
      capabilityId: "simulated-parking",
      version: 1,
      availability: "unknown",
      feasibility: "unknown",
      observedAt: now,
      validUntil: now,
      reasonCode: "PARKING_CAPABILITY_UNCONFIRMED",
      source: "simulated",
      reality: "simulated",
    };
    this.setCapability(options.capability ?? this.capability);
  }

  /** Explicit simulator fixture update; feasibility is reported, never guessed. */
  setCapability(capability: SimulatedParkingCapability): void {
    assertId(capability.capabilityId);
    assertVersion(capability.version);
    assertTime(capability.observedAt);
    assertTime(capability.validUntil);
    assertId(capability.reasonCode);
    if (capability.source !== "simulated" || capability.reality !== "simulated" ||
        !["available", "unavailable", "unknown"].includes(capability.availability) ||
        !["feasible", "infeasible", "unknown"].includes(capability.feasibility) ||
        capability.validUntil < capability.observedAt) throw new Error("INVALID_SIMULATED_PARKING_CAPABILITY");
    this.capability = structuredClone(capability);
  }

  readCapability(): SimulatedParkingCapability {
    return structuredClone(this.capability);
  }

  start(request: SimulatedParkingRequest): { action: SimulatedParkingAction; replayed: boolean } {
    this.assertRequest(request);
    const existing = this.actions.get(request.actionId);
    if (existing) {
      this.assertSameAction(existing, request);
      // Replaying a terminal/unknown action never restarts its effect.
      return { action: structuredClone(existing), replayed: true };
    }
    this.assertAuthorized(request);
    if ([...this.actions.values()].some((action) => ["running", "paused", "unknown"].includes(action.status))) {
      throw new Error("PARKING_ACTION_ACTIVE_OR_UNRECONCILED");
    }
    const now = this.now();
    const action: SimulatedParkingAction = {
      actionId: request.actionId,
      taskId: request.taskId,
      proposalId: request.proposalId,
      planVersion: request.planVersion,
      capabilityVersion: this.capability.version,
      status: "running",
      startedAt: now,
      updatedAt: now,
      reasonCode: "SIMULATED_PARKING_STARTED",
      source: "simulated",
      reality: "simulated",
      vehicleControlAllowed: false,
    };
    this.actions.set(action.actionId, action);
    return { action: structuredClone(action), replayed: false };
  }

  pause(actionId: string, reasonCode = "SIMULATED_PARKING_PAUSED"): SimulatedParkingAction {
    const action = this.requireAction(actionId);
    if (action.status === "paused") return structuredClone(action);
    if (action.status !== "running") throw new Error("PARKING_ACTION_NOT_RUNNING");
    return this.transition(action, "paused", reasonCode);
  }

  resume(request: SimulatedParkingRequest): SimulatedParkingAction {
    this.assertRequest(request);
    const action = this.requireAction(request.actionId);
    this.assertSameAction(action, request);
    if (action.status !== "paused") throw new Error("PARKING_ACTION_NOT_PAUSED");
    this.assertAuthorized(request);
    if (action.capabilityVersion !== this.capability.version) throw new Error("PARKING_CAPABILITY_CHANGED_REPLAN_REQUIRED");
    return this.transition(action, "running", "SIMULATED_PARKING_RESUMED");
  }

  cancel(actionId: string): SimulatedParkingAction {
    const action = this.requireAction(actionId);
    if (action.status === "cancelled") return structuredClone(action);
    if (action.status === "unknown") throw new Error("PARKING_RESULT_RECONCILIATION_REQUIRED");
    if (action.status === "completed" || action.status === "failed") throw new Error("PARKING_ACTION_TERMINAL");
    return this.transition(action, "cancelled", "SIMULATED_PARKING_CANCELLED");
  }

  query(actionId: string): SimulatedParkingAction | undefined {
    assertId(actionId);
    const action = this.actions.get(actionId);
    return action ? structuredClone(action) : undefined;
  }

  reportOutcome(report: SimulatedParkingOutcomeReport): SimulatedParkingAction {
    assertId(report.reportId);
    assertId(report.actionId);
    assertId(report.reasonCode);
    assertTime(report.observedAt);
    if (report.source !== "simulated" || !["completed", "failed", "unknown"].includes(report.status)) {
      throw new Error("INVALID_SIMULATED_PARKING_REPORT");
    }
    const fingerprint = JSON.stringify([report.actionId, report.status, report.observedAt, report.reasonCode, report.source]);
    const prior = this.reports.get(report.reportId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error("PARKING_REPORT_ID_REUSED");
      // The original report may have been reconciled by a later report.
      // Replays should observe the action's current state, never regress it.
      return structuredClone(this.actions.get(report.actionId) ?? prior.action);
    }
    const action = this.requireAction(report.actionId);
    if (["completed", "cancelled", "failed"].includes(action.status)) throw new Error("PARKING_ACTION_TERMINAL");
    if (report.observedAt < action.updatedAt || report.observedAt > this.now()) throw new Error("PARKING_REPORT_TIME_INVALID");
    const result = this.transition(action, report.status, report.reasonCode, report.observedAt);
    this.reports.set(report.reportId, { fingerprint, action: result });
    return structuredClone(result);
  }

  private assertRequest(request: SimulatedParkingRequest): void {
    assertId(request.actionId);
    assertId(request.taskId);
    assertId(request.proposalId);
    assertVersion(request.planVersion);
  }

  private assertAuthorized(request: SimulatedParkingRequest): void {
    const capability = this.capability;
    const now = this.now();
    if (capability.observedAt > now || capability.validUntil <= now) throw new Error("PARKING_CAPABILITY_EXPIRED");
    if (capability.availability !== "available") throw new Error("PARKING_CAPABILITY_UNAVAILABLE");
    if (capability.feasibility !== "feasible") throw new Error("PARKING_FEASIBILITY_UNCONFIRMED");
    const consent = request.authorization;
    if (!consent || consent.responderRole !== "center" || consent.decision !== "approve" || consent.scope !== "parking.start") {
      throw new Error("PARKING_DRIVER_AUTHORIZATION_REQUIRED");
    }
    if (consent.taskId !== request.taskId || consent.proposalId !== request.proposalId ||
        consent.planVersion !== request.planVersion || consent.capabilityVersion !== capability.version) {
      throw new Error("PARKING_AUTHORIZATION_VERSION_MISMATCH");
    }
    assertTime(consent.expiresAt);
    if (consent.expiresAt <= now) throw new Error("PARKING_AUTHORIZATION_EXPIRED");
  }

  private assertSameAction(action: SimulatedParkingAction, request: SimulatedParkingRequest): void {
    if (action.taskId !== request.taskId || action.proposalId !== request.proposalId || action.planVersion !== request.planVersion) {
      throw new Error("PARKING_ACTION_ID_REUSED");
    }
  }

  private requireAction(actionId: string): SimulatedParkingAction {
    assertId(actionId);
    const action = this.actions.get(actionId);
    if (!action) throw new Error("PARKING_ACTION_NOT_FOUND");
    return action;
  }

  private transition(action: SimulatedParkingAction, status: SimulatedParkingAction["status"], reasonCode: string, updatedAt = this.now()): SimulatedParkingAction {
    assertId(reasonCode);
    const next = { ...action, status, reasonCode, updatedAt };
    this.actions.set(action.actionId, next);
    return structuredClone(next);
  }
}

function assertId(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) throw new Error("INVALID_PARKING_ID");
}
function assertVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("INVALID_PARKING_VERSION");
}
function assertTime(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("INVALID_PARKING_TIMESTAMP");
}
