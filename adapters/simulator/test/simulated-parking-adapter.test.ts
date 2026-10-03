import assert from "node:assert/strict";
import test from "node:test";
import { SimulatedParkingAdapter } from "../../vehicle/simulated-parking-adapter.js";
import { SimulatedParkingTaskCoordinator } from "../../vehicle/simulated-parking-coordinator.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import type { SimulatedParkingCapability, SimulatedParkingRequest } from "../../vehicle/types.js";

function fixture() {
  let now = 100;
  const capability: SimulatedParkingCapability = {
    capabilityId: "fixture-parking", version: 1,
    availability: "available", feasibility: "feasible",
    observedAt: 100, validUntil: 1000, reasonCode: "SIMULATED_CAPABILITY_READY",
    source: "simulated", reality: "simulated",
  };
  const adapter = new SimulatedParkingAdapter({ now: () => now, capability });
  const request: SimulatedParkingRequest = {
    actionId: "park-action", taskId: "arrival-task", proposalId: "parking-plan", planVersion: 1,
    authorization: {
      taskId: "arrival-task", proposalId: "parking-plan", planVersion: 1,
      capabilityVersion: 1, responderRole: "center", decision: "approve",
      scope: "parking.start", expiresAt: 900,
    },
  };
  return { adapter, capability, request, tick: (time: number) => { now = time; } };
}

test("simulated parking requires explicit known capability and feasibility", () => {
  const { adapter, capability, request } = fixture();
  assert.throws(() => new SimulatedParkingAdapter({ now: () => 100 }).start(request), /CAPABILITY_EXPIRED/);
  adapter.setCapability({ ...capability, availability: "unavailable" });
  assert.throws(() => adapter.start(request), /CAPABILITY_UNAVAILABLE/);
  adapter.setCapability({ ...capability, feasibility: "unknown" });
  assert.throws(() => adapter.start(request), /FEASIBILITY_UNCONFIRMED/);
  assert.equal(adapter.query(request.actionId), undefined);
});

test("start rejects wrong role, refusal, obsolete plan consent, and expired authorization", () => {
  const { adapter, request, tick } = fixture();
  for (const authorization of [
    { ...request.authorization, responderRole: "front_passenger" },
    { ...request.authorization, decision: "decline" as const },
  ]) {
    assert.throws(() => adapter.start({ ...request, authorization }), /DRIVER_AUTHORIZATION_REQUIRED/);
  }
  assert.throws(() => adapter.start({ ...request, planVersion: 2 }), /AUTHORIZATION_VERSION_MISMATCH/);
  assert.throws(() => adapter.start({ ...request, authorization: { ...request.authorization, expiresAt: 100 } }), /AUTHORIZATION_EXPIRED/);
  assert.equal(adapter.query(request.actionId), undefined);
});

test("a stable action ID starts once and no clock advance implies parking completion", () => {
  const { adapter, request, tick } = fixture();
  const start = adapter.start(request);
  assert.equal(start.replayed, false);
  assert.equal(start.action.status, "running");
  assert.equal(start.action.reality, "simulated");
  assert.equal(start.action.source, "simulated");
  assert.equal(start.action.vehicleControlAllowed, false);
  tick(1200);
  const repeated = adapter.start(request);
  assert.equal(repeated.replayed, true);
  assert.equal(repeated.action.startedAt, 100);
  assert.equal(repeated.action.status, "running");
  assert.throws(() => adapter.start({ ...request, taskId: "other-task" }), /ACTION_ID_REUSED/);
});

test("resume rechecks capability, authorization expiry, and unchanged plan", () => {
  const { adapter, capability, request, tick } = fixture();
  adapter.start(request);
  adapter.pause(request.actionId);
  tick(900);
  assert.throws(() => adapter.resume(request), /AUTHORIZATION_EXPIRED/);
  assert.equal(adapter.query(request.actionId)?.status, "paused");
  const renewed = { ...request, authorization: { ...request.authorization, expiresAt: 1100 } };
  adapter.setCapability({ ...capability, feasibility: "infeasible" });
  assert.throws(() => adapter.resume(renewed), /FEASIBILITY_UNCONFIRMED/);
  adapter.setCapability(capability);
  assert.equal(adapter.resume(renewed).status, "running");
  adapter.pause(request.actionId);
  adapter.setCapability({ ...capability, version: 2 });
  assert.throws(() => adapter.resume(renewed), /AUTHORIZATION_VERSION_MISMATCH/);
  assert.throws(() => adapter.resume({ ...renewed, authorization: { ...renewed.authorization, capabilityVersion: 2 } }), /CAPABILITY_CHANGED_REPLAN_REQUIRED/);
});

