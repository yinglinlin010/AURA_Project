import {
  GoogleGenAI,
  Modality,
  type LiveConnectConfig,
  type LiveConnectParameters,
  type LiveServerMessage,
} from "@google/genai";
import { StructuredTraceSink, type TraceSink } from "../../packages/core-runtime/src/tracing.js";
import type { ProposalSource } from "../../packages/core-runtime/src/intelligence-router.js";
import type { VoiceProvider, VoiceProviderEvent } from "../../packages/core-runtime/src/voice-runtime.js";
import { DEFAULT_BRAND } from "../../packages/core-domain/src/brand.js";

export type GeminiVoiceEvent = VoiceProviderEvent;

export interface GeminiVoiceAdapterOptions {
  sessionId?: string;
  apiKey?: string;
  model?: string;
  voiceName?: string;
  trace?: TraceSink;
  now?: () => number;
  proposalTimeoutMs?: number;
  assistantName?: string;
  connectTimeoutMs?: number;
  liveConnector?: (apiKey: string, parameters: LiveConnectParameters) => Promise<Awaited<ReturnType<GoogleGenAI["live"]["connect"]>>>;
}

interface PendingProposal {
  traceId: string;
  resolve: (candidate: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abortListener?: () => void;
}

const proposalFunction = {
  name: "submit_action_proposal",
  description:
    "Return a constrained action proposal for review by the local policy and consent gates. This does not execute the action.",
  parametersJsonSchema: {
    type: "object",
    required: ["kind", "summary", "targetRole", "priority", "requiresConsent", "payload"],
    properties: {
      kind: {
        type: "string",
        enum: [
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
        ],
      },
      summary: { type: "string", minLength: 1, maxLength: 500 },
      targetRole: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,63}$" },
      priority: { type: "string", enum: ["secondary", "normal", "urgent"] },
      requiresConsent: { type: "boolean" },
      payload: { type: "object" },
    },
    additionalProperties: false,
  },
} as const;

function systemInstructionFor(assistantName: string): string {
  return [
  `You are the ${assistantName} in-cabin voice assistant.`,
  "Never call vehicle actuators, execute code, or claim an action has already happened.",
  "When a concrete action is requested, call submit_action_proposal with only the declared fields.",
  "The local policy and consent manager decides whether a proposal may be routed, deferred, rejected, or executed.",
  "For safety-critical signals, defer to the deterministic local Safety Supervisor.",
  "Speak concise responses appropriate for a moving vehicle.",
  ].join(" ");
}

export class GeminiLiveVoiceAdapter implements ProposalSource, VoiceProvider {
  readonly route = "cloud" as const;
  readonly model: string;
  readonly modelName: string;

  private readonly sessionId: string;
  private readonly apiKey: string | undefined;
  private readonly voiceName: string | undefined;
  private readonly trace: TraceSink;
  private readonly now: () => number;
  private readonly proposalTimeoutMs: number;
  private readonly assistantName: string;
  private readonly connectTimeoutMs: number;
  private readonly liveConnector: NonNullable<GeminiVoiceAdapterOptions["liveConnector"]>;
  private readonly listeners = new Set<(event: GeminiVoiceEvent) => void>();
  private session: Awaited<ReturnType<GoogleGenAI["live"]["connect"]>> | undefined;
  private connectPromise: Promise<void> | undefined;
  private rejectConnect: ((error: Error) => void) | undefined;
  private sessionGeneration = 0;
  private pendingProposal: PendingProposal | undefined;
  private currentTraceId = "voice-session";
  private sessionStartedAt = 0;

