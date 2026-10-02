import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteJourneyStore } from "../../../adapters/persistence/sqlite-journey-store.js";
import type { ActionProposalRequest, CommandEnvelope, DisplayRegistry } from "../../../contracts/protocol/src/types.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import { ACTIVE_JOURNEY_ID, persistJourney, restoreJourney } from "../src/journey-persistence.js";

const registry: DisplayRegistry = {
  version: 1,
  displays: [
    { displayId: "center-main", deviceId: "center-device", role: "center", protocolVersion: 1, enabled: true },
    { displayId: "passenger-main", deviceId: "passenger-device", role: "front_passenger", protocolVersion: 1, enabled: true },
  ],
};

const request: ActionProposalRequest = {
  proposalId: "proposal-place-1",
  kind: "ADD_TRIP_STOP",
  summary: "Add Harbor Table to the journey",
  targetRole: "center",
  priority: "secondary",
  requiresConsent: true,
  payload: { placeId: "mapbox-place-123", label: "Harbor Table Provider Label", category: "restaurant" },
};

function envelope(runtime: CoreRuntime, commandId: string, command: CommandEnvelope["command"]): CommandEnvelope {
  return {
    protocolVersion: 1,
    kind: "command",
    messageId: `message-${commandId}`,
    commandId,
    sessionId: runtime.sessionId,
    traceId: `trace-${commandId}`,
    sentAt: Date.now(),
    sender: { displayId: "center-main", deviceId: "center-device" },
    command,
  };
}

function reportNormalLoad(runtime: CoreRuntime, signalId: string): void {
  runtime.ingestSignal({
    signalId,
    type: "driver.cognitive_load",
    value: { level: "normal", confidence: 1 },
    source: "simulated",
    timestamp: Date.now(),
    confidence: 1,
  }, `${signalId}-trace`);
}

test("consented Journey update writes only Place IDs and restores after host restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "aura-host-journey-"));
  const databasePath = join(directory, "journeys.sqlite");
  let store = new SqliteJourneyStore({ databasePath });
  try {
    const runtime = new CoreRuntime({
      registry,
      persistJourney: (journey) => persistJourney(store, ACTIVE_JOURNEY_ID, journey),
    });
    reportNormalLoad(runtime, "journey-persistence-load");
    const proposed = runtime.proposeAction(request, "front_passenger", "trace-propose");
    assert.equal(proposed.decision.outcome, "ROUTE");

    const receipt = runtime.submitCommand(envelope(runtime, "approve-place-1", {
      type: "action.consent",
      payload: { proposalId: request.proposalId, decision: "approve" },
    }));
    assert.equal(receipt.status, "RECEIVED");
    assert.equal(receipt.reasonCode, "JOURNEY_STOP_ADDED");
    assert.equal(runtime.getState().journey.stops.length, 1);

    const stored = store.get(ACTIVE_JOURNEY_ID);
    assert.ok(stored);
    assert.deepEqual(stored.stops, [{ placeId: "mapbox-place-123" }]);
    assert.equal(JSON.stringify(stored).includes("Harbor Table Provider Label"), false);
    store.close();

    store = new SqliteJourneyStore({ databasePath });
    const restoredRuntime = new CoreRuntime({ registry, initialJourney: restoreJourney(store.get(ACTIVE_JOURNEY_ID)) });
    assert.deepEqual(restoredRuntime.getState().journey.stops.map(({ placeId, label, category }) => ({ placeId, label, category })), [
      { placeId: "mapbox-place-123", label: "Saved stop 1", category: undefined },
    ]);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Journey persistence failure rejects consent before changing Journey state", () => {
  const runtime = new CoreRuntime({ registry, persistJourney: () => { throw new Error("JOURNEY_PERSISTENCE_FAILED"); } });
  reportNormalLoad(runtime, "journey-persistence-failure-load");
  runtime.proposeAction(request, "front_passenger", "trace-propose-failure");

  const receipt = runtime.submitCommand(envelope(runtime, "approve-place-failure", {
    type: "action.consent",
    payload: { proposalId: request.proposalId, decision: "approve" },
  }));
  assert.equal(receipt.status, "REJECTED");
  assert.equal(receipt.reasonCode, "JOURNEY_PERSISTENCE_FAILED");
  assert.deepEqual(runtime.getState().journey.stops, []);
  assert.notEqual(runtime.getState().activeProposals[0]?.consentGranted, true);
  assert.equal(runtime.getState().activeProposals[0]?.status, "awaiting_consent");
});
