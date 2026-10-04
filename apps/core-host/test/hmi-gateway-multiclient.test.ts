import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import WebSocket from "ws";
import type { DisplayRegistration, DisplayRegistry } from "../../../contracts/protocol/src/types.js";
import { Gemma2BOfflineSimulator } from "../../../adapters/local/index.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import { IntelligenceRouter } from "../../../packages/core-runtime/src/intelligence-router.js";
import { HmiGateway } from "../src/hmi-gateway.js";

const registry = JSON.parse(readFileSync("apps/core-host/config/display-registry.json", "utf8")) as DisplayRegistry;

interface RegisteredClient {
  socket: WebSocket;
  registration: DisplayRegistration;
  welcome: Record<string, any>;
  snapshot: Record<string, any>;
}

test("independent registered HMI clients share events and receive current state after reconnect", async () => {
  const runtime = new CoreRuntime({ registry, eventHistoryLimit: 2 });
  const gateway = new HmiGateway({ runtime, registry, host: "127.0.0.1", port: 0 });
  await gateway.start();
  const clients: RegisteredClient[] = [];
  try {
    const address = gateway.address();
    assert.ok(address);
    assert.equal(registry.displays.filter((display) => display.enabled).length, 5);

    for (const registration of registry.displays.filter((display) => display.enabled)) {
      clients.push(await connect(address, registration));
    }
    assert.equal(new Set(clients.map((client) => client.socket)).size, 5);
    const sessionIds = new Set(clients.map((client) => client.welcome.sessionId));
    assert.deepEqual([...sessionIds], [runtime.sessionId]);
    assert.ok(clients.every((client) => client.snapshot.snapshot.sessionId === runtime.sessionId));

    const eventWaiters = clients.map((client) => waitForMessage(client.socket, (message) =>
      message.kind === "event" && (message.event as Record<string, any>).type === "driver.load.updated"));
    const ack = waitForMessage(clients[1]!.socket, (message) =>
      message.kind === "ack" && (message.receipt as Record<string, any>).commandId === "multiclient-load-command");
    clients[1]!.socket.send(JSON.stringify({
      kind: "command",
      envelope: {
        protocolVersion: 1,
        kind: "command",
        messageId: "multiclient-load-message",
        commandId: "multiclient-load-command",
        sessionId: runtime.sessionId,
        traceId: "multiclient-load-trace",
        sentAt: Date.now(),
        sender: { deviceId: clients[1]!.registration.deviceId, displayId: clients[1]!.registration.displayId },
        command: { type: "driver.cognitive_load.report", payload: { level: "low", confidence: 0.9, timestamp: Date.now() } },
      },
    }));

    const [receipt, ...events] = await Promise.all([ack, ...eventWaiters]);
    assert.equal((receipt!.receipt as Record<string, any>).status, "RECEIVED");
    const firstEvent = (events[0]!.event as Record<string, any>);
    assert.equal(firstEvent.payload.level, "low");
    assert.ok(events.every((message) => {
      const event = message.event as Record<string, any>;
      return event.eventId === firstEvent.eventId && event.sequence === firstEvent.sequence && event.sessionId === runtime.sessionId;
    }));

    const replayedEvent = waitForMessage(clients[1]!.socket, (message) =>
      message.kind === "event" && (message.event as Record<string, any>).eventId === firstEvent.eventId);
    clients[1]!.socket.send(JSON.stringify({
      kind: "resync", protocolVersion: 1, sessionId: runtime.sessionId,
      traceId: "resync-missed-events", afterSequence: firstEvent.sequence - 1,
    }));
    assert.equal((await replayedEvent).event.sequence, firstEvent.sequence);

    const connectivityWaiters = clients.map((client) => waitForMessage(client.socket, (message) =>
      message.kind === "event" && (message.event as Record<string, any>).type === "connectivity.state.changed"));
    const connectivityAck = waitForMessage(clients[1]!.socket, (message) =>
      message.kind === "ack" && (message.receipt as Record<string, any>).commandId === "connectivity-command");
    clients[1]!.socket.send(JSON.stringify({
      kind: "command",
      envelope: {
        protocolVersion: 1,
        kind: "command",
        messageId: "connectivity-message",
        commandId: "connectivity-command",
        sessionId: runtime.sessionId,
        traceId: "connectivity-trace",
        sentAt: Date.now(),
        sender: { deviceId: clients[1]!.registration.deviceId, displayId: clients[1]!.registration.displayId },
        command: { type: "connectivity.mode.report", payload: { mode: "offline", evidence: "CONTROL_CONSOLE_SIMULATION" } },
      },
    }));
    const [connectivityReceipt, ...connectivityEvents] = await Promise.all([connectivityAck, ...connectivityWaiters]);
    assert.equal(connectivityReceipt!.receipt.status, "RECEIVED");
    const connectivityEvent = connectivityEvents[0]!.event;
    assert.equal(connectivityEvent.payload.mode, "offline");
    assert.equal(connectivityEvent.payload.source, "simulated");
    assert.equal(connectivityEvent.commandId, "connectivity-command");
    assert.ok(connectivityEvents.every((message) => message.event.eventId === connectivityEvent.eventId));
    assert.equal(runtime.getState().connectivity.mode, "offline");
    assert.equal(runtime.getState().connectivity.source, "simulated");
    let cloudCalls = 0;
    const router = new IntelligenceRouter({
      runtime,
      cloud: { modelName: "test-cloud", async proposeFromText() { cloudCalls++; return undefined; } },
      local: new Gemma2BOfflineSimulator(),
    });
    const offlineResult = await router.handle({
      requestId: "offline-connectivity-router-check",
      traceId: "offline-connectivity-router-trace",
      text: "Turn the cabin volume up",
      requestedByRole: "center",
    });
    assert.equal(offlineResult.route, "local");
    assert.equal(offlineResult.availability, "offline_local");
    assert.equal(cloudCalls, 0);
    const localVoiceProposal = router.handleProviderProposal({
      requestId: "offline-local-voice-proposal",
      traceId: "offline-local-voice-trace",
      requestedByRole: "center",
      route: "local",
      candidate: {
        kind: "CHANGE_CABIN_SETTING",
        summary: "Increase cabin audio volume",
        targetRole: "center",
        priority: "normal",
        requiresConsent: true,
        payload: { setting: "volume", direction: "up" },
      },
    });
    assert.equal(localVoiceProposal.route, "local");
    assert.equal(localVoiceProposal.proposal?.status, "awaiting_consent");
    const cloudVoiceProposal = router.handleProviderProposal({
      requestId: "offline-cloud-voice-proposal",
      traceId: "offline-cloud-voice-trace",
      requestedByRole: "center",
      route: "cloud",
      candidate: {
        kind: "CHANGE_CABIN_SETTING",
        summary: "Increase cabin audio volume",
        targetRole: "center",
        priority: "normal",
        requiresConsent: true,
        payload: { setting: "volume", direction: "up" },
      },
    });
    assert.equal(cloudVoiceProposal.availability, "unavailable");
    assert.equal(cloudVoiceProposal.fallbackReason, "CONNECTIVITY_OFFLINE");

    const expiredHistorySnapshot = waitForMessage(clients[1]!.socket, (message) => message.kind === "snapshot");
    clients[1]!.socket.send(JSON.stringify({
      kind: "resync", protocolVersion: 1, sessionId: runtime.sessionId,
      traceId: "resync-expired-history", afterSequence: 0,
    }));
    assert.equal((await expiredHistorySnapshot).snapshot.stateRevision, runtime.getState().revision);

    const windowClient = clients.find((client) => client.registration.role === "interactive_window");
    assert.ok(windowClient);
    await closeSocket(windowClient.socket);
    const reconnected = await connect(address, windowClient.registration);
    clients.push(reconnected);
    assert.equal(reconnected.welcome.sessionId, runtime.sessionId);
    assert.equal(reconnected.snapshot.snapshot.stateRevision, runtime.getState().revision);
    assert.equal(reconnected.snapshot.snapshot.state.driver.currentLoad, "low");
    assert.equal(reconnected.snapshot.snapshot.state.connectivity.mode, "offline");
    assert.equal(reconnected.snapshot.snapshot.state.connectivity.source, "simulated");
    assert.equal(reconnected.snapshot.snapshot.state.displayConnections[windowClient.registration.displayId].connected, true);
  } finally {
    await Promise.all(clients.map((client) => closeSocket(client.socket)));
    await gateway.close();
  }
});

