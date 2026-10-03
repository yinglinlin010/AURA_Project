import assert from "node:assert/strict";
import test from "node:test";
import { CoreRuntime } from "../src/core-runtime.js";

test("task cancellation is visible, aborts active work, and prevents task ID revival", () => {
  const runtime = new CoreRuntime();
  const signal = runtime.startTask({ taskId: "dropoff-search", traceId: "start-trace", priority: "primary" });

  runtime.cancelTask("dropoff-search", "cancel-trace", "USER_CANCELLED");

  assert.equal(signal.aborted, true);
  assert.equal(runtime.getState().activeTasks[0]?.status, "cancelled");
  assert.throws(
    () => runtime.startTask({ taskId: "dropoff-search", traceId: "retry-trace", priority: "primary" }),
    /TASK_ID_TERMINAL_OR_USED/,
  );
});

test("interrupted work cannot be restarted under the same task ID", () => {
  const runtime = new CoreRuntime();
  runtime.startTask({ taskId: "route-preview", traceId: "start-trace", priority: "secondary" });
  runtime.ingestSignal({
    signalId: "critical-event",
    type: "safety.critical",
    value: { severity: "critical" },
    source: "sensor",
    timestamp: 1,
  }, "safety-trace");

  assert.equal(runtime.getState().activeTasks[0]?.status, "interrupted");
  assert.throws(
    () => runtime.startTask({ taskId: "route-preview", traceId: "resume-trace", priority: "secondary" }),
    /TASK_ID_TERMINAL_OR_USED/,
  );
});

test("interrupted work resumes only after explicit revalidation", () => {
  let revalidation = { candidateFresh: true, capabilityConfirmed: true, authorizationCurrent: false, priorActionOutcomeKnown: true };
  const runtime = new CoreRuntime({ revalidateTask: () => revalidation });
  const originalSignal = runtime.startTask({ taskId: "charge-stop", traceId: "start-trace", priority: "secondary" });
  runtime.ingestSignal({
    signalId: "critical-before-resume",
    type: "safety.critical",
    value: { severity: "critical" },
    source: "sensor",
    timestamp: 1,
  }, "safety-trace");
  assert.equal(originalSignal.aborted, true);

  assert.throws(() => runtime.resumeTask({
    taskId: "charge-stop", traceId: "resume-denied",
  }), /TASK_RECOVERY_REVALIDATION_REQUIRED/);
  assert.equal(runtime.getState().activeTasks[0]?.status, "interrupted");

  revalidation = { candidateFresh: true, capabilityConfirmed: true, authorizationCurrent: true, priorActionOutcomeKnown: true };
  const resumed = runtime.resumeTask({
    taskId: "charge-stop", traceId: "resume-approved",
  });
  assert.equal(resumed.aborted, false);
  assert.equal(runtime.getState().activeTasks[0]?.status, "running");
  assert.equal(runtime.getState().activeTasks[0]?.interruptionReason, undefined);
});

test("task progress versions changes, preserves untouched conditions, and reconciles unknown actions before resume", () => {
  let now = 100;
  const runtime = new CoreRuntime({
    now: () => now,
    revalidateTask: () => ({ candidateFresh: true, capabilityConfirmed: true, authorizationCurrent: true, priorActionOutcomeKnown: true }),
  });
  runtime.startTask({
    taskId: "mom-dropoff", traceId: "task-start", priority: "secondary",
    goal: "Find a convenient passenger drop-off with charging nearby",
    conditions: [
      { key: "dropoffPreference", classification: "confirmed", value: "near entrance", source: "simulated", observedAt: now, expiresAt: 1_000 },
      { key: "mobilityAssumption", classification: "unknown" },
    ],
  });
  const changed = runtime.updateTaskProgress({
    taskId: "mom-dropoff", traceId: "task-update",
    conditions: [{ key: "chargingRequired", classification: "confirmed", value: "true", source: "simulated", observedAt: now, expiresAt: 1_000 }],
    currentStep: "compare candidates",
  });
  assert.equal(changed.version, 2);
  assert.deepEqual(changed.conditions?.map((condition) => condition.key), ["dropoffPreference", "mobilityAssumption", "chargingRequired"]);
  const action = runtime.recordTaskAction({
    taskId: "mom-dropoff", traceId: "action-start", actionId: "add-stop", idempotencyKey: "journey-stop-1", status: "unknown",
  });
  assert.equal(action.actionRecords?.[0]?.status, "unknown");
  runtime.ingestSignal({
    signalId: "critical-task-update", type: "safety.critical", value: { severity: "critical" }, source: "sensor", timestamp: now,
  }, "safety-interrupt");
  assert.throws(() => runtime.resumeTask({ taskId: "mom-dropoff", traceId: "resume-before-reconcile" }), /TASK_ACTION_RECONCILIATION_REQUIRED/);

  now++;
  runtime.recordTaskAction({
    taskId: "mom-dropoff", traceId: "action-reconciled", actionId: "add-stop", idempotencyKey: "journey-stop-1", status: "succeeded",
  });
  const resumed = runtime.resumeTask({ taskId: "mom-dropoff", traceId: "resume-after-reconcile" });
  assert.equal(resumed.aborted, false);
  assert.equal(runtime.getState().activeTasks[0]?.status, "running");
});

