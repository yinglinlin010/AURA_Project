import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import type { DisplayRegistry } from "../../../contracts/protocol/src/types.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import { VoiceRuntime, type VoiceProvider, type VoiceProviderEvent } from "../../../packages/core-runtime/src/voice-runtime.js";
import { HmiGateway } from "../src/hmi-gateway.js";
import { GatewayVoiceOutput } from "../src/gateway-voice-output.js";

const registry: DisplayRegistry = {
  version: 1,
  displays: [
    { displayId: "center-main", deviceId: "center-device", role: "center", protocolVersion: 1, enabled: true },
    { displayId: "window-main", deviceId: "window-device", role: "interactive_window", protocolVersion: 1, enabled: true },
  ],
};

class FakeVoiceProvider implements VoiceProvider {
  connected = false;
  unsubscribed = false;
  private readonly listeners = new Set<(event: VoiceProviderEvent) => void>();
  subscribe(listener: (event: VoiceProviderEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); this.unsubscribed = true; };
  }
  async connect(): Promise<void> { this.connected = true; }
  sendAudioChunk(): void {}
  sendText(): void {}
  async interrupt(): Promise<void> {}
  close(): void { this.connected = false; }
  emit(event: VoiceProviderEvent): void { for (const listener of this.listeners) listener(event); }
}

test("presence snapshots, revisions and transitions are shared across registered displays", async () => {
  const runtime = new CoreRuntime({ registry });
  const provider = new FakeVoiceProvider();
  const voice = new VoiceRuntime({
    sessionId: runtime.sessionId,
    adapter: provider,
    output: { playAudio: async () => {}, stopPlayback: () => {}, setAudioDucked: () => {} },
  });
  const output = new GatewayVoiceOutput(() => {});
  const gateway = new HmiGateway({ runtime, registry, host: "127.0.0.1", port: 0, voice, voiceOutput: output });
  const sockets: WebSocket[] = [];
  await gateway.start();
  const address = gateway.address();
  assert.ok(address);

  const connect = async (displayId: string, deviceId: string): Promise<{ socket: WebSocket; snapshot: Record<string, any> }> => {
    const socket = new WebSocket(address);
    sockets.push(socket);
    await waitOpen(socket);
    socket.send(JSON.stringify({ kind: "register", protocolVersion: 1, displayId, deviceId, traceId: `reg-${displayId}` }));
    const snapshot = await nextMessage(socket, (message) => message.kind === "snapshot");
    return { socket, snapshot: snapshot.snapshot as Record<string, any> };
  };

  try {
    const centerConnection = await connect("center-main", "center-device");
    const windowConnection = await connect("window-main", "window-device");
    const center = centerConnection.socket;
    const window = windowConnection.socket;
    assert.deepEqual(centerConnection.snapshot.presence, { state: "IDLE", revision: 0 });
    assert.deepEqual(windowConnection.snapshot.presence, { state: "IDLE", revision: 0 });

    const centerListening = nextPresence(center, "LISTENING");
    const windowListening = nextPresence(window, "LISTENING");
    const ownerListeningStatus = nextMessage(center, (message) => message.kind === "voice.status" && message.state === "LISTENING", "voice owner listening status");
    const windowStatus = hasMessage(window, (message) => message.kind === "voice.status");
    center.send(JSON.stringify({
      kind: "voice.start", protocolVersion: 1, traceId: "voice-turn",
      encoding: "pcm_s16le", sampleRateHz: 16000, channels: 1,
    }));
    const [listeningA, listeningB] = await Promise.all([centerListening, windowListening]);
    assert.deepEqual(listeningA, { state: "LISTENING", revision: 1 });
    assert.deepEqual(listeningB, listeningA);
    await ownerListeningStatus;
    assert.equal(await windowStatus, false);

    const thinkingCenter = nextPresence(center, "THINKING");
    const thinkingWindow = nextPresence(window, "THINKING");
    provider.emit({ type: "input_transcription", text: "hello", isFinal: true });
    const [thinkingA, thinkingB] = await Promise.all([thinkingCenter, thinkingWindow]);
    assert.deepEqual(thinkingA, { state: "THINKING", revision: 2 });
    assert.deepEqual(thinkingB, thinkingA);

    const speaking = nextPresence(window, "SPEAKING");
    provider.emit({ type: "audio_chunk", data: Buffer.from([0, 0]), mimeType: "audio/pcm;rate=16000" });
    assert.deepEqual(await speaking, { state: "SPEAKING", revision: 3 });
    const listeningAgain = nextPresence(center, "LISTENING");
    provider.emit({ type: "interrupted" });
    assert.deepEqual(await listeningAgain, { state: "LISTENING", revision: 4 });

    const executing = nextPresence(window, "EXECUTING");
    runtime.startTask({ taskId: "active-task", traceId: "task-start", priority: "primary" });
    assert.deepEqual(await executing, { state: "EXECUTING", revision: 5 });
    const listeningAfterTask = nextPresence(center, "LISTENING");
    runtime.completeTask("active-task", "task-end");
    assert.deepEqual(await listeningAfterTask, { state: "LISTENING", revision: 6 });

    const offline = nextPresence(window, "OFFLINE");
    runtime.updateConnectivity({ mode: "offline", source: "simulated", evidence: "test offline", traceId: "offline" });
    assert.deepEqual(await offline, { state: "OFFLINE", revision: 7 });

    await closeSocket(window);
    sockets.splice(sockets.indexOf(window), 1);
    const reconnect = await connect("window-main", "window-device");
    assert.deepEqual(reconnect.snapshot.presence, { state: "OFFLINE", revision: 7 });
    const online = nextPresence(reconnect.socket, "LISTENING");
    runtime.updateConnectivity({ mode: "online", source: "simulated", evidence: "test online", traceId: "online" });
    assert.deepEqual(await online, { state: "LISTENING", revision: 8 });

    const warning = nextPresence(reconnect.socket, "WARNING");
    runtime.ingestSignal({ signalId: "warning-signal", type: "safety.critical", value: { severity: "critical" }, source: "simulated", timestamp: Date.now(), freshness: "fresh" }, "warning-trace");
    assert.deepEqual(await warning, { state: "WARNING", revision: 9 });
  } finally {
    await Promise.all(sockets.map(closeSocket));
    await gateway.close();
  }
  assert.equal(provider.unsubscribed, true);
});

function waitOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function nextMessage(socket: WebSocket, predicate: (message: Record<string, any>) => boolean, label = "message"): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const seen: string[] = [];
    const timer = setTimeout(() => { socket.off("message", onMessage); reject(new Error(`MESSAGE_TIMEOUT ${label}; seen=${seen.slice(-12).join(",")}`)); }, 3000);
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as Record<string, any>;
      seen.push(`${String(message.kind)}:${String(message.code ?? message.presence?.state ?? message.state ?? message.event?.type ?? message.message ?? "")}`);
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function nextPresence(socket: WebSocket, state: string): Promise<{ state: string; revision: number }> {
  return nextMessage(socket, (message) => message.kind === "presence.state.changed" && (message.presence as any)?.state === state, `presence ${state}`)
    .then((message) => message.presence as { state: string; revision: number });
}

async function hasMessage(socket: WebSocket, predicate: (message: Record<string, any>) => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as Record<string, any>;
      if (predicate(message)) { socket.off("message", onMessage); resolve(true); }
    };
    socket.on("message", onMessage);
    setTimeout(() => { socket.off("message", onMessage); resolve(false); }, 50);
  });
}

function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once("close", () => resolve());
    if (socket.readyState === WebSocket.OPEN) socket.close(1000, "test cleanup");
    else socket.terminate();
  });
}