async function connect(address: string, registration: DisplayRegistration): Promise<RegisteredClient> {
  const socket = new WebSocket(address);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("TEST_SOCKET_OPEN_TIMEOUT")), 2_000);
      socket.once("open", () => { clearTimeout(timer); resolve(); });
      socket.once("error", (error) => { clearTimeout(timer); reject(error); });
    });
    const welcomePromise = waitForMessage(socket, (message) => message.kind === "welcome");
    const snapshotPromise = waitForMessage(socket, (message) => message.kind === "snapshot");
    socket.send(JSON.stringify({
      kind: "register",
      protocolVersion: 1,
      displayId: registration.displayId,
      deviceId: registration.deviceId,
      traceId: `register-${registration.displayId}`,
    }));
    const [welcome, snapshot] = await Promise.all([welcomePromise, snapshotPromise]);
    assert.equal(welcome.sequence, snapshot.snapshot.sequence);
    return { socket, registration, welcome, snapshot };
  } catch (error) {
    socket.terminate();
    throw error;
  }
}

async function waitForMessage(socket: WebSocket, predicate: (message: Record<string, any>) => boolean): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("TEST_MESSAGE_TIMEOUT"));
    }, 3_000);
    const onMessage = (raw: WebSocket.RawData) => {
      let message: Record<string, any>;
      try {
        message = JSON.parse(raw.toString()) as Record<string, any>;
      } catch (error) {
        clearTimeout(timer);
        socket.off("message", onMessage);
        reject(error);
        return;
      }
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  if (socket.readyState === WebSocket.CONNECTING) {
    socket.terminate();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { socket.terminate(); reject(new Error("TEST_SOCKET_CLOSE_TIMEOUT")); }, 2_000);
    socket.once("close", () => { clearTimeout(timer); resolve(); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
    socket.close(1000, "test complete");
  });
}