test("task resume blocks after a confirmed condition expires", () => {
  let now = 100;
  const runtime = new CoreRuntime({
    now: () => now,
    revalidateTask: () => ({ candidateFresh: true, capabilityConfirmed: true, authorizationCurrent: true, priorActionOutcomeKnown: true }),
  });
  runtime.startTask({ taskId: "expired-option", traceId: "start", priority: "secondary", conditions: [
    { key: "candidate", classification: "confirmed", value: "place-1", source: "simulated", observedAt: now, expiresAt: 150 },
  ] });
  runtime.ingestSignal({
    signalId: "critical-expired-option", type: "safety.critical", value: { severity: "critical" }, source: "sensor", timestamp: now,
  }, "safety-expired");
  now = 151;
  assert.throws(() => runtime.resumeTask({ taskId: "expired-option", traceId: "resume" }), /TASK_CONDITION_EXPIRED/);
});

test("task lifecycle mutations are not published when durable write-through fails", () => {
  const runtime = new CoreRuntime({ persistTasks: () => { throw new Error("DISK_FULL"); } });
  assert.throws(() => runtime.startTask({ taskId: "write-through", traceId: "start", priority: "secondary" }), /DISK_FULL/);
  assert.equal(runtime.getState().activeTasks.length, 0);
  assert.equal(runtime.eventBus.eventsAfter(0).length, 0);
});

test("cancel and complete preserve cancellation registry state when persistence fails", () => {
  let failWrites = false;
  const runtime = new CoreRuntime({ persistTasks: () => { if (failWrites) throw new Error("DISK_FULL"); } });
  const cancelSignal = runtime.startTask({ taskId: "cancel-write-through", traceId: "cancel-start", priority: "secondary" });
  failWrites = true;
  const beforeCancel = runtime.eventBus.sequence;
  assert.throws(() => runtime.cancelTask("cancel-write-through", "cancel", "USER_CANCELLED"), /DISK_FULL/);
  assert.equal(cancelSignal.aborted, false);
  assert.equal(runtime.taskCancellations.getSignal("cancel-write-through"), cancelSignal);
  assert.equal(runtime.getState().activeTasks[0]?.status, "running");
  assert.equal(runtime.eventBus.sequence, beforeCancel);

  failWrites = false;
  const completeSignal = runtime.startTask({ taskId: "complete-write-through", traceId: "complete-start", priority: "secondary" });
  failWrites = true;
  const beforeComplete = runtime.eventBus.sequence;
  assert.throws(() => runtime.completeTask("complete-write-through", "complete"), /DISK_FULL/);
  assert.equal(completeSignal.aborted, false);
  assert.equal(runtime.taskCancellations.getSignal("complete-write-through"), completeSignal);
  assert.equal(runtime.getState().activeTasks.find((task) => task.taskId === "complete-write-through")?.status, "running");
  assert.equal(runtime.eventBus.sequence, beforeComplete);
});

test("safety interruption aborts immediately and remains fail-closed when task persistence fails", () => {
  let failWrites = false;
  const runtime = new CoreRuntime({ persistTasks: () => { if (failWrites) throw new Error("DISK_FULL"); } });
  const signal = runtime.startTask({ taskId: "safety-write-through", traceId: "safety-start", priority: "secondary" });
  failWrites = true;
  runtime.ingestSignal({
    signalId: "safety-write-failure", type: "safety.critical",
    value: { severity: "critical" }, source: "sensor", timestamp: 1,
  }, "safety-trace");
  assert.equal(signal.aborted, true);
  assert.equal(runtime.getState().activeTasks[0]?.status, "interrupted");
});

test("restart converts an in-flight action to unknown and requires reconciliation", () => {
  const initialTasks = [{
    taskId: "restart-action", traceId: "start", priority: "secondary" as const,
    status: "running" as const, startedAt: 1,
    actionRecords: [{ actionId: "parking", idempotencyKey: "parking", status: "running" as const, startedAt: 2, updatedAt: 3 }],
  }];
  const runtime = new CoreRuntime({
    now: () => 4,
    initialTasks,
    revalidateTask: () => ({ candidateFresh: true, capabilityConfirmed: true, authorizationCurrent: true, priorActionOutcomeKnown: true }),
  });
  assert.equal(runtime.getState().activeTasks[0]?.status, "interrupted");
  assert.equal(runtime.getState().activeTasks[0]?.actionRecords?.[0]?.status, "unknown");
  assert.throws(() => runtime.resumeTask({ taskId: "restart-action", traceId: "resume" }), /TASK_ACTION_RECONCILIATION_REQUIRED/);
});

test("task completion cannot strand an unresolved action", () => {
  const runtime = new CoreRuntime();
  runtime.startTask({ taskId: "complete-action", traceId: "start", priority: "secondary" });
  runtime.recordTaskAction({ taskId: "complete-action", traceId: "action", actionId: "a1", idempotencyKey: "a1", status: "running" });
  assert.throws(() => runtime.completeTask("complete-action", "complete"), /TASK_ACTION_RECONCILIATION_REQUIRED/);
  assert.equal(runtime.getState().activeTasks[0]?.status, "running");
});

test("an action ID cannot be recorded under a second idempotency key", () => {
  const runtime = new CoreRuntime();
  runtime.startTask({ taskId: "action-id-owner", traceId: "start", priority: "secondary" });
  runtime.recordTaskAction({ taskId: "action-id-owner", traceId: "action-start", actionId: "parking-1", idempotencyKey: "adapter-key", status: "running" });

  assert.throws(() => runtime.recordTaskAction({
    taskId: "action-id-owner", traceId: "action-forged", actionId: "parking-1", idempotencyKey: "hmi-command-key", status: "succeeded",
  }), /TASK_ACTION_ID_REUSED/);
  assert.deepEqual(runtime.getState().activeTasks[0]?.actionRecords?.map((action) => [action.actionId, action.idempotencyKey, action.status]), [
    ["parking-1", "adapter-key", "running"],
  ]);
});
