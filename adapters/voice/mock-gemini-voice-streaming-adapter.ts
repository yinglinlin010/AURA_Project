import type { ProposalSource } from "../../packages/core-runtime/src/intelligence-router.js";
import type { VoiceProvider, VoiceProviderEvent } from "../../packages/core-runtime/src/voice-runtime.js";

/** Credential-free transport simulator. It exercises PCM framing, local VAD, and Action Gate routing. */
export class MockGeminiVoiceStreamingAdapter implements VoiceProvider, ProposalSource {
  readonly modelName = "mock-gemini-live";
  private readonly listeners = new Set<(event: VoiceProviderEvent) => void>();
  private isConnected = false;
  private speechActive = false;
  private speaking = false;
  private silenceMs = 0;
  private traceId = "mock-voice";
  private closed = false;

  get connected(): boolean { return this.isConnected; }

  subscribe(listener: (event: VoiceProviderEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(traceId: string): Promise<void> {
    this.traceId = traceId;
    this.closed = false;
    this.isConnected = true;
  }

  sendAudioChunk(data: Buffer, _mimeType = "audio/pcm;rate=16000", traceId?: string): void {
    if (!this.isConnected || this.closed) throw new Error("VOICE_SESSION_NOT_CONNECTED");
    if (traceId) this.traceId = traceId;
    if (data.length === 0 || data.length % 2 !== 0) throw new Error("INVALID_PCM_S16LE_FRAME");
    const voiced = pcmRms(data) >= 420;
    if (voiced) {
      if (!this.speechActive && this.speaking) this.emit({ type: "interrupted" });
      this.speechActive = true;
      this.silenceMs = 0;
      return;
    }
    if (!this.speechActive) return;
    this.silenceMs += data.length / 2 / 16000 * 1000;
    if (this.silenceMs >= 320) this.finishSpeech();
  }

  sendText(text: string, traceId?: string): void {
    if (!this.isConnected || this.closed) throw new Error("VOICE_SESSION_NOT_CONNECTED");
    if (traceId) this.traceId = traceId;
    this.handleTranscript(text);
  }

  async proposeFromText(input: { text: string; traceId: string }): Promise<unknown> {
    if (!this.isConnected) await this.connect(input.traceId);
    this.traceId = input.traceId;
    return makeMockCandidate(input.text);
  }

  async interrupt(_traceId: string, _reasonCode?: string): Promise<void> {
    this.closed = true;
    this.isConnected = false;
    this.speechActive = false;
    this.speaking = false;
  }

  close(): void {
    this.closed = true;
    this.isConnected = false;
    this.speechActive = false;
    this.speaking = false;
  }

  private finishSpeech(): void {
    this.speechActive = false;
    this.silenceMs = 0;
    // PCM alone cannot be transcribed by the mock; this fixed phrase makes the full route demonstrable.
    this.handleTranscript("Turn the cabin volume up");
  }

  private handleTranscript(text: string): void {
    this.emit({ type: "input_transcription", text, isFinal: true });
    this.emit({ type: "proposal_candidate", candidate: makeMockCandidate(text), traceId: this.traceId });
    this.emit({ type: "output_transcription", text: "Mock voice response. The request is ready for local review." });
    this.speaking = true;
    // Three small PCM frames exercise downstream audio framing without pretending to synthesize speech.
    for (let i = 0; i < 3; i++) this.emit({ type: "audio_chunk", data: Buffer.alloc(640), mimeType: "audio/pcm;rate=24000" });
    this.emit({ type: "turn_complete" });
  }

  private emit(event: VoiceProviderEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* Keep one consumer from interrupting the mock transport. */ }
    }
  }
}

function pcmRms(data: Buffer): number {
  let sum = 0;
  const samples = data.length / 2;
  for (let offset = 0; offset < data.length; offset += 2) {
    const sample = data.readInt16LE(offset);
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples);
}

function makeMockCandidate(text: string): unknown {
  const normalized = text.toLowerCase();
  const increase = /\b(up|increase|raise|louder)\b/.test(normalized);
  return {
    kind: "CHANGE_CABIN_SETTING",
    summary: increase ? "Increase cabin audio volume" : "Adjust cabin audio volume",
    targetRole: "center",
    priority: "normal",
    requiresConsent: true,
    payload: { setting: "media_volume", adjustment: increase ? "up" : "requested", source: "voice" },
  };
}
