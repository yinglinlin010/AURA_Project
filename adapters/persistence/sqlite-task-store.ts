import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ActiveTask, TaskActionRecord, TaskCondition } from "../../contracts/protocol/src/types.js";

const TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

/** Stores bounded task goals/conditions locally; raw conversation and provider payloads are excluded. */
export class SqliteTaskStore {
  private readonly db: Database.Database;
  private readonly now: () => number;

  constructor(options: { databasePath?: string; now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
    const path = options.databasePath ?? process.env.AURA_TASK_DB ?? resolve(process.cwd(), "data/aura-tasks.sqlite");
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("synchronous = FULL");
    this.db.pragma("secure_delete = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS task_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      tasks_json TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL
    ) STRICT`);
  }

  get(): ActiveTask[] {
    const row = this.db.prepare("SELECT tasks_json, expires_at_ms FROM task_state WHERE singleton = 1").get() as { tasks_json: string; expires_at_ms: number } | undefined;
    if (!row || row.expires_at_ms <= this.now()) {
      this.db.prepare("DELETE FROM task_state WHERE singleton = 1").run();
      return [];
    }
    return parseTasks(row.tasks_json);
  }

  save(tasks: ActiveTask[]): void {
    const safeTasks = parseTasks(JSON.stringify(tasks));
    const now = this.now();
    this.db.prepare(`INSERT INTO task_state(singleton, tasks_json, updated_at_ms, expires_at_ms)
      VALUES (1, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET
      tasks_json = excluded.tasks_json, updated_at_ms = excluded.updated_at_ms,
      expires_at_ms = excluded.expires_at_ms`).run(JSON.stringify(safeTasks), now, now + TASK_RETENTION_MS);
  }

  close(): void { this.db.close(); }
}

function parseTasks(raw: string): ActiveTask[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 200) throw new Error("INVALID_STORED_TASKS");
  const tasks = value as ActiveTask[];
  for (const task of tasks) {
    if (!task || typeof task.taskId !== "string" || typeof task.traceId !== "string" ||
        !["primary", "secondary", "critical"].includes(task.priority) ||
        !["running", "interrupted", "completed", "cancelled"].includes(task.status) ||
        !Number.isSafeInteger(task.startedAt) ||
        (task.interruptionReason !== undefined && (typeof task.interruptionReason !== "string" || task.interruptionReason.length > 128)) ||
        (task.version !== undefined && (!Number.isSafeInteger(task.version) || task.version < 1)) ||
        (task.goal !== undefined && (typeof task.goal !== "string" || task.goal.trim().length === 0 || task.goal.length > 1_000)) ||
        (task.currentStep !== undefined && (typeof task.currentStep !== "string" || task.currentStep.trim().length === 0 || task.currentStep.length > 500)) ||
        (task.pauseReason !== undefined && (typeof task.pauseReason !== "string" || task.pauseReason.trim().length === 0 || task.pauseReason.length > 500)) ||
        (task.conditions !== undefined && !validConditions(task.conditions)) ||
        (task.actionRecords !== undefined && !validActionRecords(task.actionRecords)) ||
        Object.keys(task).some((key) => !["taskId", "traceId", "priority", "status", "startedAt", "interruptionReason", "version", "goal", "conditions", "currentStep", "pauseReason", "actionRecords"].includes(key))) {
      throw new Error("INVALID_STORED_TASK");
    }
  }
  return structuredClone(tasks);
}

function validConditions(conditions: TaskCondition[]): boolean {
  const keys = new Set<string>();
  return Array.isArray(conditions) && conditions.length <= 20 && conditions.every((condition) => {
    if (!condition || typeof condition.key !== "string" || !condition.key.trim() || condition.key.length > 128 ||
        !["confirmed", "inferred", "unknown"].includes(condition.classification) ||
        (condition.value !== undefined && (typeof condition.value !== "string" || condition.value.length > 500)) ||
        (condition.source !== undefined && !["sensor", "simulated", "api", "derived", "cache"].includes(condition.source)) ||
        (condition.observedAt !== undefined && (!Number.isSafeInteger(condition.observedAt) || condition.observedAt < 0)) ||
        (condition.expiresAt !== undefined && (!Number.isSafeInteger(condition.expiresAt) || condition.expiresAt < 0)) ||
        (condition.classification === "unknown" && condition.value !== undefined) || keys.has(condition.key) ||
        Object.keys(condition).some((key) => !["key", "classification", "value", "source", "observedAt", "expiresAt"].includes(key))) return false;
    keys.add(condition.key);
    return true;
  });
}

function validActionRecords(records: TaskActionRecord[]): boolean {
  return Array.isArray(records) && records.length <= 50 && records.every((action) =>
    !!action && typeof action.actionId === "string" && action.actionId.length > 0 && action.actionId.length <= 128 &&
    typeof action.idempotencyKey === "string" && action.idempotencyKey.length > 0 && action.idempotencyKey.length <= 128 &&
    ["pending", "running", "paused", "succeeded", "failed", "cancelled", "unknown"].includes(action.status) &&
    Number.isSafeInteger(action.startedAt) && action.startedAt >= 0 && Number.isSafeInteger(action.updatedAt) && action.updatedAt >= action.startedAt &&
    (action.reasonCode === undefined || (typeof action.reasonCode === "string" && action.reasonCode.length > 0 && action.reasonCode.length <= 128)) &&
    Object.keys(action).every((key) => ["actionId", "idempotencyKey", "status", "startedAt", "updatedAt", "reasonCode"].includes(key))
  );
}
