import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { default as Ajv, type AnySchema, type ValidateFunction } from "ajv";
import { parse } from "yaml";
import { findEnabledDisplay } from "../../../contracts/protocol/src/registry.js";
import { PROTOCOL_VERSION } from "../../../contracts/protocol/src/types.js";
import type {
  CommandReceipt,
  ContextIngestReceipt,
  ContextSignal,
  DisplayRegistry,
} from "../../../contracts/protocol/src/types.js";
import type { ScenarioDefinition, ScenarioStep } from "../../../contracts/scenarios/src/types.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/index.js";

export interface ScenarioRunnerOptions {
  runtime: CoreRuntime;
  registry: DisplayRegistry;
  now?: () => number;
  sleep?: (durationMs: number) => Promise<void>;
  /** 1 follows authored timing; 0 replays immediately; values between them accelerate a run. */
  timeScale?: number;
}

export interface ScenarioRunResult {
  scenarioId: string;
  startedAt: number;
  finishedAt: number;
  completedSteps: number;
  commandReceipts: CommandReceipt[];
  signalReceipts: ContextIngestReceipt[];
}

export class ScenarioRunner {
  private readonly runtime: CoreRuntime;
  private readonly registry: DisplayRegistry;
  private readonly now: () => number;
  private readonly sleep: (durationMs: number) => Promise<void>;
  private readonly timeScale: number;

  constructor(options: ScenarioRunnerOptions) {
    this.runtime = options.runtime;
    this.registry = options.registry;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? delay;
    this.timeScale = options.timeScale ?? 1;
    if (!Number.isFinite(this.timeScale) || this.timeScale < 0) {
      throw new Error("INVALID_SCENARIO_TIME_SCALE");
    }
  }

  async run(scenario: ScenarioDefinition, startedAt = this.now()): Promise<ScenarioRunResult> {
    assertScenarioDefinition(scenario);
    const commandReceipts: CommandReceipt[] = [];
    const signalReceipts: ContextIngestReceipt[] = [];
    const timeline = [...scenario.timeline].sort(
      (left, right) => left.atMs - right.atMs,
    );
    const traceId = `scenario:${scenario.id}`;

    for (const step of timeline) {
      await this.sleepUntil(startedAt + step.atMs * this.timeScale);
      if (step.kind === "signal") {
        const signal: ContextSignal = {
          signalId: `sim:${scenario.id}:${step.id}`,
          type: step.signal.type,
          value: step.signal.value,
          source: "simulated",
          timestamp: startedAt + step.atMs,
          freshness: "fresh",
          ...(step.signal.confidence === undefined
            ? {}
            : { confidence: step.signal.confidence }),
        };
        signalReceipts.push(this.runtime.ingestSignal(signal, traceId));
      } else if (step.kind === "command") {
        const display = findEnabledDisplay(this.registry, step.displayId);
        if (!display) throw new Error(`SCENARIO_DISPLAY_NOT_ENABLED:${step.displayId}`);
        commandReceipts.push(
          this.runtime.submitCommand({
            protocolVersion: PROTOCOL_VERSION,
            kind: "command",
            messageId: `sim:${scenario.id}:${step.id}`,
            commandId: `sim:${scenario.id}:${step.id}`,
            sessionId: this.runtime.sessionId,
            traceId,
            sentAt: startedAt + step.atMs,
            sender: { displayId: display.displayId, deviceId: display.deviceId },
            command: step.command,
          }),
        );
      } else {
        this.runtime.startTask({
          ...step.task,
          traceId,
        });
      }
    }

    return {
      scenarioId: scenario.id,
      startedAt,
      finishedAt: this.now(),
      completedSteps: timeline.length,
      commandReceipts,
      signalReceipts,
    };
  }

  private async sleepUntil(deadline: number): Promise<void> {
    const remaining = deadline - this.now();
    if (remaining > 0) await this.sleep(remaining);
  }
}

export function loadScenarioFile(path: string): ScenarioDefinition {
  const absolutePath = resolve(path);
  const parsed: unknown = parse(readFileSync(absolutePath, "utf8"));
  assertScenarioDefinition(parsed);
  return parsed;
}

/** Validate an in-memory scenario with the same schema and ID checks as a YAML file. */
export function assertScenarioDefinition(value: unknown): asserts value is ScenarioDefinition {
  const validator = getScenarioValidator();
  if (!validator(value)) {
    const details = validator.errors?.map((error) => `${error.instancePath} ${error.message}`).join("; ");
    throw new Error(`INVALID_SCENARIO:${details ?? "schema validation failed"}`);
  }
  const stepIds = new Set<string>();
  for (const step of (value as ScenarioDefinition).timeline) {
    if (stepIds.has(step.id)) throw new Error(`DUPLICATE_SCENARIO_STEP_ID:${step.id}`);
    stepIds.add(step.id);
  }
}

let scenarioValidator: ValidateFunction | undefined;

function getScenarioValidator(): ValidateFunction {
  if (scenarioValidator) return scenarioValidator;
  const protocolPath = resolve(process.cwd(), "contracts/protocol/schemas/protocol.schema.json");
  const scenarioPath = resolve(process.cwd(), "contracts/scenarios/schemas/scenario.schema.json");
  const protocolSchema = JSON.parse(readFileSync(protocolPath, "utf8")) as AnySchema;
  const scenarioSchema = JSON.parse(readFileSync(scenarioPath, "utf8")) as AnySchema;
  const ajv = new Ajv.default({ allErrors: true, strict: false });
  ajv.addSchema(protocolSchema);
  const validator = ajv.compile(scenarioSchema);
  scenarioValidator = validator;
  return validator;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs));
}
