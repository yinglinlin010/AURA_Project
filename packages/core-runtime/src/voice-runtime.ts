import { StructuredTraceSink, type TraceSink } from "./tracing.js";

export type VoiceRuntimeState = "IDLE" | "LISTENING" | "TRANSCRIBING" | "THINKING" | "SPEAKING";

export type VoiceProviderEvent =
  | { type: "input_transcription"; text: string; isFinal: boolean }
  | { type: "output_transcription"; text: string }
  | { type: "proposal_candidate"; candidate: unknown; traceId: string; route?: "local" | "cloud" }
  | { type: "audio_chunk"; data: Buffer; mimeType: string }
  | { type: "turn_complete" }
  | { type: "interrupted" }
  | { type: "provider_error"; reasonCode: string };

export interface VoiceProvider {
  readonly connected: boolean;
  readonly modelName?: string;
  readonly route?: "local" | "mock" | "cloud";
  subscribe(listener: (event: VoiceProviderEvent) => void): () => void;
  connect(traceId: string): Promise<void>;
  sendAudioChunk(data: Buffer, mimeType?: string, traceId?: string): void;
  sendText(text: string, traceId?: string): void;
  interrupt(traceId: string, reasonCode?: string): Promise<void>;
  close(): void;
}

export interface VoiceOutputPort {
  playAudio(data: Buffer, mimeType: string, signal: AbortSignal): Promise<void>;
  stopPlayback(): void;
  setAudioDucked(ducked: boolean): void;
}

export interface VoiceRuntimeOptions {
  sessionId: string;
  adapter: VoiceProvider;
  output: VoiceOutputPort;
  trace?: TraceSink;
  now?: () => number;
  onProposalCandidate?: (input: { candidate: unknown; traceId: string; route?: "local" | "cloud" }) => unknown;
}

export type VoiceRuntimeEvent =
  | { type: "state"; state: VoiceRuntimeState; traceId: string }
  | { type: "transcript"; direction: "input" | "output"; text: string; isFinal: boolean; traceId: string };

export class VoiceRuntime {
  private readonly sessionId: string;
  private readonly adapter: VoiceProvider;
  private readonly output: VoiceOutputPort;
  private readonly trace: TraceSink;
  private readonly now: () => number;
  private readonly onProposalCandidate: VoiceRuntimeOptions["onProposalCandidate"];
  private readonly unsubscribe: () => void;
  private state: VoiceRuntimeState = "IDLE";
  private turnStartedAt = 0;
  private traceId = "voice-idle";
  private playbackController: AbortController | undefined;
  private activeTurnController: AbortController | undefined;
  private playbackChain: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(event: VoiceRuntimeEvent) => void>();

  constructor(options: VoiceRuntimeOptions) {
    this.sessionId = options.sessionId;
    this.adapter = options.adapter;
    this.output = options.output;
    this.trace = options.trace ?? new StructuredTraceSink();
    this.now = options.now ?? Date.now;
    this.onProposalCandidate = options.onProposalCandidate;
    this.unsubscribe = this.adapter.subscribe((event) => this.onAdapterEvent(event));
  }

  get currentState(): VoiceRuntimeState {
    return this.state;
  }

  get turnSignal(): AbortSignal | undefined {
    return this.activeTurnController?.signal;
  }

