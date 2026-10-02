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
  kind: Exclude<ActionKind, "WARN">;
  summary: string;
  targetRole: DisplayRole;
  priority: "secondary" | "normal";
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

export interface StudentIntentModel {
  readonly modelName?: string;
  proposeStudentCandidate(input: {
    text: string;
    traceId: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
}

export interface IntelligenceRouterOptions {
  runtime: CoreRuntime;
  cloud: ProposalSource;
  local: LocalIntentModel;
  student?: StudentIntentModel;
  /** Enables the optional student candidate only for offline or cloud-fallback continuity. */
  enableStudentLocal?: boolean;
  trace?: TraceSink;
  now?: () => number;
  stopVoice?: (traceId: string) => Promise<void> | void;
}

export interface IntelligenceResult {
  requestId: string;
  traceId: string;
  route: "local" | "cloud";
  availability?: "cloud" | "local" | "offline_local" | "unavailable";
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
];

const candidateValidator = new Ajv.default({ allErrors: true, strict: false }).compile({
  type: "object",
  required: ["kind", "summary", "targetRole", "priority", "requiresConsent", "payload"],
  properties: {
    kind: { enum: actionKinds },
    summary: { type: "string", minLength: 1, maxLength: 500 },
    targetRole: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,63}$" },
    priority: { enum: ["secondary", "normal"] },
    requiresConsent: { type: "boolean" },
    payload: { type: "object" },
  },
  additionalProperties: false,
});

export class IntelligenceRouter {
  private readonly runtime: CoreRuntime;
  private readonly cloud: ProposalSource;
  private readonly local: LocalIntentModel;
  private readonly student: StudentIntentModel | undefined;
  private readonly enableStudentLocal: boolean;
  private readonly trace: TraceSink;
  private readonly now: () => number;
  private readonly stopVoice: ((traceId: string) => Promise<void> | void) | undefined;

  constructor(options: IntelligenceRouterOptions) {
    this.runtime = options.runtime;
    this.cloud = options.cloud;
    this.local = options.local;
    this.student = options.student;
    this.enableStudentLocal = options.enableStudentLocal ?? options.student !== undefined;
    this.trace = options.trace ?? new StructuredTraceSink();
    this.now = options.now ?? Date.now;
    this.stopVoice = options.stopVoice;
  }

