import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import type { DisplayRegistration, DisplayRegistry } from "../../../contracts/protocol/src/types.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import { GatewayVoiceOutput } from "../src/gateway-voice-output.js";
import { createIntelligenceStack } from "../src/intelligence.js";
import { HmiGateway } from "../src/hmi-gateway.js";

const registry: DisplayRegistry = {
  version: 1,
  displays: [
    { displayId: "center-main", deviceId: "center-device", role: "center", protocolVersion: 1, enabled: true },
    { displayId: "front-passenger-main", deviceId: "passenger-device", role: "front_passenger", protocolVersion: 1, enabled: true },
  ],
};

test("mock voice transports PCM through WebSocket VAD, routes the canned proposal, frames output, and stops", async () => {
  const oldVoiceMode = process.env.AURA_VOICE_MODE;
  const oldLocalModel = process.env.AURA_LOCAL_MODEL;
  process.env.AURA_VOICE_MODE = "mock";
  delete process.env.AURA_LOCAL_MODEL;

  const runtime = new CoreRuntime({ registry });
  runtime.ingestSignal({
    signalId: "voice-test-driver-load",
    type: "driver.cognitive_load",
    value: { level: "normal", confidence: 1 },
    source: "simulated",
    timestamp: Date.now(),
    confidence: 1,
  }, "voice-test-driver-load-trace");
  const output = new GatewayVoiceOutput((socket, message) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  });
  const intelligence = createIntelligenceStack(runtime, output);
  assert.equal(intelligence.gemini.route, "mock");
  const gateway = new HmiGateway({ runtime, registry, host: "127.0.0.1", port: 0, voice: intelligence.voice, voiceOutput: output });
  const sockets: WebSocket[] = [];
  let statusListener: ((raw: WebSocket.RawData, isBinary: boolean) => void) | undefined;
  try {
    await gateway.start();
    const address = gateway.address();
    assert.ok(address);
    const center = await connect(address, registry.displays[0]!);
    sockets.push(center);
    const passenger = await connect(address, registry.displays[1]!);
    sockets.push(passenger);
    const states: string[] = [];
    statusListener = (raw, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (message.kind === "voice.status") states.push(String(message.state));
    };
    center.on("message", statusListener);

    const listening = waitForMessage(center, (message) => message.kind === "voice.status" && message.state === "LISTENING");
    center.send(JSON.stringify({
      kind: "voice.start", protocolVersion: 1, traceId: "voice-ws-start",
      encoding: "pcm_s16le", sampleRateHz: 16000, channels: 1,
    }));
    await listening;

    const passengerStopError = waitForMessage(passenger, (message) => message.kind === "error");
    passenger.send(JSON.stringify({ kind: "voice.stop", protocolVersion: 1, traceId: "voice-not-owner-stop" }));
    assert.equal((await passengerStopError).code, "VOICE_SESSION_NOT_OWNED");

    const inputTranscript = waitForMessage(center, (message) =>
      message.kind === "voice.transcript" && message.direction === "input");
    const outputTranscript = waitForMessage(center, (message) =>
      message.kind === "voice.transcript" && message.direction === "output");
    const proposalCreated = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { unsubscribe(); reject(new Error("TEST_VOICE_PROPOSAL_TIMEOUT")); }, 3_000);
      const unsubscribe = runtime.eventBus.subscribe((event) => {
        if (event.type !== "proposal.created" || event.traceId !== "voice-ws-start") return;
        clearTimeout(timer);
        unsubscribe();
        resolve();
      });
    });
    const audioStream = collectMockAudio(center);
    center.send(pcmFrame(1200), { binary: true });
    for (let frame = 0; frame < 16; frame += 1) center.send(Buffer.alloc(640), { binary: true });
    const input = await inputTranscript;
    assert.equal(input.text, "Turn the cabin volume up");
    assert.equal(input.traceId, "voice-ws-start");
    assert.equal((await outputTranscript).text, "Mock voice response. The request is ready for local review.");
    await Promise.all([proposalCreated, audioStream]);

    const proposal = runtime.getState().activeProposals.find((item) => item.traceId === "voice-ws-start");
    assert.ok(proposal);
    assert.equal(proposal.status, "awaiting_consent");
    assert.equal(proposal.kind, "CHANGE_CABIN_SETTING");

    const idle = waitForMessage(center, (message) => message.kind === "voice.status" && message.state === "IDLE");
    center.send(JSON.stringify({ kind: "voice.stop", protocolVersion: 1, traceId: "voice-ws-stop" }));
    await idle;
    assert.equal(intelligence.voice.currentState, "IDLE");
    assert.deepEqual(states, ["LISTENING", "TRANSCRIBING", "THINKING", "SPEAKING", "LISTENING", "IDLE"]);
  } finally {
    if (statusListener && sockets[0]) sockets[0].off("message", statusListener);
    for (const socket of sockets) await closeSocket(socket);
    await gateway.close();
    if (oldVoiceMode === undefined) delete process.env.AURA_VOICE_MODE;
    else process.env.AURA_VOICE_MODE = oldVoiceMode;
    if (oldLocalModel === undefined) delete process.env.AURA_LOCAL_MODEL;
    else process.env.AURA_LOCAL_MODEL = oldLocalModel;
  }
});

async function connect(address: string, registration: DisplayRegistration): Promise<WebSocket> {
  const socket = new WebSocket(address);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TEST_SOCKET_OPEN_TIMEOUT")), 2_000);
    socket.once("open", () => { clearTimeout(timer); resolve(); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
  try {
    const welcome = waitForMessage(socket, (message) => message.kind === "welcome");
    const snapshot = waitForMessage(socket, (message) => message.kind === "snapshot");
    socket.send(JSON.stringify({
      kind: "register", protocolVersion: 1, displayId: registration.displayId,
      deviceId: registration.deviceId, traceId: `register-${registration.displayId}`,
    }));
    await Promise.all([welcome, snapshot]);
    return socket;
  } catch (error) {
    socket.terminate();
    throw error;
  }
}

function pcmFrame(sample: number): Buffer {
  const frame = Buffer.alloc(640);
  for (let offset = 0; offset < frame.length; offset += 2) frame.writeInt16LE(sample, offset);
  return frame;
}

function waitForMessage(socket: WebSocket, predicate: (message: Record<string, any>) => boolean): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("message", onMessage); reject(new Error("TEST_MESSAGE_TIMEOUT")); }, 3_000);
    const onMessage = (raw: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return;
      const message = JSON.parse(raw.toString()) as Record<string, any>;
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function collectMockAudio(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    let starts = 0;
    let ends = 0;
    let binaryFrames = 0;
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`TEST_AUDIO_FRAMING_TIMEOUT:start=${starts},end=${ends},binary=${binaryFrames}`));
    }, 3_000);
    const onMessage = (raw: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        binaryFrames += 1;
        assert.equal(rawToBuffer(raw).length, 640);
      } else {
        const message = JSON.parse(raw.toString()) as Record<string, any>;
        if (message.kind !== "voice.audio") return;
        if (message.phase === "start") starts += 1;
        if (message.phase === "end") ends += 1;
      }
      if (starts !== 3 || ends !== 3 || binaryFrames !== 3) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve();
    };
    socket.on("message", onMessage);
  });
}

function rawToBuffer(raw: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw);
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  if (socket.readyState === WebSocket.CONNECTING) { socket.terminate(); return; }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { socket.terminate(); reject(new Error("TEST_SOCKET_CLOSE_TIMEOUT")); }, 2_000);
    socket.once("close", () => { clearTimeout(timer); resolve(); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
    socket.close(1000, "test complete");
  });
}
