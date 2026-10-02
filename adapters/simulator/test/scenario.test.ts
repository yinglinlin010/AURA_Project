import assert from "node:assert/strict";
import test from "node:test";
import { assertScenarioDefinition, loadScenarioFile } from "../src/scenario.js";

test("scenario schema accepts explicit signal freshness and validates its enum", () => {
  const scenario = loadScenarioFile("scenarios/connectivity/simulated-stale-refresh.yaml");
  assert.equal(scenario.timeline[0]?.kind, "signal");
  if (scenario.timeline[0]?.kind === "signal") assert.equal(scenario.timeline[0].signal.freshness, "stale");

  assert.throws(() => assertScenarioDefinition({
    id: "invalid-freshness",
    name: "Invalid freshness",
    timeline: [{ id: "signal", atMs: 0, kind: "signal", signal: { type: "example", value: true, freshness: "expired" } }],
  }), /INVALID_SCENARIO/);
  assert.doesNotThrow(() => assertScenarioDefinition({
    id: "implicit-freshness",
    name: "Implicit freshness remains valid",
    timeline: [{ id: "signal", atMs: 0, kind: "signal", signal: { type: "example", value: true } }],
  }));
});
