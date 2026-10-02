import { randomUUID } from "node:crypto";
import { default as Ajv } from "ajv";
import type {
  ActionKind,
  ActionProposal,
  ActionProposalRequest,
  DisplayRole,
  PolicyDecision,
} from "../../../contracts/protocol/src/types.js";
import type { CoreRuntime, RuntimeProposalOutcome } from "./core-runtime.js";
import { StructuredTraceSink, type TraceSink } from "./tracing.js";

export interface IntentRequest {
  requestId: string;
  traceId: string;
  text: string;
  requestedByRole: DisplayRole;
}

export interface ActionProposalCandidate {
  kind: ActionKind;
  summary: string;
  targetRole: DisplayRole;
  priority: "secondary" | "normal" | "urgent";
  requiresConsent: boolean;
  payload: Record<string, unknown>;
}

export interface ProposalSource {
  readonly modelName?: string;
  proposeFromText(input: {
    text: string;
    traceId: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
}

export interface LocalIntentModel {
  readonly modelName?: string;
  proposeDeterministicCommand(text: string): ActionProposalCandidate | undefined;
}

export interface IntelligenceRouterOptions {
  runtime: CoreRuntime;
  cloud: ProposalSource;
  local: LocalIntentModel;
  trace?: TraceSink;
  now?: () => number;
  stopVoice?: (traceId: string) => Promise<void> | void;
}

export interface IntelligenceResult {
  requestId: string;
  traceId: string;
  route: "local" | "cloud";
  replyText?: string;
  proposal?: ActionProposal;
  policyDecision?: PolicyDecision;
  fallbackReason?: string;
}

export interface ProviderProposalInput {
  requestId: string;
  traceId: string;
  requestedByRole: DisplayRole;
  candidate: unknown;
}

const actionKinds: ActionKind[] = [
  "SPEAK",
  "SHOW_INFORMATION",
  "SHOW_GUIDANCE",
  "SEARCH_PLACE",
  "CALCULATE_ROUTE",
  "ADD_TRIP_STOP",
  "START_PARKING_GUIDANCE",
  "HANDOFF_DISPLAY",
  "SUPPRESS_NOTIFICATION",
  "CHANGE_CABIN_SETTING",
  "PREPARE_OFFLINE_CONTEXT",
  "REQUEST_CONFIRMATION",
  "WARN",
];

const candidateValidator = new Ajv.default({ allErrors: true, strict: false }).compile({
  type: "object",
  required: ["kind", "summary", "targetRole", "priority", "requiresConsent", "payload"],
  properties: {
    kind: { enum: actionKinds },
    summary: { type: "string", minLength: 1, maxLength: 500 },
    targetRole: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,63}$" },
    priority: { enum: ["secondary", "normal", "urgent"] },
    requiresConsent: { type: "boolean" },
    payload: { type: "object" },
  },
  additionalProperties: false,
});

export class IntelligenceRouter {
  private readonly runtime: CoreRuntime;
  private readonly cloud: ProposalSource;
  private readonly local: LocalIntentModel;
  private readonly trace: TraceSink;
  private readonly now: () => number;
  private readonly stopVoice: ((traceId: string) => Promise<void> | void) | undefined;

  constructor(options: IntelligenceRouterOptions) {
    this.runtime = options.runtime;
    this.cloud = options.cloud;
    this.local = options.local;
    this.trace = options.trace ?? new StructuredTraceSink();
    this.now = options.now ?? Date.now;
    this.stopVoice = options.stopVoice;
  }

