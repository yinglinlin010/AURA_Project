import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv, { type AnySchema, type ValidateFunction } from "ajv";
import type { ActionProposalCandidate } from "../../packages/core-runtime/src/intelligence-router.js";

const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
const DEFAULT_TIMEOUT_MS = 5_000;
const LABEL_SCHEMA_PATH = "ml/aura_distill/data/label.schema.json";

export interface OllamaProposalModelOptions {
  model: string;
  host?: string;
  timeoutMs?: number;
}

interface ProposalLabel {
  decision: "proposal";
  candidate: {
    kind: "CHANGE_CABIN_SETTING";
    summary: string;
    targetRole: "center";
    priority: "normal";
    requiresConsent: true;
    payload:
      | { setting: "volume"; direction: "up" | "down" }
      | { setting: "temperature_celsius"; value: number };
  };
}

interface AbstainLabel {
  decision: "abstain";
  reason: "ambiguous" | "unsupported" | "out_of_scope";
}

/**
 * Calls an explicitly selected Ollama model for bounded cabin-setting extraction.
 * It never loads or downloads a model; Ollama must already have it available.
 */
export class OllamaProposalModel {
  readonly modelName: string;
  private readonly host: string;
  private readonly timeoutMs: number;
  private validator: ValidateFunction | undefined;
  private labelSchema: AnySchema | undefined;

  constructor(options: OllamaProposalModelOptions) {
    const model = options.model.trim();
    if (!model) throw new Error("OLLAMA_MODEL_NOT_CONFIGURED");
    this.modelName = model;
    this.host = options.host?.trim() || DEFAULT_OLLAMA_HOST;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("OLLAMA_TIMEOUT_INVALID");
    }
  }

  async proposeStudentCandidate(input: {
    text: string;
    traceId: string;
    signal?: AbortSignal;
  }): Promise<ActionProposalCandidate | undefined> {
    if (input.signal?.aborted) throw abortReason(input.signal);
    const schema = this.getLabelSchema();
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("OLLAMA_REQUEST_TIMEOUT"));
    }, this.timeoutMs);

    try {
      const endpoint = new URL("/api/generate", this.host.endsWith("/") ? this.host : `${this.host}/`);
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.modelName,
            system: [
              "Classify only the user's request for the narrow cabin-setting extraction task.",
              "Return exactly one JSON object matching the supplied schema.",
              "Abstain for ambiguity, unsupported requests, safety requests, or anything outside cabin volume/temperature.",
              "Never propose vehicle control, safety actions, tools, consent, policy decisions, or execution.",
              "The candidate metadata in the schema is fixed; do not alter it.",
              "Follow the examples and classify the final utterance only.",
            ].join(" "),
            prompt: buildClassificationPrompt(input.text),
            format: schema,
            stream: false,
            ...(isQwen3Model(this.modelName) ? { think: false } : {}),
            options: { temperature: 0, num_predict: 256 },
          }),
        });
      } catch {
        if (timedOut) throw new Error("OLLAMA_REQUEST_TIMEOUT");
        if (input.signal?.aborted) throw abortReason(input.signal);
        throw new Error("OLLAMA_UNAVAILABLE");
      }

      if (!response.ok) throw new Error(`OLLAMA_HTTP_${response.status}`);
      let envelope: unknown;
      try {
        envelope = await response.json() as unknown;
      } catch {
        throw new Error("OLLAMA_RESPONSE_INVALID_JSON");
      }
      if (!isRecord(envelope) || typeof envelope.response !== "string") {
        throw new Error("OLLAMA_RESPONSE_MALFORMED");
      }

      let label: unknown;
      try {
        label = JSON.parse(envelope.response) as unknown;
      } catch {
        throw new Error("OLLAMA_LABEL_INVALID_JSON");
      }
      if (!this.validator?.(label)) throw new Error("OLLAMA_LABEL_SCHEMA_REJECTED");

      const parsed = label as ProposalLabel | AbstainLabel;
      if (parsed.decision === "abstain") return undefined;

      // Rebuild the candidate with trusted metadata. Model-supplied fixed fields
      // are schema-checked, then discarded rather than used as authority.
      return {
        kind: "CHANGE_CABIN_SETTING",
        summary: parsed.candidate.summary,
        targetRole: "center",
        priority: "normal",
        requiresConsent: true,
        payload: structuredClone(parsed.candidate.payload),
      };
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private getLabelSchema(): AnySchema {
    if (this.labelSchema) return this.labelSchema;
    const schemaPath = resolve(process.cwd(), LABEL_SCHEMA_PATH);
    let schema: unknown;
    try {
      schema = JSON.parse(readFileSync(schemaPath, "utf8")) as unknown;
    } catch {
      throw new Error("OLLAMA_LABEL_SCHEMA_UNAVAILABLE");
    }
  const ajv = new Ajv.default({ allErrors: true, strict: false });
    const validator = ajv.compile(schema as AnySchema);
    this.validator = validator;
    this.labelSchema = schema as AnySchema;
    return this.labelSchema;
  }
}

function buildClassificationPrompt(utterance: string): string {
  const proposal = (summary: string, setting: "volume" | "temperature_celsius", value: "up" | "down" | number): ProposalLabel => ({
    decision: "proposal",
    candidate: {
      kind: "CHANGE_CABIN_SETTING",
      summary,
      targetRole: "center",
      priority: "normal",
      requiresConsent: true,
      payload: setting === "volume"
        ? { setting, direction: value as "up" | "down" }
        : { setting, value: value as number },
    },
  });
  const examples = [
    ["Raise the cabin volume", proposal("Increase cabin audio volume", "volume", "up")],
    ["把車內音量調大", proposal("Increase cabin audio volume", "volume", "up")],
    ["Set the cabin temperature to 22 C", proposal("Set cabin temperature to 22 degrees", "temperature_celsius", 22)],
    ["把冷氣溫度設為 22 度", proposal("Set cabin temperature to 22 degrees", "temperature_celsius", 22)],
    ["Make it cooler", { decision: "abstain", reason: "ambiguous" }],
    ["Find me a restaurant", { decision: "abstain", reason: "unsupported" }],
    ["Brake now and steer left", { decision: "abstain", reason: "out_of_scope" }],
  ] as const;
  const renderedExamples = examples.map(([input, label]) =>
    `Input: ${input}\nLabel: ${JSON.stringify(label)}`,
  ).join("\n");
  return [
    "Allowed task: cabin_setting_extraction",
    "Allowed settings: volume, temperature_celsius",
    "Examples:",
    renderedExamples,
    "Now classify only this utterance:",
    `Utterance: ${JSON.stringify(utterance)}`,
  ].join("\n");
}

function isQwen3Model(modelName: string): boolean {
  return /^qwen3(?::|$)/i.test(modelName.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("LOCAL_MODEL_ABORTED");
}
