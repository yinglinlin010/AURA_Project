import { lstatSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { ActiveTask } from "../../../contracts/protocol/src/types.js";
import type { TaskResumeRevalidation } from "../../../packages/core-runtime/src/core-runtime.js";
import { createTaskResumeRevalidator, type HostTaskRecoveryEvidenceProvider } from "./task-recovery-evidence.js";

interface SimulatedRecoveryFixture extends TaskResumeRevalidation {
  reality: "simulated";
  sourceLabel: string;
  taskId: string;
  taskVersion: number;
  planVersion: number;
  observedAt: number;
  expiresAt: number;
}

export interface TaskRecoveryConfiguration {
  databasePath?: string;
  diagnostic?: string;
  revalidateTask?: (task: Readonly<ActiveTask>) => TaskResumeRevalidation;
}

const fields = ["reality", "sourceLabel", "taskId", "taskVersion", "planVersion", "observedAt", "expiresAt",
  "candidateFresh", "capabilityConfirmed", "authorizationCurrent", "priorActionOutcomeKnown"];
const flags = ["candidateFresh", "capabilityConfirmed", "authorizationCurrent", "priorActionOutcomeKnown"] as const;
const denied = (): TaskResumeRevalidation => ({ candidateFresh: false, capabilityConfirmed: false,
  authorizationCurrent: false, priorActionOutcomeKnown: false });

/** Simulator evidence never enters the live evidence adapter; configuration is validated before stores open. */
export function configureTaskRecovery(
  environment: NodeJS.ProcessEnv,
  liveProvider?: HostTaskRecoveryEvidenceProvider,
  now: () => number = Date.now,
  cwd: string = process.cwd(),
): TaskRecoveryConfiguration {
  const fixturePath = environment.AURA_SIMULATED_TASK_RECOVERY_FIXTURE;
  const simulatorDatabase = environment.AURA_SIMULATED_TASK_DB_PATH;
  if (fixturePath === undefined && simulatorDatabase === undefined) {
    const revalidateTask = createTaskResumeRevalidator(liveProvider, now);
    return revalidateTask ? { revalidateTask } : {};
  }
  if (liveProvider) throw new Error("TASK_RECOVERY_LIVE_SIMULATOR_CONFLICT");
  if (!fixturePath?.trim() || !simulatorDatabase?.trim() || simulatorDatabase.trim() === ":memory:" ||
      simulatorDatabase.trim().startsWith("file:")) {
    throw new Error("SIMULATED_TASK_RECOVERY_CONFIGURATION_REQUIRED");
  }
  const databasePath = resolve(cwd, simulatorDatabase.trim());
  const protectedPaths = [resolve(cwd, "data/aura-tasks.sqlite"),
    resolve(cwd, environment.AURA_TASK_DB ?? "data/aura-tasks.sqlite")];
  if (protectedPaths.some((path) => sameFile(databasePath, path))) {
    throw new Error("SIMULATED_TASK_RECOVERY_LEDGER_NOT_ISOLATED");
  }
  const fixtureFile = resolve(cwd, fixturePath.trim());
  if (sameFile(databasePath, fixtureFile)) throw new Error("SIMULATED_TASK_RECOVERY_LEDGER_NOT_ISOLATED");
  if (!statSync(fixtureFile).isFile() || statSync(fixtureFile).size > 16_384) {
    throw new Error("INVALID_SIMULATED_TASK_RECOVERY_FIXTURE");
  }
  const fixture = parseFixture(JSON.parse(readFileSync(fixtureFile, "utf8")));
  return {
    databasePath,
    diagnostic: `SIMULATOR-ONLY task recovery enabled; reality=simulated; source=${fixture.sourceLabel}; no live vehicle authority or HMI source marking`,
    revalidateTask: (task) => {
      const observedNow = now();
      // ActiveTask.version is the existing plan version: neither binding can be inferred or omitted.
      if (!Number.isFinite(observedNow) || task.status !== "interrupted" || task.taskId !== fixture.taskId ||
          task.version !== fixture.taskVersion || task.version !== fixture.planVersion ||
          fixture.observedAt > observedNow || fixture.expiresAt <= observedNow ||
          task.actionRecords?.some((action) => ["unknown", "pending", "running", "paused"].includes(action.status))) {
        return denied();
      }
      return { candidateFresh: fixture.candidateFresh, capabilityConfirmed: fixture.capabilityConfirmed,
        authorizationCurrent: fixture.authorizationCurrent, priorActionOutcomeKnown: fixture.priorActionOutcomeKnown };
    },
  };
}

function parseFixture(value: unknown): SimulatedRecoveryFixture {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_SIMULATED_TASK_RECOVERY_FIXTURE");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== fields.length || Object.keys(record).some((key) => !fields.includes(key)) ||
      record.reality !== "simulated" || typeof record.sourceLabel !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(record.sourceLabel) ||
      typeof record.taskId !== "string" || !record.taskId.trim() || record.taskId.length > 128 ||
      ![record.taskVersion, record.planVersion].every((version) => Number.isSafeInteger(version) && (version as number) >= 1) ||
      ![record.observedAt, record.expiresAt].every((time) => Number.isSafeInteger(time) && (time as number) >= 0) ||
      (record.observedAt as number) >= (record.expiresAt as number) ||
      flags.some((flag) => typeof record[flag] !== "boolean")) {
    throw new Error("INVALID_SIMULATED_TASK_RECOVERY_FIXTURE");
  }
  return structuredClone(record) as unknown as SimulatedRecoveryFixture;
}

function canonicalPath(path: string, depth = 0): string {
  if (depth > 64) throw new Error("SIMULATED_TASK_RECOVERY_PATH_UNRESOLVABLE");
  try { return realpathSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // realpath fails for dangling links; still resolve their target before deciding isolation.
    try {
      if (lstatSync(path).isSymbolicLink()) return canonicalPath(resolve(dirname(path), readlinkSync(path)), depth + 1);
    } catch (linkError) {
      if ((linkError as NodeJS.ErrnoException).code !== "ENOENT") throw linkError;
    }
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(canonicalPath(parent, depth + 1), basename(path));
  }
}

function sameFile(left: string, right: string): boolean {
  if (canonicalPath(left) === canonicalPath(right)) return true;
  try {
    const a = statSync(left), b = statSync(right);
    return a.dev === b.dev && a.ino === b.ino;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return false;
  }
}
