import assert from "node:assert/strict";
import test from "node:test";
import type {
  ActionProposal,
  ActionProposalRequest,
  CognitiveLoadLevel,
  CommandEnvelope,
  DisplayRegistry,
} from "../../../contracts/protocol/src/types.js";
import { evaluateActionProposal } from "../../core-domain/src/action-gate.js";
import { createInitialState } from "../../core-domain/src/state.js";
import { CoreRuntime } from "../src/core-runtime.js";

const registry: DisplayRegistry = {
  version: 1,
  displays: [
    { displayId: "center-main", deviceId: "center-device", role: "center", protocolVersion: 1, enabled: true },
    { displayId: "rear-main", deviceId: "rear-device", role: "rear", protocolVersion: 1, enabled: true },
  ],
};

const stopRequest: ActionProposalRequest = {
  proposalId: "load-gated-stop",
  kind: "ADD_TRIP_STOP",
  summary: "Add Cafe",
  targetRole: "center",
  priority: "normal",
  requiresConsent: true,
  payload: { placeId: "cafe-1", label: "Cafe" },
};

function proposal(status: ActionProposal["status"] = "awaiting_consent"): ActionProposal {
  return {
    ...stopRequest,
    requestedByRole: "rear",
    createdAt: 1,
    status,
    traceId: "proposal-trace",
  };
}

function command(runtime: CoreRuntime, commandId: string, decision: "approve" | "decline", proposalId = stopRequest.proposalId): CommandEnvelope {
  return {
    protocolVersion: 1,
    kind: "command",
    messageId: `message-${commandId}`,
    commandId,
    sessionId: runtime.sessionId,
    traceId: `trace-${commandId}`,
    sentAt: 2,
    sender: { displayId: "center-main", deviceId: "center-device" },
    command: { type: "action.consent", payload: { proposalId, decision } },
  };
}

function reportLoad(runtime: CoreRuntime, level: CognitiveLoadLevel): void {
  runtime.ingestSignal({
    signalId: `load-${level}-${runtime.eventBus.sequence}`,
    type: "driver.cognitive_load",
    value: { level, confidence: 0.8 },
    source: "simulated",
    timestamp: runtime.eventBus.sequence + 1,
    confidence: 0.8,
  }, `load-trace-${level}`);
}

test("non-critical proposals defer without load or at HIGH/CRITICAL, and route at LOW/NORMAL", () => {
  const cases: Array<{
    load: CognitiveLoadLevel | undefined;
    outcome: "DEFER" | "ROUTE";
    reasonCode: string;
  }> = [
    { load: undefined, outcome: "DEFER", reasonCode: "DRIVER_LOAD_UNAVAILABLE" },
    { load: "low", outcome: "ROUTE", reasonCode: "DRIVER_LOAD_BELOW_DEFERRAL_THRESHOLD" },
    { load: "normal", outcome: "ROUTE", reasonCode: "DRIVER_LOAD_BELOW_DEFERRAL_THRESHOLD" },
    { load: "high", outcome: "DEFER", reasonCode: "DRIVER_COGNITIVE_LOAD_HIGH" },
    { load: "critical", outcome: "DEFER", reasonCode: "DRIVER_COGNITIVE_LOAD_HIGH" },
  ];

  for (const expected of cases) {
    const state = createInitialState();
    if (expected.load === undefined) delete state.driver.currentLoad;
    else state.driver.currentLoad = expected.load;
    const decision = evaluateActionProposal({
      proposal: proposal(), state, allowedRoles: new Set(["center"]),
      decisionId: "decision-1", decidedAt: 1,
    });
    assert.equal(decision.outcome, expected.outcome, String(expected.load));
    assert.equal(decision.reasonCode, expected.reasonCode, String(expected.load));
    if (expected.outcome === "DEFER") {
      assert.deepEqual(decision.deferUntil, {
        type: "driver_load_below", currentThreshold: "high", reevaluateOn: "driver.cognitive_load",
      });
    }
  }
});

test("HMI telemetry and cognitive-load commands retain simulated provenance", () => {
  const runtime = new CoreRuntime({ registry });
  const envelope = (commandId: string, command: CommandEnvelope["command"]): CommandEnvelope => ({
    protocolVersion: 1,
    kind: "command",
    messageId: `message-${commandId}`,
    commandId,
    sessionId: runtime.sessionId,
    traceId: `trace-${commandId}`,
    sentAt: 10,
    sender: { displayId: "center-main", deviceId: "center-device" },
    command,
  });

  runtime.submitCommand(envelope("sim-speed", { type: "vehicle.telemetry.report", payload: { vehicle: { speedKph: 24 } } }));
  runtime.submitCommand(envelope("sim-load", { type: "driver.cognitive_load.report", payload: { level: "high", timestamp: 11, confidence: 1 } }));

  const signals = runtime.eventBus.eventsAfter(0)
    .filter((event) => event.type === "context.signal.received")
    .map((event) => event.payload.signal);
  assert.deepEqual(signals.map((signal) => [signal.type, signal.source]), [
    ["vehicle.telemetry", "simulated"],
    ["driver.cognitive_load", "simulated"],
  ]);
});

