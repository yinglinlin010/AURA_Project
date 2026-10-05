import assert from "node:assert/strict";
import test from "node:test";
import type { ActionProposalRequest, CommandEnvelope, DisplayRegistry } from "../../../contracts/protocol/src/types.js";
import { CoreRuntime } from "../src/core-runtime.js";

const registry: DisplayRegistry = { version: 1, displays: ["center", "cluster", "interactive_window"].map((role) => ({
  displayId: role, deviceId: role, role, protocolVersion: 1, enabled: true,
})) };
const proposal = (): ActionProposalRequest => ({ proposalId: "window-stop", kind: "ADD_TRIP_STOP",
  summary: "SIMULATED 東華東湖", targetRole: "center", priority: "normal", requiresConsent: true,
  payload: { placeId: "simulated-dong-hwa-east-lake", label: "SIMULATED 東華東湖", origin: "window_dong_hwa_demo",
    source: "simulated", freshness: "unknown" } });
let serial = 0;
function send(runtime: CoreRuntime, role: string, command: CommandEnvelope["command"]) {
  const id = `window-test-${++serial}`;
  return runtime.submitCommand({ protocolVersion: 1, kind: "command", messageId: id, commandId: id,
    sessionId: runtime.sessionId, traceId: id, sentAt: Date.now(), sender: { displayId: role, deviceId: role }, command });
}
function ready() {
  const runtime = new CoreRuntime({ registry });
  send(runtime, "center", { type: "driver.cognitive_load.report", payload: { level: "normal", timestamp: Date.now() } });
  return runtime;
}
test("Window stop remains pending until Center consent; Window consent cannot mutate state", () => {
  const runtime = ready();
  assert.equal(send(runtime, "interactive_window", { type: "action.propose", payload: { proposal: proposal() } }).status, "RECEIVED");
  assert.equal(runtime.getState().activeProposals[0]?.status, "awaiting_consent");
  assert.equal(runtime.getState().journey.stops.length, 0);
  for (const decision of ["approve", "decline"] as const) {
    const before = runtime.getState();
    assert.equal(send(runtime, "interactive_window", { type: "action.consent", payload: { proposalId: "window-stop", decision } }).reasonCode, "WINDOW_COMMAND_NOT_ALLOWED");
    assert.deepEqual(runtime.getState(), before);
  }
  assert.equal(send(runtime, "center", { type: "action.consent", payload: { proposalId: "window-stop", decision: "approve" } }).reasonCode, "JOURNEY_STOP_ADDED");
  assert.equal(runtime.getState().journey.stops.length, 1);
});
test("Window rejects other command authority and malformed routing without state changes", () => {
  const runtime = ready();
  const commands: CommandEnvelope["command"][] = [
    { type: "vehicle.telemetry.report", payload: { vehicle: { speedKph: 99 } } },
    { type: "driver.cognitive_load.report", payload: { level: "low", timestamp: Date.now() } },
    { type: "connectivity.mode.report", payload: { mode: "offline", evidence: "simulated" } },
    ...[{ targetRole: "interactive_window" }, { requiresConsent: false }, { kind: "SHOW_INFORMATION" }].map((patch) => ({
      type: "action.propose" as const, payload: { proposal: { ...proposal(), ...patch } as ActionProposalRequest },
    })),
  ];
  for (const command of commands) {
    const before = runtime.getState();
    assert.equal(send(runtime, "interactive_window", command).reasonCode, "WINDOW_COMMAND_NOT_ALLOWED");
    assert.deepEqual(runtime.getState(), before);
  }
});
test("Window cannot claim urgent or WARN authority; Cluster is command read-only", () => {
  const runtime = ready();
  for (const patch of [{ priority: "urgent" }, { kind: "WARN" }]) {
    const before = runtime.getState();
    assert.equal(send(runtime, "interactive_window", { type: "action.propose", payload: {
      proposal: { ...proposal(), ...patch } as ActionProposalRequest,
    } }).status, "REJECTED");
    assert.deepEqual(runtime.getState(), before);
  }
  for (const command of [
    { type: "action.propose", payload: { proposal: proposal() } },
    { type: "action.consent", payload: { proposalId: "window-stop", decision: "approve" } },
    { type: "vehicle.telemetry.report", payload: { vehicle: { speedKph: 99 } } },
    { type: "driver.cognitive_load.report", payload: { level: "low", timestamp: Date.now() } },
    { type: "connectivity.mode.report", payload: { mode: "offline", evidence: "simulated" } },
  ] as CommandEnvelope["command"][]) {
    const before = runtime.getState();
    assert.equal(send(runtime, "cluster", command).reasonCode, "CLUSTER_READ_ONLY");
    assert.deepEqual(runtime.getState(), before);
  }
});
