import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import type { DisplayRegistry, JourneyRecommendationMessage } from "../../../contracts/protocol/src/types.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import { SimulatedJourneyRecommendationEvidenceSource } from "../../../packages/core-runtime/src/journey-recommendation-fixture.js";
import { HmiGateway } from "../src/hmi-gateway.js";

const registry: DisplayRegistry = {
  version: 1,
  displays: [
    { displayId: "center-main", deviceId: "center-device", role: "center", protocolVersion: 1, enabled: true },
    { displayId: "front-passenger-main", deviceId: "passenger-device", role: "front_passenger", protocolVersion: 1, enabled: true },
  ],
};

interface GatewayClient {
  socket: WebSocket;
  runtime: CoreRuntime;
  sessionId: string;
  close(): Promise<void>;
}

async function createRegisteredClient(role: "center" | "front_passenger", simulatedSource = false): Promise<GatewayClient> {
  const runtime = new CoreRuntime({ registry });
  if (simulatedSource) {
    runtime.ingestSignal({
      signalId: "recommendation-test-driver-load",
      type: "driver.cognitive_load",
      value: { level: "normal", confidence: 1 },
      source: "simulated",
      timestamp: Date.now(),
      confidence: 1,
    }, "recommendation-test-driver-load-trace");
  }
  const gateway = new HmiGateway({
    runtime,
    registry,
    host: "127.0.0.1",
    port: 0,
    ...(simulatedSource ? { journeyRecommendations: new SimulatedJourneyRecommendationEvidenceSource() } : {}),
  });
  await gateway.start();

  const address = gateway.address();
  if (!address) {
    await gateway.close();
    throw new Error("TEST_GATEWAY_ADDRESS_UNAVAILABLE");
  }
  const socket = new WebSocket(address);
  let sessionId = "";
  try {
    await waitForSocketOpen(socket);
    const displayId = role === "center" ? "center-main" : "front-passenger-main";
    const deviceId = role === "center" ? "center-device" : "passenger-device";
    const welcome = waitForMessage(socket, (message) => message.kind === "welcome");
    const snapshot = waitForMessage(socket, (message) => message.kind === "snapshot");
    socket.send(JSON.stringify({
      kind: "register",
      protocolVersion: 1,
      displayId,
      deviceId,
      traceId: `register-${role}`,
    }));
    const [welcomeMessage] = await Promise.all([welcome, snapshot]);
    sessionId = String(welcomeMessage.sessionId);
    if (!sessionId || sessionId === "undefined") throw new Error("TEST_SESSION_ID_UNAVAILABLE");
  } catch (error) {
    socket.terminate();
    await gateway.close();
    throw error;
  }

  return {
    socket,
    runtime,
    sessionId,
    close: async () => {
      try {
        if (socket.readyState === WebSocket.OPEN) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("TEST_SOCKET_CLOSE_TIMEOUT")), 2_000);
            socket.once("close", () => { clearTimeout(timer); resolve(); });
            socket.once("error", (error) => { clearTimeout(timer); reject(error); });
            socket.close(1000, "test complete");
          });
        } else if (socket.readyState === WebSocket.CONNECTING) {
          socket.terminate();
        }
      } finally {
        await gateway.close();
      }
    },
  };
}

