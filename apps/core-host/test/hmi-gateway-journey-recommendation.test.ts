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
  close(): Promise<void>;
}

async function createRegisteredClient(role: "center" | "front_passenger", simulatedSource = false): Promise<GatewayClient> {
  const runtime = new CoreRuntime({ registry });
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
    await Promise.all([welcome, snapshot]);
  } catch (error) {
    socket.terminate();
    await gateway.close();
    throw error;
  }

  return {
    socket,
    runtime,
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
    assert.deepEqual(client.runtime.getState(), stateBefore);
  } finally {
    await client.close();
  }
});
