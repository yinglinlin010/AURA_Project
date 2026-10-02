import WebSocket from "ws";
import { PROTOCOL_VERSION, type ServerMessage } from "../../../contracts/protocol/src/types.js";
import type { VoiceOutputPort } from "../../../packages/core-runtime/src/voice-runtime.js";

/** Streams Gemini PCM output only to the HMI connection that owns the voice turn. */
export class GatewayVoiceOutput implements VoiceOutputPort {
  private target: WebSocket | undefined;
  private traceId = "voice-audio";
  private readonly publish: (socket: WebSocket, message: ServerMessage) => void;

  constructor(publish: (socket: WebSocket, message: ServerMessage) => void) {
    this.publish = publish;
  }

  bind(socket: WebSocket | undefined, traceId?: string): void {
    this.target = socket;
    if (traceId) this.traceId = traceId;
  }

  async playAudio(data: Buffer, mimeType: string, signal: AbortSignal): Promise<void> {
    const socket = this.target;
    if (!socket || socket.readyState !== WebSocket.OPEN || signal.aborted) return;
    const traceId = this.traceId;
    this.publish(socket, { kind: "voice.audio", protocolVersion: PROTOCOL_VERSION, traceId, phase: "start", mimeType });
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted || socket.readyState !== WebSocket.OPEN) return resolve();
      socket.send(data, { binary: true }, (error) => error ? reject(error) : resolve());
    });
    this.publish(socket, { kind: "voice.audio", protocolVersion: PROTOCOL_VERSION, traceId, phase: "end", mimeType });
  }

  stopPlayback(): void {
    // AbortSignal fences queued output frames; there is no independent device buffer here.
  }

  setAudioDucked(_ducked: boolean): void {
    // In-vehicle output ports can implement ducking; the HMI socket has no local mixer.
  }
}