test("consent is invalidated while deferred and revalidated work requires fresh consent", () => {
  for (const releaseLevel of ["low", "normal"] as const) {
    const runtime = new CoreRuntime({ registry });
    reportLoad(runtime, "normal");
    const created = runtime.proposeAction(stopRequest, "rear", "proposal-trace");
    assert.equal(created.decision.outcome, "ROUTE");
    assert.equal(runtime.getState().activeProposals[0]?.status, "awaiting_consent");

    reportLoad(runtime, "high");
    const approval = runtime.submitCommand(command(runtime, `approve-${releaseLevel}`, "approve"));
    assert.equal(approval.status, "RECEIVED");
    assert.equal(runtime.getState().journey.stops.length, 0);
    assert.equal(runtime.getState().activeProposals[0]?.status, "deferred");
    assert.equal(runtime.getState().activeProposals[0]?.consentGranted, false);

    reportLoad(runtime, releaseLevel);
    assert.equal(runtime.getState().activeProposals[0]?.status, "awaiting_consent");
    assert.equal(runtime.getState().journey.stops.length, 0);
    const renewedApproval = runtime.submitCommand(command(runtime, `renew-${releaseLevel}`, "approve"));
    assert.equal(renewedApproval.status, "RECEIVED");
    assert.equal(runtime.getState().journey.stops.length, 1);
    assert.equal(runtime.getState().activeProposals[0]?.status, "completed");
  }
});

test("failed durable task creation cannot leave an approved proposal executing without a task", () => {
  const runtime = new CoreRuntime({ registry, persistTasks: () => { throw new Error("DISK_FULL"); } });
  reportLoad(runtime, "normal");
  const proposalRequest: ActionProposalRequest = {
    proposalId: "persisted-information-action",
    kind: "SHOW_INFORMATION",
    summary: "Show destination detail",
    targetRole: "center",
    priority: "normal",
    requiresConsent: true,
    payload: {},
  };
  const created = runtime.proposeAction(proposalRequest, "rear", "proposal-trace");
  assert.equal(created.proposal.status, "awaiting_consent");

  const receipt = runtime.submitCommand(command(runtime, "approval-write-through-failure", "approve", proposalRequest.proposalId));
  assert.equal(receipt.status, "REJECTED");
  assert.equal(receipt.reasonCode, "TASK_START_NOT_PERSISTED");
  assert.equal(runtime.getState().activeProposals[0]?.status, "rejected");
  assert.equal(runtime.getState().activeTasks.length, 0);
});

test("missing-load deferrals release to Center consent at LOW/NORMAL without changing Journey", () => {
  for (const releaseLevel of ["low", "normal"] as const) {
    const runtime = new CoreRuntime({ registry });
    const created = runtime.proposeAction(stopRequest, "rear", "proposal-trace");
    assert.equal(created.decision.outcome, "DEFER");
    assert.equal(created.decision.reasonCode, "DRIVER_LOAD_UNAVAILABLE");
    assert.equal(runtime.getState().activeProposals[0]?.status, "deferred");
    assert.equal(runtime.getState().journey.stops.length, 0);

    reportLoad(runtime, releaseLevel);
    assert.equal(runtime.getState().activeProposals[0]?.status, "awaiting_consent");
    assert.equal(runtime.getState().activeProposals[0]?.lastReasonCode, "DEFER_RELEASED_DRIVER_LOAD_LOW");
    assert.equal(runtime.getState().journey.stops.length, 0);
  }
});

test("safety warnings remain immediate and generic urgent/WARN proposals remain rejected without load", () => {
  const runtime = new CoreRuntime({ registry });
  const safety = runtime.ingestSignal({
    signalId: "unloaded-critical-warning",
    type: "safety.critical",
    value: { severity: "critical" },
    source: "sensor",
    timestamp: 1,
  }, "safety-trace");
  assert.equal(safety.policyDecision?.reasonCode, "CRITICAL_SAFETY_SIGNAL_LOCAL_OVERRIDE");
  assert.equal(runtime.getState().activeSafetyWarning?.warningId, "unloaded-critical-warning");

  const state = createInitialState();
  delete state.driver.currentLoad;
  const base = proposal();
  const invalidCandidates: Array<{ candidate: ActionProposal; reasonCode: string }> = [
    { candidate: { ...base, kind: "WARN" as never }, reasonCode: "SAFETY_WARNING_REQUIRES_SUPERVISOR" },
    { candidate: { ...base, priority: "urgent" as never }, reasonCode: "INVALID_PROPOSAL_PRIORITY" },
  ];
  for (const { candidate, reasonCode } of invalidCandidates) {
    const decision = evaluateActionProposal({
      proposal: candidate, state, allowedRoles: new Set(["center"]),
      decisionId: "decision-unsafe", decidedAt: 1,
    });
    assert.equal(decision.outcome, "REJECT");
    assert.equal(decision.reasonCode, reasonCode);
  }
});