test("cancel is terminal and repeated start, resume, or late completion cannot revive it", () => {
  const { adapter, request, tick } = fixture();
  adapter.start(request);
  assert.equal(adapter.cancel(request.actionId).status, "cancelled");
  assert.equal(adapter.cancel(request.actionId).status, "cancelled");
  assert.equal(adapter.start(request).action.status, "cancelled");
  assert.throws(() => adapter.resume(request), /NOT_PAUSED/);
  assert.throws(() => adapter.reportOutcome({ reportId: "late-result", actionId: request.actionId, status: "completed", source: "simulated", reasonCode: "SIMULATED_COMPLETION", observedAt: 100 }), /ACTION_TERMINAL/);
});

test("unknown results block new starts and resume until an explicit simulator result reconciles them", () => {
  const { adapter, request, tick } = fixture();
  adapter.start(request);
  tick(150);
  adapter.reportOutcome({ reportId: "lost-result", actionId: request.actionId, status: "unknown", source: "simulated", reasonCode: "SIMULATED_RESULT_UNKNOWN", observedAt: 150 });
  assert.equal(adapter.query(request.actionId)?.status, "unknown");
  assert.equal(adapter.start(request).action.status, "unknown");
  assert.throws(() => adapter.resume(request), /NOT_PAUSED/);
  assert.throws(() => adapter.cancel(request.actionId), /RECONCILIATION_REQUIRED/);
  assert.throws(() => adapter.start({ ...request, actionId: "blind-retry" }), /ACTIVE_OR_UNRECONCILED/);
  tick(200);
  assert.equal(adapter.reportOutcome({ reportId: "reconciled-result", actionId: request.actionId, status: "completed", source: "simulated", reasonCode: "SIMULATED_SYSTEM_COMPLETED", observedAt: 200 }).status, "completed");
});

test("simulator result reports reject reuse and stale/future events and complete only once", () => {
  const { adapter, request, tick } = fixture();
  adapter.start(request);
  tick(200);
  const report = { reportId: "completion", actionId: request.actionId, status: "completed" as const, source: "simulated" as const, reasonCode: "SIMULATED_SYSTEM_COMPLETED", observedAt: 200 };
  assert.throws(() => adapter.reportOutcome({ ...report, observedAt: 99 }), /REPORT_TIME_INVALID/);
  assert.throws(() => adapter.reportOutcome({ ...report, observedAt: 201 }), /REPORT_TIME_INVALID/);
  assert.equal(adapter.reportOutcome(report).status, "completed");
  assert.deepEqual(adapter.reportOutcome(report), adapter.query(request.actionId));
  assert.throws(() => adapter.reportOutcome({ ...report, status: "failed" }), /REPORT_ID_REUSED/);
  assert.throws(() => adapter.reportOutcome({ ...report, reportId: "other-completion" }), /ACTION_TERMINAL/);
});

test("caller mutation cannot change simulator capability or action state", () => {
  const { adapter, capability, request } = fixture();
  capability.availability = "unavailable";
  const snapshot = adapter.readCapability();
  snapshot.feasibility = "infeasible";
  const started = adapter.start(request);
  started.action.status = "completed";
  assert.equal(adapter.readCapability().availability, "available");
  assert.equal(adapter.query(request.actionId)?.status, "running");
});

test("simulated parking outcomes flow into Runtime recovery and unknown blocks resume until reconciled", () => {
  let now = 100;
  const runtime = new CoreRuntime({
    now: () => now,
    revalidateTask: () => ({ candidateFresh: true, capabilityConfirmed: true, authorizationCurrent: true, priorActionOutcomeKnown: true }),
  });
  runtime.startTask({ taskId: "arrival-task", traceId: "task-start", priority: "secondary", goal: "Coordinate parking" });
  const { adapter, request, tick } = fixture();
  const coordinator = new SimulatedParkingTaskCoordinator(runtime, adapter);
  coordinator.start(request, "parking-start");
  assert.equal(runtime.getState().activeTasks[0]?.actionRecords?.[0]?.status, "running");

  now = 150;
  tick(150);
  coordinator.reportOutcome({ reportId: "result-unknown", actionId: request.actionId, status: "unknown", observedAt: now, reasonCode: "SIMULATED_RESULT_UNKNOWN", source: "simulated" }, "parking-unknown");
  assert.equal(runtime.getState().activeTasks[0]?.actionRecords?.[0]?.status, "unknown");
  runtime.ingestSignal({ signalId: "parking-critical", type: "safety.critical", value: { severity: "critical" }, source: "sensor", timestamp: now }, "safety-interrupt");
  assert.throws(() => runtime.resumeTask({ taskId: "arrival-task", traceId: "resume-unknown" }), /TASK_ACTION_RECONCILIATION_REQUIRED/);

  now = 200;
  tick(200);
  coordinator.reportOutcome({ reportId: "result-reconciled", actionId: request.actionId, status: "completed", observedAt: now, reasonCode: "SIMULATED_SYSTEM_COMPLETED", source: "simulated" }, "parking-completed");
  assert.equal(runtime.getState().activeTasks[0]?.actionRecords?.[0]?.status, "succeeded");
  const resumed = runtime.resumeTask({ taskId: "arrival-task", traceId: "resume-reconciled" });
  assert.equal(resumed.aborted, false);
});

