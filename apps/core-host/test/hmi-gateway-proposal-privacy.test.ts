import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import WebSocket from "ws";
import type { DisplayRegistration, DisplayRegistry } from "../../../contracts/protocol/src/types.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import { HmiGateway } from "../src/hmi-gateway.js";

const registry = JSON.parse(readFileSync("apps/core-host/config/display-registry.json", "utf8")) as DisplayRegistry;
const privateSummary = "PRIVATE_PROPOSAL_SUMMARY_712";
const privatePayload = "PRIVATE_PROPOSAL_PAYLOAD_936";

interface Client {
  socket: WebSocket;
  registration: DisplayRegistration;
  messages: Record<string, any>[];
  snapshot: Record<string, any>;
}

test("proposal content reaches only requester and consent target in live fanout, replay, and snapshots", async () => {
  const runtime = new CoreRuntime({ registry, eventHistoryLimit: 5 });
  runtime.ingestSignal({ signalId: "proposal-load", type: "driver.cognitive_load", value: { level: "normal" }, source: "simulated", timestamp: Date.now() });
  const gateway = new HmiGateway({ runtime, registry, host: "127.0.0.1", port: 0 });
  await gateway.start();
  const clients: Client[] = [];
  try {
    const address = gateway.address()!;
    for (const registration of registry.displays.filter((display) => display.enabled)) clients.push(await connect(address, registration));
    const requester = clients.find((client) => client.registration.role === "front_passenger")!;
    const center = clients.find((client) => client.registration.role === "center")!;
    const unauthorized = clients.filter((client) => client !== requester && client !== center);
    assert.equal(unauthorized.length, 3);

    const beforeProposal = runtime.eventBus.sequence;
    const proposalId = "private-proposal";
    const result = runtime.proposeAction({
      proposalId, kind: "SHOW_INFORMATION", summary: privateSummary, targetRole: "center",
      priority: "normal", requiresConsent: true, payload: { message: privatePayload },
    }, "front_passenger", "proposal-privacy-trace");
    assert.equal(result.decision.outcome, "ROUTE");

    // A later public event is a delivery barrier for all five live sockets.
    runtime.updateConnectivity({ mode: "degraded", source: "simulated", evidence: "PROPOSAL_PRIVACY_BARRIER", traceId: "proposal-barrier" });
    await Promise.all(clients.map((client) => waitFor(client, (message) => message.kind === "event" && message.event?.type === "connectivity.state.changed" && message.event?.traceId === "proposal-barrier")));
    for (const client of [requester, center]) {
      const created = client.messages.find((message) => message.kind === "event" && message.event?.type === "proposal.created" && message.event.payload.proposal.proposalId === proposalId);
      assert.equal(created?.event.payload.proposal.summary, privateSummary);
      assert.equal(created?.event.payload.proposal.payload.message, privatePayload);
      assert.ok(client.messages.some((message) => message.kind === "event" && message.event?.type === "proposal.status.changed" && message.event.payload.proposalId === proposalId));
    }
    for (const client of unauthorized) assertNoProposal(client.messages, proposalId);

    // Replay must filter the original events, not just the live broadcast.
    for (const client of clients) {
      client.messages.length = 0;
      client.socket.send(JSON.stringify({ kind: "resync", protocolVersion: 1, sessionId: runtime.sessionId, traceId: `replay-${client.registration.role}`, afterSequence: beforeProposal }));
      await waitFor(client, (message) => message.kind === "event" && message.event?.traceId === "proposal-barrier");
      if (client === requester || client === center) {
        assert.ok(client.messages.some((message) => message.kind === "event" && message.event?.type === "proposal.created" && message.event.payload.proposal.proposalId === proposalId));
      } else {
        assertNoProposal(client.messages, proposalId);
      }
    }

    // Reconnect snapshots use the same proposal visibility rule.
    for (const client of [...clients]) {
      const reconnected = await connect(address, client.registration);
      clients.push(reconnected);
      const proposals = reconnected.snapshot.snapshot.state.activeProposals as Record<string, any>[];
      if (client === requester || client === center) {
        assert.equal(proposals.find((proposal) => proposal.proposalId === proposalId)?.summary, privateSummary);
      } else {
        assertNoProposal(proposals, proposalId);
      }
    }

    for (let index = 0; index < 6; index++) {
      runtime.updateConnectivity({ mode: "degraded", source: "simulated", evidence: `PRIVACY_HISTORY_ADVANCE_${index}`, traceId: `history-${index}` });
    }
    for (const client of clients) {
      client.messages.length = 0;
      client.socket.send(JSON.stringify({ kind: "resync", protocolVersion: 1, sessionId: runtime.sessionId, traceId: `snapshot-fallback-${client.registration.role}`, afterSequence: beforeProposal }));
      const fallback = await waitFor(client, (message) => message.kind === "snapshot");
      const proposals = fallback.snapshot.state.activeProposals as Record<string, any>[];
      if (client.registration.role === "front_passenger" || client.registration.role === "center") {
        assert.equal(proposals.find((proposal) => proposal.proposalId === proposalId)?.payload.message, privatePayload);
      } else {
        assertNoProposal(proposals, proposalId);
      }
    }

    const centerReceipt = waitFor(center, (message) => message.kind === "ack" && message.receipt?.commandId === "private-proposal-consent");
    center.socket.send(JSON.stringify({
      kind: "command",
      envelope: {
        protocolVersion: 1, kind: "command", messageId: "private-proposal-consent-message", commandId: "private-proposal-consent",
        sessionId: runtime.sessionId, traceId: "private-proposal-consent-trace", sentAt: Date.now(),
        sender: { deviceId: center.registration.deviceId, displayId: center.registration.displayId },
        command: { type: "action.consent", payload: { proposalId, decision: "approve" } },
      },
    }));
    assert.equal((await centerReceipt).receipt.status, "RECEIVED");
    assert.equal(runtime.getState().activeProposals.find((proposal) => proposal.proposalId === proposalId)?.status, "executing");

    // A passenger target alone is not an explicit passenger-handoff grant.
    const ungrantedId = "ungranted-passenger-handoff";
    runtime.proposeAction({
      proposalId: ungrantedId, kind: "SHOW_INFORMATION", summary: "UNGRANTED_HANDOFF_SUMMARY",
      targetRole: "front_passenger", priority: "normal", requiresConsent: true,
      payload: { message: "UNGRANTED_HANDOFF_PAYLOAD" },
    }, "center", "ungranted-handoff-trace");
    runtime.updateConnectivity({ mode: "degraded", source: "simulated", evidence: "UNGRANTED_HANDOFF_BARRIER", traceId: "ungranted-barrier" });
    await Promise.all(clients.map((client) => waitFor(client, (message) => message.kind === "event" && message.event?.traceId === "ungranted-barrier")));
    assert.ok(center.messages.some((message) => message.kind === "event" && message.event?.type === "proposal.created" && message.event.payload.proposal.proposalId === ungrantedId));
    for (const client of clients.filter((item) => item.registration.role !== "center")) {
      const serialized = JSON.stringify(client.messages);
      assert.equal(serialized.includes(ungrantedId), false);
      assert.equal(serialized.includes("UNGRANTED_HANDOFF_PAYLOAD"), false);
    }
  } finally {
    await Promise.all(clients.map((client) => closeSocket(client.socket)));
    await gateway.close();
  }
});