  async handle(request: IntentRequest, signal?: AbortSignal): Promise<IntelligenceResult> {
    const startedAt = this.now();
    const stopIntent = isStopIntent(request.text);
    const localCommand = this.local.proposeDeterministicCommand(request.text);
    const explicitlyOffline = this.runtime.getState().connectivity.mode === "offline";
    let route: "local" | "cloud" = stopIntent || localCommand || explicitlyOffline ? "local" : "cloud";
    let fallbackReason: string | undefined;
    let availability: IntelligenceResult["availability"] = explicitlyOffline
      ? "offline_local"
      : localCommand || stopIntent
        ? "local"
        : "cloud";
    let modelName: string | undefined = localCommand ? this.local.modelName : undefined;

    if (stopIntent) {
      await this.stopVoice?.(request.traceId);
      const result: IntelligenceResult = {
        requestId: request.requestId,
        traceId: request.traceId,
        route: "local",
        availability: explicitlyOffline ? "offline_local" : "local",
        replyText: "Stopped.",
      };
      this.recordTrace(request, startedAt, "ok", route);
      return result;
    }

    let candidate: unknown;
    if (localCommand) {
      candidate = localCommand;
    } else if (explicitlyOffline) {
      fallbackReason = "CONNECTIVITY_OFFLINE";
      if (this.enableStudentLocal && this.student) {
        try {
          const localCandidate = await this.student.proposeStudentCandidate({
            text: request.text,
            traceId: request.traceId,
            ...(signal === undefined ? {} : { signal }),
          });
          if (localCandidate !== undefined) {
            candidate = validateCandidate(localCandidate);
            modelName = this.student.modelName;
          }
        } catch (error) {
          if (signal?.aborted) throw signal.reason ?? error;
          fallbackReason = `CONNECTIVITY_OFFLINE:${reasonCode(error)}`;
        }
      }
      if (candidate === undefined) {
        candidate = this.local.proposeDeterministicCommand(request.text);
        modelName = candidate ? this.local.modelName : undefined;
      }
    } else {
      if (signal?.aborted) throw signal.reason ?? new Error("INTENT_ABORTED");
      route = "cloud";
      modelName = this.cloud.modelName;
      try {
        const cloudCandidate = await this.cloud.proposeFromText({
          text: request.text,
          traceId: request.traceId,
          ...(signal === undefined ? {} : { signal }),
        });
        if (this.runtime.getState().connectivity.mode === "offline") {
          fallbackReason = "CONNECTIVITY_CHANGED_DURING_CLOUD_REQUEST";
          route = "local";
          availability = "offline_local";
          if (this.enableStudentLocal && this.student) {
            try {
              candidate = await this.student.proposeStudentCandidate({
                text: request.text,
                traceId: request.traceId,
                ...(signal === undefined ? {} : { signal }),
              });
              if (candidate !== undefined) {
                candidate = validateCandidate(candidate);
                modelName = this.student.modelName;
              }
            } catch (localError) {
              if (signal?.aborted) throw signal.reason ?? localError;
              fallbackReason = `${fallbackReason}:${reasonCode(localError)}`.slice(0, 128);
              candidate = undefined;
            }
          }
          if (candidate === undefined) {
            candidate = this.local.proposeDeterministicCommand(request.text);
            modelName = candidate ? this.local.modelName : undefined;
          }
        } else {
          candidate = cloudCandidate;
          this.runtime.updateConnectivity({
            mode: "online",
            source: "derived",
            evidence: "CLOUD_PROVIDER_RESPONDED",
            traceId: request.traceId,
          });
        }
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        const cloudFailure = reasonCode(error);
        const becameOffline = this.runtime.getState().connectivity.mode === "offline";
        if (!becameOffline) {
          this.runtime.updateConnectivity({
            mode: "degraded",
            source: "derived",
            evidence: `CLOUD_PROVIDER_FAILURE:${cloudFailure}`.slice(0, 128),
            traceId: request.traceId,
          });
        }
        fallbackReason = becameOffline ? "CONNECTIVITY_CHANGED_DURING_CLOUD_REQUEST" : cloudFailure;
        route = "local";
        availability = becameOffline ? "offline_local" : "local";
        candidate = undefined;
        if (this.enableStudentLocal && this.student) {
          try {
            const localCandidate = await this.student.proposeStudentCandidate({
              text: request.text,
              traceId: request.traceId,
              ...(signal === undefined ? {} : { signal }),
            });
            if (localCandidate !== undefined) {
              candidate = validateCandidate(localCandidate);
              modelName = this.student.modelName;
            }
          } catch (localError) {
            if (signal?.aborted) throw signal.reason ?? localError;
            fallbackReason = `${fallbackReason}:${reasonCode(localError)}`.slice(0, 128);
          }
        }
        if (candidate === undefined) {
          candidate = this.local.proposeDeterministicCommand(request.text);
          modelName = candidate ? this.local.modelName : undefined;
        }
      }
    }

    if (candidate === undefined) {
      const result: IntelligenceResult = {
        requestId: request.requestId,
        traceId: request.traceId,
        route,
        availability: candidate === undefined ? "unavailable" : availability,
        replyText: "No supported action was produced; no action was submitted.",
        ...(fallbackReason === undefined ? {} : { fallbackReason }),
      };
      this.recordTrace(request, startedAt, fallbackReason ? "fallback" : "ok", route, fallbackReason, undefined, modelName);
      return result;
    }

    let validated: ActionProposalCandidate;
    try {
      validated = validateCandidate(candidate);
    } catch (error) {
      fallbackReason = reasonCode(error);
      const invalidCloudCandidate = route === "cloud";
      route = "local";
      availability = explicitlyOffline ? "offline_local" : "local";
      if (invalidCloudCandidate) {
        this.runtime.updateConnectivity({
          mode: "degraded",
          source: "derived",
          evidence: `CLOUD_PROPOSAL_INVALID:${fallbackReason}`.slice(0, 128),
          traceId: request.traceId,
        });
      }
      let localCandidate: unknown;
      if (invalidCloudCandidate && this.enableStudentLocal && this.student) {
        try {
          localCandidate = await this.student.proposeStudentCandidate({
            text: request.text,
            traceId: request.traceId,
            ...(signal === undefined ? {} : { signal }),
          });
          if (localCandidate !== undefined) modelName = this.student.modelName;
        } catch (localError) {
          if (signal?.aborted) throw signal.reason ?? localError;
          fallbackReason = `${fallbackReason}:${reasonCode(localError)}`.slice(0, 128);
        }
      }
      localCandidate ??= this.local.proposeDeterministicCommand(request.text);
      if (localCandidate === undefined) {
        const result: IntelligenceResult = {
          requestId: request.requestId,
          traceId: request.traceId,
          route,
          availability: "unavailable",
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
          availability: "unavailable",
          replyText: "The local command could not be validated, so no action was submitted.",
          fallbackReason: "LOCAL_PROPOSAL_SCHEMA_REJECTED",
        };
        this.recordTrace(request, startedAt, "fallback", route, "LOCAL_PROPOSAL_SCHEMA_REJECTED");
        return result;
      }
    }
    return this.commitProposal(request, validated, route, startedAt, fallbackReason, modelName, availability);
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
    if (this.runtime.getState().connectivity.mode === "offline") {
      const result: IntelligenceResult = {
        requestId: request.requestId,
        traceId: request.traceId,
        route: "cloud",
        availability: "unavailable",
        replyText: "Cloud connectivity is offline; the streamed proposal was not submitted.",
        fallbackReason: "CONNECTIVITY_OFFLINE",
      };
      this.recordTrace(request, startedAt, "fallback", "cloud", "CONNECTIVITY_OFFLINE");
      return result;
    }
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
    modelName?: string,
    availability?: IntelligenceResult["availability"],
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
      availability: availability ?? (this.runtime.getState().connectivity.mode === "offline" ? "offline_local" : route),
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
      modelName,
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
    modelName?: string,
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
      model: modelName ?? (route === "cloud"
        ? this.cloud.modelName ?? "cloud-reasoning"
        : this.local.modelName ?? "local-deterministic"),
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
