import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ActiveTask } from "../../../contracts/protocol/src/types.js";
import { SqliteTaskStore } from "../../../adapters/persistence/sqlite-task-store.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import { createTaskResumeRevalidator, type HostTaskRecoveryEvidence } from "../src/task-recovery-evidence.js";

const now = 1_800_000_000_000;
const valid: HostTaskRecoveryEvidence = {
  reality: "live", observedAt: now - 100, expiresAt: now + 1_000,
  candidateFresh: true, capabilityConfirmed: true, authorizationCurrent: true, priorActionOutcomeKnown: true,
};
const task: ActiveTask = { taskId: "resume-host", traceId: "trace-start", priority: "primary", status: "interrupted", startedAt: now - 5_000 };

test("host adapter permits resume only with complete fresh live evidence", () => {
  const runtime = new CoreRuntime({ now: () => now, initialTasks: [task], revalidateTask: createTaskResumeRevalidator(() => valid, () => now)! });
  runtime.resumeTask({ taskId: task.taskId, traceId: "resume-valid" });
  assert.equal(runtime.getState().activeTasks[0]?.status, "running");
});

test("host adapter fails closed for absent, missing, false, simulated, stale, future, or throwing evidence", () => {
  const cases: Array<[string, (() => HostTaskRecoveryEvidence | undefined) | undefined]> = [
    ["absent provider", undefined],
    ["absent evidence", () => undefined],
    ["candidate freshness", () => ({ ...valid, candidateFresh: false })],
    ["vehicle capability", () => ({ ...valid, capabilityConfirmed: false })],
    ["current authorization", () => ({ ...valid, authorizationCurrent: false })],
    ["prior action outcome", () => ({ ...valid, priorActionOutcomeKnown: false })],
    ["simulated evidence", () => ({ ...valid, reality: "simulated" })],
    ["expired evidence", () => ({ ...valid, expiresAt: now })],
    ["future evidence", () => ({ ...valid, observedAt: now + 1 })],
    ["incomplete timestamp", () => ({ ...valid, expiresAt: Number.NaN })],
    ["provider error", () => { throw new Error("provider unavailable"); }],
  ];
  for (const [label, provider] of cases) {
    const revalidator = createTaskResumeRevalidator(provider, () => now);
    const runtime = new CoreRuntime({ now: () => now, initialTasks: [task], ...(revalidator ? { revalidateTask: revalidator } : {}) });
    assert.throws(() => runtime.resumeTask({ taskId: task.taskId, traceId: `resume-${label.replaceAll(" ", "-")}` }), /TASK_RECOVERY_REVALIDATION_REQUIRED/, label);
    assert.equal(runtime.getState().activeTasks[0]?.status, "interrupted", label);
  }
});

test("restarted interrupted task resumes with freshly injected evidence; unknown outcomes still require reconciliation", () => {
  const directory = mkdtempSync(join(tmpdir(), "aura-host-task-recovery-"));
  const databasePath = join(directory, "tasks.sqlite");
  let store = new SqliteTaskStore({ databasePath });
  try {
    const first = new CoreRuntime({ now: () => now, persistTasks: (tasks) => store.save(tasks) });
    first.startTask({ taskId: "resume-host", traceId: "start", priority: "primary", goal: "Continue safely" });
    first.updateTaskProgress({ taskId: "resume-host", traceId: "step", currentStep: "Compare fresh options" });
    store.close();

    store = new SqliteTaskStore({ databasePath });
    const recovered = new CoreRuntime({ now: () => now, initialTasks: store.get(), persistTasks: (tasks) => store.save(tasks), revalidateTask: createTaskResumeRevalidator(() => valid, () => now)! });
    assert.equal(recovered.getState().activeTasks[0]?.status, "interrupted");
    assert.equal(recovered.getState().activeTasks[0]?.currentStep, "Compare fresh options");
    recovered.resumeTask({ taskId: "resume-host", traceId: "resume-after-restart" });
    assert.equal(recovered.getState().activeTasks[0]?.status, "running");

    recovered.recordTaskAction({ taskId: "resume-host", traceId: "action-unknown", actionId: "vehicle-operation", idempotencyKey: "vehicle-operation-1", status: "unknown", reasonCode: "RESULT_NOT_CONFIRMED" });
    // Interrupt through a host restart, then verify the evidence provider cannot bypass action reconciliation.
    store.close();
    store = new SqliteTaskStore({ databasePath });
    const reconciled = new CoreRuntime({ now: () => now, initialTasks: store.get(), persistTasks: (tasks) => store.save(tasks), revalidateTask: createTaskResumeRevalidator(() => valid, () => now)! });
    assert.throws(() => reconciled.resumeTask({ taskId: "resume-host", traceId: "resume-unknown" }), /TASK_ACTION_RECONCILIATION_REQUIRED/);
    assert.equal(reconciled.getState().activeTasks[0]?.status, "interrupted");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