  subscribe(listener: (event: VoiceRuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(traceId: string): Promise<void> {
    if (this.adapter.connected) {
      if (this.state === "IDLE") {
        this.beginTurn(traceId);
        this.transition("LISTENING");
      } else if (!this.activeTurnController) {
        this.beginTurn(traceId);
      }
      return;
    }
    this.beginTurn(traceId);
    try {
      await this.adapter.connect(traceId);
      this.transition("LISTENING");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "VOICE_CONNECT_FAILED";
      this.activeTurnController = undefined;
      this.recordTurn("fallback", reason);
      this.transition("IDLE");
      throw error;
    }
  }

  async sendAudioChunk(data: Buffer, mimeType = "audio/pcm;rate=16000", traceId = this.traceId): Promise<void> {
    if (!this.adapter.connected || this.state === "IDLE") await this.start(traceId);
    else this.beginTurn(traceId);
    this.adapter.sendAudioChunk(data, mimeType, traceId);
  }

  async sendText(text: string, traceId = this.traceId): Promise<void> {
    if (!this.adapter.connected || this.state === "IDLE") await this.start(traceId);
    else this.beginTurn(traceId);
    this.adapter.sendText(text, traceId);
  }

  async stop(traceId = this.traceId, reasonCode = "VOICE_STOP_COMMAND"): Promise<void> {
    const startedAt = this.now();
    this.activeTurnController?.abort(new Error(reasonCode));
    this.abortPlayback();
    this.output.stopPlayback();
    this.output.setAudioDucked(false);
    await this.adapter.interrupt(traceId, reasonCode);
    this.activeTurnController = undefined;
    this.recordTurn("cancelled", reasonCode);
    this.transition("IDLE");
    this.trace.record({
      sessionId: this.sessionId,
      traceId,
      component: "voice-runtime",
      operation: "stop",
      startedAt,
      durationMs: Math.max(0, this.now() - startedAt),
      outcome: "cancelled",
      fallbackReason: reasonCode,
      rawAudioDropped: true,
    });
  }

  close(): void {
    this.unsubscribe();
    this.activeTurnController?.abort(new Error("VOICE_RUNTIME_CLOSED"));
    this.abortPlayback();
    this.output.stopPlayback();
    this.output.setAudioDucked(false);
    this.adapter.close();
    this.activeTurnController = undefined;
    this.recordTurn("cancelled", "VOICE_RUNTIME_CLOSED");
    this.transition("IDLE");
  }

  private onAdapterEvent(event: VoiceProviderEvent): void {
    switch (event.type) {
      case "input_transcription":
        this.emit({ type: "transcript", direction: "input", text: event.text, isFinal: event.isFinal, traceId: this.traceId });
        if (isStopPhrase(event.text)) {
          void this.stop(this.traceId, "VOICE_STOP_COMMAND");
          return;
        }
        this.transition("TRANSCRIBING");
        if (event.isFinal) this.transition("THINKING");
        break;
      case "output_transcription":
        this.emit({ type: "transcript", direction: "output", text: event.text, isFinal: true, traceId: this.traceId });
        if (this.state !== "SPEAKING") this.transition("THINKING");
        break;
      case "proposal_candidate":
        if (this.onProposalCandidate) {
          void Promise.resolve(this.onProposalCandidate({ candidate: event.candidate, traceId: event.traceId, ...(event.route === undefined ? {} : { route: event.route }) }))
            .catch((error: unknown) => {
              const reason = error instanceof Error ? error.message : "VOICE_PROPOSAL_ROUTING_FAILED";
              this.recordTurn("error", reason);
            });
        }
        break;
      case "audio_chunk":
        this.queueAudio(event.data, event.mimeType);
        break;
      case "interrupted":
        this.activeTurnController?.abort(new Error("VOICE_BARGED_IN"));
        this.activeTurnController = undefined;
        this.abortPlayback();
        this.output.stopPlayback();
        this.output.setAudioDucked(false);
        this.transition("LISTENING");
        this.recordTurn("cancelled", "VOICE_BARGED_IN");
        break;
      case "turn_complete":
        this.finishPlaybackTurn();
        break;
      case "provider_error":
        this.activeTurnController?.abort(new Error(event.reasonCode));
        this.activeTurnController = undefined;
        this.abortPlayback();
        this.output.stopPlayback();
        this.output.setAudioDucked(false);
        this.adapter.close();
        this.transition("IDLE");
        this.recordTurn("fallback", event.reasonCode);
        break;
    }
  }

  private queueAudio(data: Buffer, mimeType: string): void {
    if (!this.playbackController) {
      this.playbackController = new AbortController();
      this.output.setAudioDucked(true);
    }
    this.transition("SPEAKING");
    const controller = this.playbackController;
    this.playbackChain = this.playbackChain
      .catch(() => undefined)
      .then(() => this.output.playAudio(data, mimeType, controller.signal))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          this.recordTurn("error", error instanceof Error ? error.message : "AUDIO_PLAYBACK_FAILED");
        }
      });
  }

  private finishPlaybackTurn(): void {
    const controller = this.playbackController;
    const playback = this.playbackChain;
    void playback.finally(() => {
      if (controller && controller.signal.aborted) return;
      if (controller && this.playbackController !== controller) return;
      this.output.setAudioDucked(false);
      this.playbackController = undefined;
      this.activeTurnController = undefined;
      this.transition("LISTENING");
      this.recordTurn("ok");
    });
  }

  private abortPlayback(): void {
    this.playbackController?.abort(new Error("PLAYBACK_ABORTED"));
    this.playbackController = undefined;
    this.playbackChain = Promise.resolve();
  }

  private beginTurn(traceId: string): void {
    if (this.turnStartedAt !== 0) return;
    this.traceId = traceId;
    this.turnStartedAt = this.now();
    this.activeTurnController = new AbortController();
  }

  private transition(next: VoiceRuntimeState): void {
    if (next === this.state) return;
    const allowed: Record<VoiceRuntimeState, readonly VoiceRuntimeState[]> = {
      IDLE: ["LISTENING"],
      LISTENING: ["TRANSCRIBING", "THINKING", "SPEAKING", "IDLE"],
      TRANSCRIBING: ["THINKING", "SPEAKING", "LISTENING", "IDLE"],
      THINKING: ["SPEAKING", "LISTENING", "IDLE"],
      SPEAKING: ["TRANSCRIBING", "THINKING", "LISTENING", "IDLE"],
    };
    if (!allowed[this.state].includes(next)) return;
    this.state = next;
    this.emit({ type: "state", state: next, traceId: this.traceId });
  }

  private emit(event: VoiceRuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private recordTurn(
    outcome: "ok" | "error" | "fallback" | "cancelled",
    fallbackReason?: string,
  ): void {
    if (!this.turnStartedAt) return;
    this.trace.record({
      sessionId: this.sessionId,
      traceId: this.traceId,
      component: "voice-runtime",
      operation: "voice-turn",
      startedAt: this.turnStartedAt,
      durationMs: Math.max(0, this.now() - this.turnStartedAt),
      outcome,
      model: this.adapter.modelName ?? "voice-provider",
      route: this.adapter.route ?? "cloud",
      ...(fallbackReason === undefined ? {} : { fallbackReason }),
      rawAudioDropped: true,
    });
    this.turnStartedAt = 0;
  }
}

function isStopPhrase(text: string): boolean {
  return /^\s*(stop|cancel|quiet|be quiet|stop speaking)[.! ]*$/i.test(text);
}
