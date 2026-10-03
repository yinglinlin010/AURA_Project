import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import type { ActionProposalRequest, DisplayRegistration, DisplayRegistry } from "../../../contracts/protocol/src/types.js";
import { SqliteTaskStore } from "../../../adapters/persistence/sqlite-task-store.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import { HmiGateway } from "../src/hmi-gateway.js";

const registry: DisplayRegistry = {
  version: 1,
  displays: [
    { displayId: "center-main", deviceId: "center-device", role: "center", protocolVersion: 1, enabled: true },
    { displayId: "rear-main", deviceId: "rear-device", role: "rear", protocolVersion: 1, enabled: true },
    { displayId: "passenger-main", deviceId: "passenger-device", role: "front_passenger", protocolVersion: 1, enabled: true },
    { displayId: "cluster-main", deviceId: "cluster-device", role: "cluster", protocolVersion: 1, enabled: true },
  ],
};

const registrations = registry.displays;
type TestClient = { socket: WebSocket; registration: DisplayRegistration; welcome: Record<string, unknown> };

test("Gateway consent uses registered Center role for Journey mutations", async () => {
  const runtime = new CoreRuntime({ registry });
  runtime.ingestSignal({
    signalId: "consent-test-driver-load",
    type: "driver.cognitive_load",
    value: { level: "normal", confidence: 1 },
    source: "simulated",
    timestamp: Date.now(),
    confidence: 1,
  }, "consent-test-driver-load-trace");
  const gateway = new HmiGateway({ runtime, registry, host: "127.0.0.1", port: 0 });
  const clients: TestClient[] = [];
  await gateway.start();
  try {
    const address = gateway.address();
    assert.ok(address);
    for (const registration of registrations) clients.push(await connectRegistered(address, registration));
    for (const client of clients) assert.equal(client.welcome.role, client.registration.role);

    const stop = proposal("add-stop", "ADD_TRIP_STOP", { placeId: "fixture-cafe", label: "Fixture Cafe" });
    runtime.proposeAction(stop, "rear", "trace-add-stop");
    for (const role of ["rear", "front_passenger", "cluster"] as const) {
      const client = clientFor(role);
      for (const decision of ["approve", "decline"] as const) {
        const response = submitConsent(client, runtime.sessionId, `${role}-${decision}-stop`, stop.proposalId, decision);
        const receipt = (await response).receipt as Record<string, unknown>;
        assert.equal(receipt.status, "REJECTED");
        assert.equal(receipt.reasonCode, "JOURNEY_CONSENT_REQUIRES_CENTER");
        assert.deepEqual(runtime.getState().journey.stops, []);
        assert.equal(runtime.getState().activeProposals.find((item) => item.proposalId === stop.proposalId)?.status, "awaiting_consent");
      }
    }

    const routePreview = proposal("route-preview", "SHOW_INFORMATION", {
      discoveryMode: "route_preview",
      placeLabel: "Fixture destination",
      routeDistanceMeters: 1200,
      routeDurationSeconds: 300,
      placeProvider: "mapbox-search-box",
      placeObservedAt: 100,
      placeFreshness: "fresh",
      placeAttribution: "Map data",
      provider: "mapbox-directions-v5",
      source: "api",
      observedAt: 100,
      freshness: "fresh",
      attribution: "Map data",
      attributionUrl: "https://example.invalid/attribution",
    });
    runtime.proposeAction(routePreview, "front_passenger", "trace-route-preview");
    for (const role of ["rear", "front_passenger", "cluster"] as const) {
      const client = clientFor(role);
      for (const decision of ["approve", "decline"] as const) {
        const response = submitConsent(client, runtime.sessionId, `${role}-${decision}-route`, routePreview.proposalId, decision);
        const receipt = (await response).receipt as Record<string, unknown>;
        assert.equal(receipt.status, "REJECTED");
        assert.equal(receipt.reasonCode, "JOURNEY_CONSENT_REQUIRES_CENTER");
      }
    }
    assert.deepEqual(runtime.getState().journey.stops, []);

    const center = clientFor("center");
    const approvalId = "center-approve-stop";
    const firstApproval = submitConsent(center, runtime.sessionId, approvalId, stop.proposalId, "approve");
    const firstReceipt = (await firstApproval).receipt as Record<string, unknown>;
    assert.equal(firstReceipt.status, "RECEIVED");
    assert.equal(firstReceipt.reasonCode, "JOURNEY_STOP_ADDED");
    assert.equal(runtime.getState().journey.stops.length, 1);

    const replay = submitConsent(center, runtime.sessionId, approvalId, stop.proposalId, "approve");
    const replayReceipt = (await replay).receipt as Record<string, unknown>;
    assert.equal(replayReceipt.replayed, true);
    assert.equal(runtime.getState().journey.stops.length, 1);

    const declineStop = proposal("decline-stop", "ADD_TRIP_STOP", { placeId: "fixture-tea", label: "Fixture Tea" });
    runtime.proposeAction(declineStop, "rear", "trace-decline-stop");
    const declineResponse = submitConsent(center, runtime.sessionId, "center-decline-stop", declineStop.proposalId, "decline");
    const declineReceipt = (await declineResponse).receipt as Record<string, unknown>;
    assert.equal(declineReceipt.status, "RECEIVED");
    assert.equal(declineReceipt.reasonCode, "TARGET_ROLE_DECLINED");
    assert.equal(runtime.getState().journey.stops.length, 1);
    assert.deepEqual(runtime.getState().journey.stops.map((item) => item.placeId), ["fixture-cafe"]);

    // A sender identity spoof is rejected by the Gateway connection binding before consent is evaluated.
    const spoof = envelopeFor(runtime.sessionId, "spoof-center", center.registration, {
      type: "action.consent", payload: { proposalId: declineStop.proposalId, decision: "approve" },
    });
    spoof.sender = { displayId: "rear-main", deviceId: "rear-device" };
    const spoofAck = waitForMessage(center.socket, (message) => message.kind === "error" && message.code === "COMMAND_SENDER_MISMATCH");
    center.socket.send(JSON.stringify({ kind: "command", envelope: spoof }));
    await spoofAck;
    assert.equal(runtime.getState().journey.stops.length, 1);
  } finally {
    await Promise.all(clients.map((client) => closeSocket(client.socket)));
    await gateway.close();
  }

  function clientFor(role: string): TestClient {
    const client = clients.find((item) => item.registration.role === role);
    assert.ok(client, `missing registered ${role} client`);
    return client;
  }
});