  constructor(options: GeminiVoiceAdapterOptions = {}) {
    this.sessionId = options.sessionId ?? "unbound-aura-session";
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    this.model = options.model ?? process.env.GEMINI_LIVE_MODEL ?? "gemini-3.8-live";
    this.modelName = this.model;
    this.voiceName = options.voiceName ?? process.env.GEMINI_LIVE_VOICE;
    this.trace = options.trace ?? new StructuredTraceSink();
    this.now = options.now ?? Date.now;
    this.proposalTimeoutMs = options.proposalTimeoutMs ?? 30_000;
    this.assistantName = options.assistantName?.trim() || DEFAULT_BRAND.assistantName;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    if (!Number.isInteger(this.connectTimeoutMs) || this.connectTimeoutMs < 1 || this.connectTimeoutMs > 60_000) {
      throw new Error("INVALID_GEMINI_CONNECT_TIMEOUT");
    }
    this.liveConnector = options.liveConnector ?? ((apiKey, parameters) =>
      new GoogleGenAI({ apiKey }).live.connect(parameters));
  }

  get connected(): boolean {
    return this.session !== undefined;
  }

  subscribe(listener: (event: GeminiVoiceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(traceId: string): Promise<void> {
    if (this.session) return;
    if (this.connectPromise) return this.connectPromise;
    const pending = this.openSession(traceId);
    this.connectPromise = pending;
    try {
      await pending;
    } finally {
      if (this.connectPromise === pending) this.connectPromise = undefined;
    }
  }

  private async openSession(traceId: string): Promise<void> {
    const startedAt = this.now();
    if (!this.apiKey) {
      const fallbackReason = "GEMINI_API_KEY_MISSING";
      this.trace.record({
        sessionId: this.sessionId,
        traceId,
        component: "gemini-live-voice-adapter",
        operation: "connect",
        startedAt,
        durationMs: 0,
        outcome: "error",
        model: this.model,
        fallbackReason,
        rawAudioDropped: true,
      });
      throw new Error(fallbackReason);
    }
    this.currentTraceId = traceId;
    this.sessionStartedAt = startedAt;
    const generation = ++this.sessionGeneration;
    let handshakeSettled = false;
    let rejectHandshake!: (error: Error) => void;
    const handshakeFailure = new Promise<never>((_resolve, reject) => {
      rejectHandshake = reject;
    });
    const failHandshake = (error: Error) => {
      if (handshakeSettled) return;
      handshakeSettled = true;
      rejectHandshake(error);
    };
    this.rejectConnect = failHandshake;
    const config: LiveConnectConfig = {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      systemInstruction: systemInstructionFor(this.assistantName),
      tools: [{ functionDeclarations: [proposalFunction] }],
      ...(this.voiceName
        ? {
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voiceName } },
            },
          }
        : {}),
    };

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const connection = this.liveConnector(this.apiKey, {
        model: this.model,
        config,
        callbacks: {
          onmessage: (message) => {
            if (generation === this.sessionGeneration) this.handleMessage(message);
          },
          onerror: (event) => {
            if (generation !== this.sessionGeneration) return;
            const code = sanitizeReason(event.message || "GEMINI_LIVE_ERROR");
            failHandshake(new Error(code));
            this.emit({ type: "provider_error", reasonCode: code });
          },
          onclose: (event) => {
            const unexpected = generation === this.sessionGeneration;
            if (unexpected) {
              this.session = undefined;
              this.sessionGeneration += 1;
              const closeReason = sanitizeReason(event.reason || "GEMINI_LIVE_CLOSED");
              failHandshake(new Error(closeReason));
              this.rejectPending(new Error(closeReason));
              this.emit({ type: "provider_error", reasonCode: closeReason });
            }
            const reason = sanitizeReason(event.reason || "GEMINI_LIVE_CLOSED");
            this.trace.record({
              sessionId: this.sessionId,
              traceId,
              component: "gemini-live-voice-adapter",
              operation: "live-session",
              startedAt,
              durationMs: Math.max(0, this.now() - startedAt),
              outcome: event.wasClean && !unexpected ? "ok" : "error",
              model: this.model,
              ...(event.wasClean && !unexpected ? {} : { fallbackReason: reason }),
              rawAudioDropped: true,
            });
          },
        },
      });
      void connection.then((lateSession) => {
        if (handshakeSettled || generation !== this.sessionGeneration) lateSession.close();
      }, () => undefined);
      const connectTimeout = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("GEMINI_CONNECT_TIMEOUT")), this.connectTimeoutMs);
      });
      const session = await Promise.race([connection, handshakeFailure, connectTimeout]);
      handshakeSettled = true;
      if (generation !== this.sessionGeneration) {
        session.close();
        return;
      }
      this.session = session;
      this.trace.record({
        sessionId: this.sessionId,
        traceId,
        component: "gemini-live-voice-adapter",
        operation: "connect",
        startedAt,
        durationMs: Math.max(0, this.now() - startedAt),
        outcome: "ok",
        model: this.model,
        rawAudioDropped: true,
      });
    } catch (error) {
      handshakeSettled = true;
      if (generation === this.sessionGeneration) this.sessionGeneration += 1;
      const fallbackReason = sanitizeReason(error instanceof Error ? error.message : "GEMINI_CONNECT_FAILED");
      this.trace.record({
        sessionId: this.sessionId,
        traceId,
        component: "gemini-live-voice-adapter",
        operation: "connect",
        startedAt,
        durationMs: Math.max(0, this.now() - startedAt),
        outcome: "error",
        model: this.model,
        fallbackReason,
        rawAudioDropped: true,
      });
      throw new Error(fallbackReason);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (this.rejectConnect === failHandshake) this.rejectConnect = undefined;
    }
  }

  async proposeFromText(input: {
    text: string;
    traceId: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const startedAt = this.now();
    await this.connect(input.traceId);
    if (!this.session) throw new Error("GEMINI_SESSION_UNAVAILABLE");
    if (this.pendingProposal) throw new Error("GEMINI_PROPOSAL_REQUEST_IN_PROGRESS");
    if (input.signal?.aborted) throw new Error("INTENT_CANCELLED");
    this.currentTraceId = input.traceId;

    return new Promise((resolveProposal, rejectProposal) => {
      const timeout = setTimeout(() => {
        this.clearPendingProposal();
        const reason = "GEMINI_PROPOSAL_TIMEOUT";
        this.recordProposalTrace(input.traceId, startedAt, "error", reason);
        rejectProposal(new Error(reason));
      }, this.proposalTimeoutMs);
      const pending: PendingProposal = {
        traceId: input.traceId,
        resolve: (candidate) => {
          this.clearPendingProposal();
          this.recordProposalTrace(input.traceId, startedAt, "ok");
          resolveProposal(candidate);
        },
        reject: (error) => {
          this.clearPendingProposal();
          const reason = sanitizeReason(error.message);
          this.recordProposalTrace(input.traceId, startedAt, "error", reason);
          rejectProposal(new Error(reason));
        },
        timeout,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      };
      if (input.signal) {
        pending.abortListener = () => pending.reject(new Error("INTENT_CANCELLED"));
        input.signal.addEventListener("abort", pending.abortListener, { once: true });
      }
      this.pendingProposal = pending;

      try {
        this.session?.sendClientContent({
          turns: [
            {
              role: "user",
              parts: [
                {
                  text: `Treat this as the user's latest in-cabin request. Return an action proposal only if an action is needed. Request: ${input.text}`,
                },
              ],
            },
          ],
          turnComplete: true,
        });
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error("GEMINI_REQUEST_SEND_FAILED"));
      }
    });
  }

  sendAudioChunk(data: Buffer, mimeType = "audio/pcm;rate=16000", traceId?: string): void {
    if (!this.session) throw new Error("GEMINI_SESSION_NOT_CONNECTED");
    if (traceId) this.currentTraceId = traceId;
    this.session.sendRealtimeInput({
      audio: { data: data.toString("base64"), mimeType },
    });
  }

  sendText(text: string, traceId?: string): void {
    if (!this.session) throw new Error("GEMINI_SESSION_NOT_CONNECTED");
    if (traceId) this.currentTraceId = traceId;
    this.session.sendRealtimeInput({ text });
  }

  async interrupt(traceId: string, reasonCode = "VOICE_INTERRUPTED"): Promise<void> {
    this.rejectConnect?.(new Error(reasonCode));
    const session = this.session;
    this.session = undefined;
    this.sessionGeneration += 1;
    this.rejectPending(new Error(reasonCode));
    session?.close();
    this.emit({ type: "interrupted" });
    this.trace.record({
      sessionId: this.sessionId,
      traceId,
      component: "gemini-live-voice-adapter",
      operation: "interrupt",
      startedAt: this.now(),
      durationMs: 0,
      outcome: "cancelled",
      model: this.model,
      fallbackReason: reasonCode,
      rawAudioDropped: true,
    });
  }

  close(): void {
    this.rejectConnect?.(new Error("VOICE_SESSION_CLOSED"));
    const session = this.session;
    this.session = undefined;
    this.sessionGeneration += 1;
    this.rejectPending(new Error("VOICE_SESSION_CLOSED"));
    session?.close();
  }

  private handleMessage(message: LiveServerMessage): void {
    const content = message.serverContent;
    const inputTranscription = content?.inputTranscription;
    if (inputTranscription?.text) {
      this.emit({
        type: "input_transcription",
        text: inputTranscription.text,
        isFinal: "finished" in inputTranscription && inputTranscription.finished === true,
      });
    }
    if (content?.outputTranscription?.text) {
      this.emit({ type: "output_transcription", text: content.outputTranscription.text });
    }
    for (const part of content?.modelTurn?.parts ?? []) {
      const inlineData = part.inlineData;
      if (inlineData?.data) {
        this.emit({
          type: "audio_chunk",
          data: Buffer.from(inlineData.data, "base64"),
          mimeType: inlineData.mimeType ?? "audio/pcm;rate=24000",
        });
      }
    }
    if (content?.interrupted) {
      this.emit({ type: "interrupted" });
      this.rejectPending(new Error("GEMINI_LIVE_INTERRUPTED"));
    }
    if (content?.turnComplete) this.emit({ type: "turn_complete" });

    for (const call of message.toolCall?.functionCalls ?? []) {
      if (call.name === proposalFunction.name) {
        const pending = this.pendingProposal;
        if (pending) pending.resolve(call.args);
        else this.emit({
          type: "proposal_candidate",
          candidate: call.args,
          traceId: this.currentTraceId,
        });
        if (call.id) {
          this.session?.sendToolResponse({
            functionResponses: [{
              id: call.id,
              name: call.name,
              response: { status: "pending_local_policy_review", executed: false },
            }],
          });
        }
      } else if (call.id && call.name) {
        this.session?.sendToolResponse({
          functionResponses: [
            { id: call.id, name: call.name, response: { status: "unsupported", executed: false } },
          ],
        });
      }
    }
  }

  private emit(event: GeminiVoiceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A client callback must not break the provider's WebSocket receive loop.
      }
    }
  }

  private rejectPending(error: Error): void {
    this.pendingProposal?.reject(error);
  }

  private clearPendingProposal(): void {
    const pending = this.pendingProposal;
    if (!pending) return;
    clearTimeout(pending.timeout);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
    this.pendingProposal = undefined;
  }

  private recordProposalTrace(
    traceId: string,
    startedAt: number,
    outcome: "ok" | "error",
    fallbackReason?: string,
  ): void {
    this.trace.record({
      sessionId: this.sessionId,
      traceId,
      component: "gemini-live-voice-adapter",
      operation: "proposal-request",
      startedAt,
      durationMs: Math.max(0, this.now() - startedAt),
      outcome,
      model: this.model,
      ...(fallbackReason === undefined ? {} : { fallbackReason }),
      rawAudioDropped: true,
    });
  }
}

/** Public integration name for the bidirectional Gemini Live PCM adapter. */
export class GeminiVoiceStreamingAdapter extends GeminiLiveVoiceAdapter {}

function sanitizeReason(value: string): string {
  return value.replace(/[^a-zA-Z0-9_:-]/g, "_").slice(0, 96).toUpperCase() || "GEMINI_LIVE_FAILED";
}