test("safety interruption cancels the simulated action and blocks resume until its action is reconciled", () => {
  let now = 100;
  let failWrites = false;
  const runtime = new CoreRuntime({
    now: () => now,
    persistTasks: () => { if (failWrites) throw new Error("DISK_FULL"); },
    revalidateTask: () => ({ candidateFresh: true, capabilityConfirmed: true, authorizationCurrent: true, priorActionOutcomeKnown: true }),
  });
  const taskSignal = runtime.startTask({ taskId: "safety-parking", traceId: "task-start", priority: "secondary" });
  const { adapter, request } = fixture();
  const coordinator = new SimulatedParkingTaskCoordinator(runtime, adapter);
  coordinator.start(requestFor(request, "safety-parking"), "parking-start");
  failWrites = true;

  runtime.ingestSignal({ signalId: "parking-safety", type: "safety.critical", value: { severity: "critical" }, source: "sensor", timestamp: now }, "safety-interrupt");
  assert.equal(taskSignal.aborted, true);
  assert.equal(adapter.query(request.actionId)?.status, "cancelled");
  assert.equal(runtime.getState().activeTasks[0]?.status, "interrupted");
  assert.throws(() => coordinator.resume(requestFor(request, "safety-parking"), "resume-before-runtime"), /PARKING_TASK_NOT_RUNNING/);
  assert.throws(() => runtime.resumeTask({ taskId: "safety-parking", traceId: "resume-unreconciled" }), /TASK_ACTION_RECONCILIATION_REQUIRED/);

  failWrites = false;
  coordinator.query(request.actionId, "parking-reconcile");
  assert.equal(runtime.getState().activeTasks[0]?.actionRecords?.[0]?.status, "cancelled");
  assert.equal(runtime.resumeTask({ taskId: "safety-parking", traceId: "resume-after-reconcile" }).aborted, false);
});

test("failed task-ledger persistence rolls adapter resume back to paused", () => {
  let failWrites = false;
  const runtime = new CoreRuntime({ persistTasks: () => { if (failWrites) throw new Error("DISK_FULL"); } });
  runtime.startTask({ taskId: "resume-write-through", traceId: "task-start", priority: "secondary" });
  const { adapter, request } = fixture();
  const coordinator = new SimulatedParkingTaskCoordinator(runtime, adapter);
  const currentRequest = requestFor(request, "resume-write-through");
  coordinator.start(currentRequest, "parking-start");
  coordinator.pause(currentRequest.actionId, "parking-pause");
  failWrites = true;

  assert.throws(() => coordinator.resume(currentRequest, "parking-resume"), /DISK_FULL/);
  assert.equal(adapter.query(currentRequest.actionId)?.status, "paused");
  assert.equal(runtime.getState().activeTasks[0]?.actionRecords?.[0]?.status, "paused");

  failWrites = false;
  assert.equal(coordinator.resume(currentRequest, "parking-resume-retry").status, "running");
  assert.equal(runtime.getState().activeTasks[0]?.actionRecords?.[0]?.status, "running");
});

test("replaying an old report after reconciliation does not regress the Runtime action ledger", () => {
  let now = 100;
  const runtime = new CoreRuntime({ now: () => now });
  runtime.startTask({ taskId: "report-replay", traceId: "task-start", priority: "secondary" });
  const { adapter, request, tick } = fixture();
  const coordinator = new SimulatedParkingTaskCoordinator(runtime, adapter);
  const currentRequest = requestFor(request, "report-replay");
  coordinator.start(currentRequest, "parking-start");
  now = 150;
  tick(150);
  const unknown = { reportId: "same-unknown", actionId: request.actionId, status: "unknown" as const, observedAt: now, reasonCode: "SIMULATED_RESULT_UNKNOWN", source: "simulated" as const };
  coordinator.reportOutcome(unknown, "parking-unknown");
  now = 200;
  tick(200);
  coordinator.reportOutcome({ ...unknown, reportId: "reconciled", status: "completed", observedAt: now, reasonCode: "SIMULATED_SYSTEM_COMPLETED" }, "parking-completed");
  const replayed = coordinator.reportOutcome(unknown, "parking-old-report-replay");
  assert.equal(replayed.status, "completed");
  assert.equal(runtime.getState().activeTasks[0]?.actionRecords?.[0]?.status, "succeeded");
});

function requestFor(request: SimulatedParkingRequest, taskId: string): SimulatedParkingRequest {
  return {
    ...request,
    taskId,
    authorization: { ...request.authorization, taskId },
  };
}