test("only Center consent starts a task through Gateway and task state survives host-style restore", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aura-gateway-task-"));
  const databasePath = join(directory, "tasks.sqlite");
  const store = new SqliteTaskStore({ databasePath });
  const runtime = new CoreRuntime({
    registry,
    initialTasks: store.get(),
    persistTasks: (tasks) => store.save(tasks),
  });
  runtime.ingestSignal({
    signalId: "task-consent-driver-load",
    type: "driver.cognitive_load",
    value: { level: "normal", confidence: 1 },
    source: "simulated",
    timestamp: Date.now(),
    confidence: 1,
  }, "task-consent-driver-load-trace");
  const gateway = new HmiGateway({ runtime, registry, host: "127.0.0.1", port: 0 });
  const clients: TestClient[] = [];
  await gateway.start();
  try {
    const address = gateway.address();
    assert.ok(address);
    for (const registration of registrations) clients.push(await connectRegistered(address, registration));
    const center = clients.find((client) => client.registration.role === "center");
    const passenger = clients.find((client) => client.registration.role === "front_passenger");
    const cluster = clients.find((client) => client.registration.role === "cluster");
    assert.ok(center && passenger && cluster);

    const request = proposal("center-task-start", "SHOW_INFORMATION", { message: "Show the selected option." });
    runtime.proposeAction(request, "front_passenger", "trace-task-start");

    const denied = submitConsent(passenger, runtime.sessionId, "passenger-task-approve", request.proposalId, "approve");
    const deniedReceipt = (await denied).receipt as Record<string, unknown>;
    assert.equal(deniedReceipt.status, "REJECTED");
    assert.equal(deniedReceipt.reasonCode, "CONSENT_ROLE_MISMATCH");
    assert.equal(runtime.getState().activeTasks.length, 0);

    const centerEvent = waitForMessage(center.socket, (message) =>
      message.kind === "event" && (message.event as Record<string, unknown> | undefined)?.type === "task.registered");
    const publicEvent = waitForMessage(cluster.socket, (message) =>
      message.kind === "event" && (message.event as Record<string, unknown> | undefined)?.type === "task.registered");
    const approved = submitConsent(center, runtime.sessionId, "center-task-approve", request.proposalId, "approve");
    const approvedReceipt = (await approved).receipt as Record<string, unknown>;
    assert.equal(approvedReceipt.status, "RECEIVED");
    const [centerMessage, clusterMessage] = await Promise.all([centerEvent, publicEvent]);
    const privateTask = ((centerMessage.event as Record<string, unknown>).payload as { task: Record<string, unknown> }).task;
    const publicTask = ((clusterMessage.event as Record<string, unknown>).payload as { task: Record<string, unknown> }).task;
    assert.equal(privateTask.taskId, `action:${request.proposalId}`);
    assert.equal(privateTask.status, "running");
    assert.deepEqual(Object.keys(publicTask).sort(), ["priority", "startedAt", "status", "taskId", "traceId", "version"]);
    assert.equal(store.get()[0]?.taskId, privateTask.taskId);
    assert.equal(store.get()[0]?.status, "running");

    // The same SQLite store is what Core Host passes back on process startup.
    const restored = new CoreRuntime({ registry, initialTasks: store.get(), persistTasks: (tasks) => store.save(tasks) });
    assert.equal(restored.getState().activeTasks[0]?.status, "interrupted");
    assert.equal(restored.getState().activeTasks[0]?.pauseReason, "HOST_RESTART_RECOVERY_REQUIRED");
    assert.equal(restored.resumeTask instanceof Function, true);
    assert.throws(() => restored.resumeTask({ taskId: privateTask.taskId as string, traceId: "resume-without-evidence" }), /TASK_RECOVERY_REVALIDATION_REQUIRED/);
  } finally {
    await Promise.all(clients.map((client) => closeSocket(client.socket)));
    await gateway.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

function proposal(proposalId: string, kind: ActionProposalRequest["kind"], payload: Record<string, unknown>): ActionProposalRequest {
  return {
    proposalId,
    kind,
    summary: `Fixture ${proposalId}`,
    targetRole: "center",
    priority: "normal",
    requiresConsent: true,
    payload,
  };
}

async function connectRegistered(address: string, registration: DisplayRegistration): Promise<TestClient> {
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
      deviceId: registration.deviceId, traceId: `register-${registration.role}`,
    }));
    const [welcomeMessage] = await Promise.all([welcome, snapshot]);
    return { socket, registration, welcome: welcomeMessage };
  } catch (error) {
    socket.terminate();
    throw error;
  }
}