  async handle(request: IntentRequest, signal?: AbortSignal): Promise<IntelligenceResult> {
    const startedAt = this.now();
    const stopIntent = isStopIntent(request.text);
    const localCommand = this.local.proposeDeterministicCommand(request.text);
    let route: "local" | "cloud" = stopIntent || localCommand ? "local" : "cloud";
    let fallbackReason: string | undefined;

    if (stopIntent) {
      await this.stopVoice?.(request.traceId);
      const result: IntelligenceResult = {
        requestId: request.requestId,
        traceId: request.traceId,
        route: "local",
        replyText: "Stopped.",
      };
      this.recordTrace(request, startedAt, "ok", route);
      return result;
    }

    let candidate: unknown;
    if (localCommand) {
      candidate = localCommand;
    } else {
      try {
        candidate = await this.cloud.proposeFromText({
          text: request.text,
          traceId: request.traceId,
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error) {
        route = "local";
        fallbackReason = reasonCode(error);
        candidate = this.local.proposeDeterministicCommand(request.text);
      }
    }

    if (candidate === undefined) {
      const result: IntelligenceResult = {
        requestId: request.requestId,
        traceId: request.traceId,
        route,
        replyText: fallbackReason
          ? "Cloud reasoning is unavailable. I can still handle supported cabin commands locally."
          : "No action proposal was needed.",
        ...(fallbackReason === undefined ? {} : { fallbackReason }),
      };
      this.recordTrace(request, startedAt, fallbackReason ? "fallback" : "ok", route, fallbackReason);
      return result;
    }

    let validated: ActionProposalCandidate;
    try {
      validated = validateCandidate(candidate);
    } catch (error) {
      fallbackReason = reasonCode(error);
      route = "local";
      const localCandidate = this.local.proposeDeterministicCommand(request.text);
      if (!localCandidate) {
        const result: IntelligenceResult = {
          requestId: request.requestId,
          traceId: request.traceId,
          route,
          replyText: "The proposal could not be validated, so no action was submitted.",
          fallbackReason,
        };
        this.recordTrace(request, startedAt, "fallback", route, fallbackReason);
        return result;
      }
      try {
        validated = validateCandidate(localCandidate);
      } catch {
        const result: IntelligenceResult = {
          requestId: request.requestId,
          traceId: request.traceId,
          route,
          replyText: "The local command could not be validated, so no action was submitted.",
          fallbackReason: "LOCAL_PROPOSAL_SCHEMA_REJECTED",
        };
        this.recordTrace(request, startedAt, "fallback", route, "LOCAL_PROPOSAL_SCHEMA_REJECTED");
        return result;
      }
    }
    return this.commitProposal(request, validated, route, startedAt, fallbackReason);
  }

  /** Validates and submits a proposal tool call received during a streamed voice session. */
  handleProviderProposal(input: ProviderProposalInput): IntelligenceResult {
    const startedAt = this.now();
    const request: IntentRequest = {
      requestId: input.requestId,
      traceId: input.traceId,
      text: "",
      requestedByRole: input.requestedByRole,
    };
    let candidate: ActionProposalCandidate;
    try {
      candidate = validateCandidate(input.candidate);
    } catch (error) {
      const fallbackReason = reasonCode(error);
      const result: IntelligenceResult = {
        requestId: request.requestId,
        traceId: request.traceId,
        route: "cloud",
        replyText: "The voice proposal could not be validated, so no action was submitted.",
        fallbackReason,
      };
      this.recordTrace(request, startedAt, "fallback", "cloud", fallbackReason);
      return result;
    }
    return this.commitProposal(request, candidate, "cloud", startedAt);
  }

  private commitProposal(
    request: IntentRequest,
    candidate: ActionProposalCandidate,
    route: "local" | "cloud",
    startedAt: number,
    fallbackReason?: string,
  ): IntelligenceResult {
    const proposalRequest: ActionProposalRequest = {
      ...candidate,
      proposalId: `proposal:${request.requestId}:${randomUUID()}`,
    };
    const outcome: RuntimeProposalOutcome = this.runtime.proposeAction(
      proposalRequest,
      request.requestedByRole,
      request.traceId,
      `intent:${request.requestId}`,
    );
    const result: IntelligenceResult = {
      requestId: request.requestId,
      traceId: request.traceId,
      route,
      proposal: outcome.proposal,
      policyDecision: outcome.decision,
      ...(fallbackReason === undefined ? {} : { fallbackReason }),
    };
    this.recordTrace(
      request,
      startedAt,
      fallbackReason ? "fallback" : "ok",
      route,
      fallbackReason,
      outcome.decision.outcome,
    );
    return result;
  }

  private recordTrace(
    request: IntentRequest,
    startedAt: number,
    outcome: "ok" | "fallback",
    route: "local" | "cloud",
    fallbackReason?: string,
    policyOutcome?: string,
  ): void {
    this.trace.record({
      sessionId: this.runtime.sessionId,
      traceId: request.traceId,
      component: "intelligence-router",
      operation: "handle-intent",
      startedAt,
      durationMs: Math.max(0, this.now() - startedAt),
      outcome,
      route,
      model: route === "cloud"
        ? this.cloud.modelName ?? "cloud-reasoning"
        : this.local.modelName ?? "local-deterministic",
      ...(fallbackReason === undefined ? {} : { fallbackReason }),
      ...(policyOutcome === undefined ? {} : { policyOutcome }),
      rawAudioDropped: true,
    });
  }
}

export function validateCandidate(candidate: unknown): ActionProposalCandidate {
  let value = candidate;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new Error("MODEL_PROPOSAL_INVALID_JSON");
    }
  }
  if (!candidateValidator(value)) throw new Error("MODEL_PROPOSAL_SCHEMA_REJECTED");
  return value as ActionProposalCandidate;
}

function isStopIntent(text: string): boolean {
  return /^\s*(stop|cancel|quiet|be quiet|stop speaking)[.! ]*$/i.test(text);
}

function reasonCode(error: unknown): string {
  if (!(error instanceof Error)) return "CLOUD_REASONING_FAILED";
  const candidate = error.message.replace(/[^A-Z0-9_:-]/gi, "_").slice(0, 96).toUpperCase();
  return candidate || "CLOUD_REASONING_FAILED";
}