async function connect(address: string, registration: DisplayRegistration): Promise<Client> {
  const socket = new WebSocket(address);
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const client: Client = { socket, registration, messages: [], snapshot: {} };
  socket.on("message", (raw) => client.messages.push(JSON.parse(raw.toString()) as Record<string, any>));
  socket.send(JSON.stringify({ kind: "register", protocolVersion: 1, displayId: registration.displayId, deviceId: registration.deviceId, traceId: `privacy-register-${registration.displayId}` }));
  client.snapshot = await waitFor(client, (message) => message.kind === "snapshot");
  return client;
}

async function waitFor(client: Client, predicate: (message: Record<string, any>) => boolean): Promise<Record<string, any>> {
  const existing = client.messages.find(predicate);
  if (existing) return existing;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.socket.off("message", onMessage); reject(new Error("TEST_MESSAGE_TIMEOUT")); }, 3_000);
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as Record<string, any>;
      if (!predicate(message)) return;
      clearTimeout(timer);
      client.socket.off("message", onMessage);
      resolve(message);
    };
    client.socket.on("message", onMessage);
  });
}

function assertNoProposal(value: unknown, proposalId: string): void {
  const serialized = JSON.stringify(value);
  for (const marker of [proposalId, privateSummary, privatePayload]) assert.equal(serialized.includes(marker), false, `unauthorized display received ${marker}`);
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  if (socket.readyState !== WebSocket.OPEN) { socket.terminate(); return; }
  await new Promise<void>((resolve) => { socket.once("close", resolve); socket.close(1000, "test complete"); });
}