function submitConsent(client: TestClient, sessionId: string, id: string, proposalId: string, decision: "approve" | "decline"): Promise<Record<string, unknown>> {
  const envelope = envelopeFor(sessionId, id, client.registration, {
    type: "action.consent", payload: { proposalId, decision },
  });
  const response = waitForMessage(client.socket, (message) =>
    message.kind === "ack" && (message.receipt as Record<string, unknown> | undefined)?.commandId === id);
  client.socket.send(JSON.stringify({ kind: "command", envelope }));
  return response;
}

function envelopeFor(sessionId: string, id: string, registration: DisplayRegistration, command: Record<string, unknown>) {
  return {
    protocolVersion: 1,
    kind: "command",
    messageId: `message-${id}`,
    commandId: id,
    sessionId,
    traceId: `trace-${id}`,
    sentAt: 1,
    sender: { displayId: registration.displayId, deviceId: registration.deviceId },
    command,
  };
}

function waitForMessage(socket: WebSocket, predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("TEST_MESSAGE_TIMEOUT"));
    }, 3_000);
    const onMessage = (raw: WebSocket.RawData) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(raw.toString()) as Record<string, unknown>;
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
  if (socket.readyState === WebSocket.CONNECTING) { socket.terminate(); return; }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { socket.terminate(); reject(new Error("TEST_SOCKET_CLOSE_TIMEOUT")); }, 2_000);
    socket.once("close", () => { clearTimeout(timer); resolve(); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
    socket.close(1000, "test complete");
  });
}
