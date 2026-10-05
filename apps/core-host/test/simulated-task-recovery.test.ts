import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { ActiveTask } from "../../../contracts/protocol/src/types.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import { SqliteTaskStore } from "../../../adapters/persistence/sqlite-task-store.js";
import { configureTaskRecovery } from "../src/simulated-task-recovery.js";
// Include the entrypoint in test compilation without executing its startup in this process.
import type { main } from "../src/main.js";

const time = 1_800_000_000_000;
const fixture = { reality: "simulated", sourceLabel: "scenario-fixture:recovery", taskId: "demo-task",
  taskVersion: 2, planVersion: 2, observedAt: time - 100, expiresAt: time + 100,
  candidateFresh: true, capabilityConfirmed: true, authorizationCurrent: true, priorActionOutcomeKnown: true };
const task: ActiveTask = { taskId: "demo-task", traceId: "start", priority: "secondary", status: "interrupted",
  startedAt: time - 1_000, version: 2, goal: "Compare simulated charging options" };

function sandbox(run: (directory: string, env: NodeJS.ProcessEnv) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "aura-simulator-recovery-"));
  const fixtureFile = join(directory, "fixture.json");
  writeFileSync(fixtureFile, JSON.stringify(fixture));
  try { run(directory, { AURA_SIMULATED_TASK_RECOVERY_FIXTURE: fixtureFile,
    AURA_SIMULATED_TASK_DB_PATH: join(directory, "simulator.sqlite") }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test("default host configuration has no recovery authority; live injection retains its existing contract", () => {
  assert.deepEqual(configureTaskRecovery({}), {});
  const runtime = new CoreRuntime({ initialTasks: [task], now: () => time });
  assert.throws(() => runtime.resumeTask({ taskId: task.taskId, traceId: "default-resume" }), /TASK_RECOVERY_REVALIDATION_REQUIRED/);
  const live = configureTaskRecovery({}, () => ({ ...fixture, reality: "live" }), () => time);
  assert.equal(live.revalidateTask?.(task).authorizationCurrent, true);
  assert.equal(live.databasePath, undefined);
  assert.equal(live.diagnostic, undefined);
});

test("simulator startup requires paired explicit configuration and rejects a live provider conflict", () => sandbox((directory, env) => {
  for (const invalid of [{ AURA_SIMULATED_TASK_RECOVERY_FIXTURE: env.AURA_SIMULATED_TASK_RECOVERY_FIXTURE },
    { AURA_SIMULATED_TASK_DB_PATH: env.AURA_SIMULATED_TASK_DB_PATH },
    { ...env, AURA_SIMULATED_TASK_DB_PATH: " " }, { ...env, AURA_SIMULATED_TASK_DB_PATH: ":memory:" },
    { ...env, AURA_SIMULATED_TASK_RECOVERY_FIXTURE: "" }]) {
    assert.throws(() => configureTaskRecovery(invalid, undefined, () => time, directory), /CONFIGURATION_REQUIRED/);
  }
  assert.throws(() => configureTaskRecovery(env, () => undefined, () => time, directory), /LIVE_SIMULATOR_CONFLICT/);
}));

test("simulator ledger cannot alias default, configured live, symlink, hardlink, or fixture paths", () => sandbox((directory, env) => {
  mkdirSync(join(directory, "data"));
  const live = join(directory, "data/aura-tasks.sqlite");
  writeFileSync(live, "existing live ledger");
  const linked = join(directory, "linked.sqlite"), hard = join(directory, "hard.sqlite");
  symlinkSync(live, linked);
  linkSync(live, hard);
  for (const databasePath of [live, linked, hard, env.AURA_SIMULATED_TASK_RECOVERY_FIXTURE!]) {
    assert.throws(() => configureTaskRecovery({ ...env, AURA_SIMULATED_TASK_DB_PATH: databasePath }, undefined,
      () => time, directory), /LEDGER_NOT_ISOLATED/);
  }
  assert.throws(() => configureTaskRecovery({ ...env, AURA_TASK_DB: env.AURA_SIMULATED_TASK_DB_PATH }, undefined,
    () => time, directory), /LEDGER_NOT_ISOLATED/);
  assert.throws(() => configureTaskRecovery({ ...env, AURA_SIMULATED_TASK_DB_PATH: "data/../data/aura-tasks.sqlite" },
    undefined, () => time, directory), /LEDGER_NOT_ISOLATED/);
  const absentLive = join(directory, "not-created.sqlite"), dangling = join(directory, "dangling.sqlite");
  symlinkSync(absentLive, dangling);
  assert.throws(() => configureTaskRecovery({ ...env, AURA_TASK_DB: absentLive, AURA_SIMULATED_TASK_DB_PATH: dangling },
    undefined, () => time, directory), /LEDGER_NOT_ISOLATED/);
}));

test("fixture parser rejects missing flags, extra fields, live reality, invalid times and unsafe source labels", () => sandbox((directory, env) => {
  const missing = { ...fixture } as Partial<typeof fixture>;
  delete missing.authorizationCurrent;
  const cases: unknown[] = [missing, { ...fixture, extra: true }, { ...fixture, reality: "live" },
    { ...fixture, candidateFresh: "true" }, { ...fixture, observedAt: fixture.expiresAt },
    { ...fixture, taskVersion: 0 }, { ...fixture, expiresAt: Infinity },
    { ...fixture, sourceLabel: "fixture\nLIVE" }, [], null];
  for (const value of cases) {
    writeFileSync(env.AURA_SIMULATED_TASK_RECOVERY_FIXTURE!, JSON.stringify(value));
    assert.throws(() => configureTaskRecovery(env, undefined, () => time, directory), /INVALID_SIMULATED_TASK_RECOVERY_FIXTURE/);
  }
}));

test("only the exact interrupted task and both version bindings can use fixture authority", () => sandbox((directory, env) => {
  const config = configureTaskRecovery(env, undefined, () => time, directory);
  assert.match(config.diagnostic!, /SIMULATOR-ONLY.*reality=simulated.*no live vehicle authority/);
  const revalidate = config.revalidateTask!;
  const original = structuredClone(task);
  assert.equal(revalidate(task).authorizationCurrent, true);
  assert.deepEqual(task, original);
  for (const wrong of [{ ...task, taskId: "other" }, { ...task, version: 3 },
    { ...task, version: undefined }, { ...task, status: "cancelled" as const }]) {
    const candidate = { ...wrong };
    if (candidate.version === undefined) delete candidate.version;
    assert.equal(revalidate(candidate as ActiveTask).authorizationCurrent, false);
  }
  writeFileSync(env.AURA_SIMULATED_TASK_RECOVERY_FIXTURE!, JSON.stringify({ ...fixture, planVersion: 3 }));
  assert.equal(configureTaskRecovery(env, undefined, () => time, directory).revalidateTask!(task).candidateFresh, false);
}));

test("timestamps never refresh on resume or fixture-file rewrite, and future/stale evidence is denied", () => sandbox((directory, env) => {
  let clock = time;
  const revalidate = configureTaskRecovery(env, undefined, () => clock, directory).revalidateTask!;
  assert.equal(revalidate(task).candidateFresh, true);
  clock = fixture.expiresAt;
  writeFileSync(env.AURA_SIMULATED_TASK_RECOVERY_FIXTURE!, JSON.stringify({ ...fixture, expiresAt: clock + 10_000 }));
  assert.equal(revalidate(task).candidateFresh, false);
  clock = fixture.observedAt - 1;
  assert.equal(revalidate(task).candidateFresh, false);
  clock = Number.NaN;
  assert.equal(revalidate(task).candidateFresh, false);
}));

test("each false fixture boundary refuses Runtime resume without mutating interrupted state", () => sandbox((directory, env) => {
  for (const key of ["candidateFresh", "capabilityConfirmed", "authorizationCurrent", "priorActionOutcomeKnown"]) {
    writeFileSync(env.AURA_SIMULATED_TASK_RECOVERY_FIXTURE!, JSON.stringify({ ...fixture, [key]: false }));
    const config = configureTaskRecovery(env, undefined, () => time, directory);
    const runtime = new CoreRuntime({ initialTasks: [task], now: () => time, revalidateTask: config.revalidateTask! });
    const before = runtime.getState();
    assert.throws(() => runtime.resumeTask({ taskId: task.taskId, traceId: `denied-${key}` }), /REVALIDATION_REQUIRED/);
    assert.deepEqual(runtime.getState(), before);
  }
}));

test("isolated SQLite restart resumes only fresh matched task; unknown outcomes still require reconciliation", () => sandbox((directory, env) => {
  const config = configureTaskRecovery(env, undefined, () => time, directory);
  let store = new SqliteTaskStore({ databasePath: config.databasePath!, now: () => time });
  store.save([{ ...task, status: "running" }]);
  store.close();
  store = new SqliteTaskStore({ databasePath: config.databasePath!, now: () => time });
  try {
    const runtime = new CoreRuntime({ initialTasks: store.get(), now: () => time,
      revalidateTask: config.revalidateTask!, persistTasks: (tasks) => store.save(tasks) });
    assert.equal(runtime.getState().activeTasks[0]!.status, "interrupted");
    runtime.resumeTask({ taskId: task.taskId, traceId: "simulator-resume" });
    assert.equal(store.get()[0]!.status, "running");
    const unknown: ActiveTask = { ...task, actionRecords: [{ actionId: "parking", idempotencyKey: "parking-1",
      status: "unknown", startedAt: time - 10, updatedAt: time - 1 }] };
    assert.equal(config.revalidateTask!(unknown).priorActionOutcomeKnown, false);
    const blocked = new CoreRuntime({ initialTasks: [unknown], now: () => time, revalidateTask: config.revalidateTask! });
    assert.throws(() => blocked.resumeTask({ taskId: task.taskId, traceId: "unknown-resume" }), /RECONCILIATION_REQUIRED/);
    const expired = new CoreRuntime({ initialTasks: [task], now: () => fixture.expiresAt,
      revalidateTask: configureTaskRecovery(env, undefined, () => fixture.expiresAt, directory).revalidateTask! });
    assert.throws(() => expired.resumeTask({ taskId: task.taskId, traceId: "stale-restart" }), /REVALIDATION_REQUIRED/);
  } finally { store.close(); }
}));

test("Host CLI prints simulator-only diagnostic and opens the explicitly isolated ledger", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aura-simulator-host-"));
  const fixtureFile = join(directory, "fixture.json"), database = join(directory, "simulator.sqlite");
  writeFileSync(fixtureFile, JSON.stringify(fixture));
  let output = "", errors = "";
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL("../src/main.js", import.meta.url))], {
      env: { PATH: process.env.PATH, AURA_DISPLAY_REGISTRY: resolve("apps/core-host/config/display-registry.json"),
        AURA_SIMULATED_TASK_RECOVERY_FIXTURE: fixtureFile, AURA_SIMULATED_TASK_DB_PATH: database,
        AURA_TASK_DB: join(directory, "live.sqlite"), AURA_JOURNEY_DB: join(directory, "journey.sqlite"),
        AURA_HOST: "127.0.0.1", AURA_PORT: "0", AURA_VOICE_MODE: "mock" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise<void>((finish, reject) => {
      let ready = false;
      const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`HOST_START_TIMEOUT: ${errors}`)); }, 5_000);
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (!ready && output.includes("Core HMI Gateway listening")) { ready = true; child.kill("SIGTERM"); }
      });
      child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (ready && code === 0) finish(); else reject(new Error(`HOST_START_FAILED: ${code}: ${errors}`));
      });
    });
    assert.match(output, /SIMULATOR-ONLY task recovery enabled; reality=simulated/);
    assert.match(output, /no live vehicle authority or HMI source marking/);
    assert.equal(existsSync(database), true);
    assert.equal(existsSync(join(directory, "live.sqlite")), false);
    assert.equal(errors, "");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
