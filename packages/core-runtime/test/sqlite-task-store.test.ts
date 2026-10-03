import assert from "node:assert/strict";
import test from "node:test";
import { SqliteTaskStore } from "../../../adapters/persistence/sqlite-task-store.js";
import { CoreRuntime } from "../src/core-runtime.js";

test("SQLite task state restores in-progress work as interrupted after host restart", () => {
  let now = 100;
  const store = new SqliteTaskStore({ databasePath: ":memory:", now: () => now });
  const first = new CoreRuntime({ persistTasks: (tasks) => store.save(tasks) });
  first.startTask({ taskId: "journey-task", traceId: "start", priority: "primary", goal: "Find convenient drop-off and charging", conditions: [
    { key: "dropoffPreference", classification: "confirmed", value: "near entrance", source: "simulated", observedAt: 100, expiresAt: 500 },
  ] });
  first.recordTaskAction({ taskId: "journey-task", traceId: "action", actionId: "add-stop", idempotencyKey: "stop-1", status: "unknown" });

  now++;
  const restored = new CoreRuntime({ initialTasks: store.get(), persistTasks: (tasks) => store.save(tasks) });

  assert.equal(restored.getState().activeTasks[0]?.status, "interrupted");
  assert.equal(restored.getState().activeTasks[0]?.interruptionReason, "HOST_RESTART_RECOVERY_REQUIRED");
  assert.equal(restored.getState().activeTasks[0]?.goal, "Find convenient drop-off and charging");
  assert.equal(restored.getState().activeTasks[0]?.conditions?.[0]?.classification, "confirmed");
  assert.equal(restored.getState().activeTasks[0]?.actionRecords?.[0]?.status, "unknown");
  assert.throws(
    () => restored.startTask({ taskId: "journey-task", traceId: "unsafe-retry", priority: "primary" }),
    /TASK_ID_TERMINAL_OR_USED/,
  );
  store.close();
});

test("SQLite task records expire and reject unexpected or content-bearing fields", () => {
  let now = 10;
  const store = new SqliteTaskStore({ databasePath: ":memory:", now: () => now });
  store.save([{ taskId: "task-1", traceId: "trace-1", priority: "secondary", status: "completed", startedAt: 1 }]);
  assert.equal(store.get().length, 1);
  assert.throws(() => store.save([{
    taskId: "task-2", traceId: "trace-2", priority: "primary", status: "running", startedAt: 2,
    userUtterance: "private text",
  } as never]), /INVALID_STORED_TASK/);
  now += 7 * 24 * 60 * 60 * 1_000;
  assert.deepEqual(store.get(), []);
  store.close();
});
