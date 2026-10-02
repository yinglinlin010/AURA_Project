import assert from "node:assert/strict";
import test from "node:test";
import type { ActionProposal, ActionProposalRequest, CommandEnvelope, DisplayRegistry, DisplayRole } from "../../../contracts/protocol/src/types.js";
import { evaluateConsent } from "../../core-domain/src/consent-manager.js";
import { CoreRuntime } from "../src/core-runtime.js";

const registry: DisplayRegistry = {
  version: 1,
  displays: [
    { displayId: "center-main", deviceId: "center-device", role: "center", protocolVersion: 1, enabled: true },
    { displayId: "rear-main", deviceId: "rear-device", role: "rear", protocolVersion: 1, enabled: true },
    { displayId: "passenger-main", deviceId: "passenger-device", role: "front_passenger", protocolVersion: 1, enabled: true },
    { displayId: "cluster-main", deviceId: "cluster-device", role: "cluster", protocolVersion: 1, enabled: true },
  ],
};

const addStop: ActionProposalRequest = {
  proposalId: "trip-stop-1",
  kind: "ADD_TRIP_STOP",
  summary: "Add a stop",
  targetRole: "center",
  priority: "normal",
  requiresConsent: true,
  payload: { placeId: "place-1", label: "Cafe" },
};

function command(runtime: CoreRuntime, commandId: string, role: DisplayRole, commandValue: CommandEnvelope["command"]): CommandEnvelope {
  const sender = registry.displays.find((display) => display.role === role)!;
  return {
    protocolVersion: 1,
    kind: "command",
    messageId: `message-${commandId}`,
    commandId,
    sessionId: runtime.sessionId,
    traceId: `trace-${commandId}`,
    sentAt: 1,
    sender: { displayId: sender.displayId, deviceId: sender.deviceId },
    command: commandValue,
  };
}

function runtimeWithProposal(request = addStop): CoreRuntime {
  const runtime = new CoreRuntime({ registry });
  runtime.ingestSignal({
    signalId: "center-consent-test-driver-load",
    type: "driver.cognitive_load",
    value: { level: "normal", confidence: 1 },
    source: "simulated",
    timestamp: Date.now(),
    confidence: 1,
  }, "center-consent-test-driver-load-trace");
  runtime.proposeAction(request, "rear", "trace-proposal");
  return runtime;
}

function manuallyMalformedProposal(targetRole: DisplayRole, kind: ActionProposal["kind"], payload: Record<string, unknown> = {}): ActionProposal {
  return {
    ...addStop,
    kind,
    targetRole,
    payload,
    requestedByRole: "rear",
    createdAt: 1,
    status: "awaiting_consent",
    traceId: "trace-malformed",
  };
}

test("registered Center can approve or decline a shared Journey stop", () => {
  for (const decision of ["approve", "decline"] as const) {
    const runtime = runtimeWithProposal();
    const receipt = runtime.submitCommand(command(runtime, `center-${decision}`, "center", {
      type: "action.consent",
      payload: { proposalId: addStop.proposalId, decision },
    }));
    assert.equal(receipt.status, "RECEIVED");
    assert.equal(runtime.getState().activeProposals[0]?.status, decision === "approve" ? "completed" : "declined");
    assert.equal(runtime.getState().journey.stops.length, decision === "approve" ? 1 : 0);
  }
});

test("rear, passenger, and cluster cannot approve or decline Journey mutations", () => {
  for (const role of ["rear", "front_passenger", "cluster"] as const) {
    for (const decision of ["approve", "decline"] as const) {
      const runtime = runtimeWithProposal();
      const receipt = runtime.submitCommand(command(runtime, `${role}-${decision}`, role, {
        type: "action.consent",
        payload: { proposalId: addStop.proposalId, decision },
      }));
      assert.equal(receipt.status, "REJECTED", `${role} ${decision}`);
      assert.equal(receipt.reasonCode, "JOURNEY_CONSENT_REQUIRES_CENTER");
      assert.deepEqual(runtime.getState().journey.stops, []);
      assert.equal(runtime.getState().activeProposals[0]?.status, "awaiting_consent");
    }
  }
});

test("malformed or mismatched-target Journey proposals cannot bypass Center authority", () => {
  const state = new CoreRuntime({ registry }).getState();
  for (const proposal of [
    manuallyMalformedProposal("rear", "ADD_TRIP_STOP"),
    manuallyMalformedProposal("front_passenger", "SHOW_INFORMATION", { discoveryMode: "route_preview" }),
    manuallyMalformedProposal("center", "SHOW_INFORMATION", { discoveryMode: "route_preview" }),
  ]) {
    state.activeProposals = [proposal];
    for (const role of ["rear", "front_passenger", "cluster"] as const) {
      assert.deepEqual(evaluateConsent(state, proposal.proposalId, role, "approve"), {
        accepted: false,
        reasonCode: "JOURNEY_CONSENT_REQUIRES_CENTER",
      });
      assert.deepEqual(evaluateConsent(state, proposal.proposalId, role, "decline"), {
        accepted: false,
        reasonCode: "JOURNEY_CONSENT_REQUIRES_CENTER",
      });
    }
    assert.equal(evaluateConsent(state, proposal.proposalId, "center", "approve").accepted, proposal.targetRole === "center");
    if (proposal.targetRole !== "center") {
      assert.deepEqual(evaluateConsent(state, proposal.proposalId, "center", "approve"), {
        accepted: false,
        reasonCode: "JOURNEY_CONSENT_REQUIRES_CENTER",
      });
    }
  }
});

test("non-Journey consent retains target-role behavior", () => {
  const runtime = new CoreRuntime({ registry });
  runtime.ingestSignal({
    signalId: "non-journey-consent-test-driver-load",
    type: "driver.cognitive_load",
    value: { level: "normal", confidence: 1 },
    source: "simulated",
    timestamp: Date.now(),
    confidence: 1,
  }, "non-journey-consent-test-driver-load-trace");
  const request: ActionProposalRequest = {
    proposalId: "cabin-setting-1",
    kind: "CHANGE_CABIN_SETTING",
    summary: "Change media volume",
    targetRole: "front_passenger",
    priority: "normal",
    requiresConsent: true,
    payload: { setting: "media_volume" },
  };
  runtime.proposeAction(request, "front_passenger", "trace-cabin");
  const center = runtime.submitCommand(command(runtime, "wrong-target", "center", {
    type: "action.consent", payload: { proposalId: request.proposalId, decision: "approve" },
  }));
  assert.equal(center.status, "REJECTED");
  assert.equal(center.reasonCode, "CONSENT_ROLE_MISMATCH");
  const passenger = runtime.submitCommand(command(runtime, "matching-target", "front_passenger", {
    type: "action.consent", payload: { proposalId: request.proposalId, decision: "approve" },
  }));
  assert.equal(passenger.status, "RECEIVED");
  assert.equal(runtime.getState().activeProposals[0]?.consentGranted, true);
});