async function waitForSocketOpen(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TEST_SOCKET_OPEN_TIMEOUT")), 2_000);
    socket.once("open", () => { clearTimeout(timer); resolve(); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

async function waitForMessage(socket: WebSocket, predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
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

function recommendationRequest(requestId: string): JourneyRecommendationMessage {
  return {
    kind: "journey.recommendation.request",
    protocolVersion: 1,
    requestId,
    traceId: `trace-${requestId}`,
    requestText: "Find a dinner restaurant on this journey",
  };
}

test("Center receives explicit abstention when no evidence source is injected", async () => {
  const client = await createRegisteredClient("center");
  try {
    const response = waitForMessage(client.socket, (message) => message.kind === "journey.recommendation.result");
    client.socket.send(JSON.stringify(recommendationRequest("no-source")));
    const result = await response;
    assert.equal(result.status, "abstained");
    assert.equal(result.reasonCode, "WHOLE_JOURNEY_EVIDENCE_SOURCE_UNAVAILABLE");
  } finally {
    await client.close();
  }
});

test("front-passenger recommendation request is rejected by role policy", async () => {
  const client = await createRegisteredClient("front_passenger", true);
  try {
    const response = waitForMessage(client.socket, (message) => message.kind === "error");
    client.socket.send(JSON.stringify(recommendationRequest("passenger-request")));
    const error = await response;
    assert.equal(error.code, "JOURNEY_RECOMMENDATION_ROLE_NOT_ALLOWED");
  } finally {
    await client.close();
  }
});

test("simulated source returns Center consent proposal without changing journey state", async () => {
  const client = await createRegisteredClient("center", true);
  try {
    const stateBefore = client.runtime.getState();
    const response = waitForMessage(client.socket, (message) => message.kind === "journey.recommendation.result");
    client.socket.send(JSON.stringify(recommendationRequest("simulated-recommendation")));
    const result = await response;

    assert.equal(result.status, "proposal");
    const proposal = result.centerProposal as Record<string, unknown>;
    assert.equal(proposal.kind, "ADD_TRIP_STOP");
    assert.equal(proposal.targetRole, "center");
    assert.equal(proposal.requiresConsent, true);
    assert.deepEqual(proposal.payload, { placeId: "garden-cafe", label: "Garden Cafe", category: "restaurant" });
    assert.ok(result.recommendation && typeof result.recommendation === "object");
    assert.deepEqual(client.runtime.getState(), stateBefore);
  } finally {
    await client.close();
  }
});

test("declining a recommendation leaves the journey unchanged and repeated commands are idempotent", async () => {
  const client = await createRegisteredClient("center", true);
  try {
    const response = waitForMessage(client.socket, (message) => message.kind === "journey.recommendation.result");
    client.socket.send(JSON.stringify(recommendationRequest("decline-recommendation")));
    const result = await response;
    assert.equal(result.status, "proposal");
    const proposal = result.centerProposal as Record<string, any>;
    const initialStops = client.runtime.getState().journey.stops;

    const envelope = {
      protocolVersion: 1,
      kind: "command",
      messageId: "message-propose-recommendation",
      commandId: "command-propose-recommendation",
      sessionId: client.sessionId,
      traceId: "trace-propose-recommendation",
      sentAt: Date.now(),
      sender: { deviceId: "center-device", displayId: "center-main" },
      command: { type: "action.propose", payload: { proposal } },
    };
    const firstProposalAck = waitForMessage(client.socket, (message) => message.kind === "ack" && (message.receipt as any)?.commandId === envelope.commandId);
    client.socket.send(JSON.stringify({ kind: "command", envelope }));
    const firstReceipt = (await firstProposalAck).receipt as Record<string, unknown>;
    assert.equal(firstReceipt.status, "RECEIVED");
    assert.equal(firstReceipt.replayed, false);

    const secondProposalAck = waitForMessage(client.socket, (message) => message.kind === "ack" && (message.receipt as any)?.commandId === envelope.commandId);
    client.socket.send(JSON.stringify({ kind: "command", envelope }));
    const replayReceipt = (await secondProposalAck).receipt as Record<string, unknown>;
    assert.equal(replayReceipt.status, "RECEIVED");
    assert.equal(replayReceipt.replayed, true);

    const declineEnvelope = {
      ...envelope,
      messageId: "message-decline-recommendation",
      commandId: "command-decline-recommendation",
      traceId: "trace-decline-recommendation",
      sentAt: Date.now(),
      command: { type: "action.consent", payload: { proposalId: proposal.proposalId, decision: "decline" } },
    };
    const declineAck = waitForMessage(client.socket, (message) => message.kind === "ack" && (message.receipt as any)?.commandId === declineEnvelope.commandId);
    client.socket.send(JSON.stringify({ kind: "command", envelope: declineEnvelope }));
    const declineReceipt = (await declineAck).receipt as Record<string, unknown>;
    assert.equal(declineReceipt.status, "RECEIVED");
    assert.equal(declineReceipt.reasonCode, "TARGET_ROLE_DECLINED");
    assert.deepEqual(client.runtime.getState().journey.stops, initialStops);
    const declined = client.runtime.getState().activeProposals.find((item) => item.proposalId === proposal.proposalId);
    assert.equal(declined?.status, "declined");
  } finally {
    await client.close();
  }
});
