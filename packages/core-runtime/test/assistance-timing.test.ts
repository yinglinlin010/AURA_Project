import assert from "node:assert/strict";
import test from "node:test";
import { decideAssistanceTiming, type AssistanceTimingInput } from "../../../packages/core-domain/src/assistance-timing.js";

const base: AssistanceTimingInput = {
  informationValue: "important",
  urgency: "normal",
  interruptionCost: "low",
  driverLoad: "normal",
  passengerHandoffAuthorized: false,
  sensitivity: "ordinary",
};

test("presents important routine information immediately when conditions are calm", () => {
  assert.deepEqual(decideAssistanceTiming(base), {
    outcome: "immediate", reasonCode: "SAFE_TO_PRESENT_NOW", exposeContent: true,
  });
});

test("defers when driver load is high or unknown, unless handoff was explicitly authorized", () => {
  const high = decideAssistanceTiming({ ...base, driverLoad: "high" });
  assert.equal(high.outcome, "deferred");
  assert.equal(high.reasonCode, "DRIVER_LOAD_HIGH");
  assert.deepEqual(decideAssistanceTiming({ ...base, driverLoad: "unknown", passengerHandoffAuthorized: true }), {
    outcome: "passenger_handoff", reasonCode: "AUTHORIZED_PASSENGER_HANDOFF", exposeContent: true,
  });
  assert.equal(decideAssistanceTiming({ ...base, driverLoad: "high" }).outcome, "deferred");
});

test("never sends sensitive content to a passenger or presentation channel", () => {
  assert.deepEqual(decideAssistanceTiming({
    ...base, sensitivity: "sensitive", driverLoad: "high", passengerHandoffAuthorized: true,
  }), { outcome: "deferred", reasonCode: "SENSITIVE_CONTENT_WITHHELD", exposeContent: false });
});

test("urgency and interruption cost produce explainable immediate or deferred decisions", () => {
  assert.equal(decideAssistanceTiming({ ...base, urgency: "critical", driverLoad: "low" }).outcome, "immediate");
  assert.deepEqual(decideAssistanceTiming({ ...base, urgency: "critical", interruptionCost: "high" }), {
    outcome: "deferred", reasonCode: "INTERRUPTION_COST_HIGH", exposeContent: true,
  });
  assert.equal(decideAssistanceTiming({ ...base, informationValue: "useful", urgency: "low" }).outcome, "silence");
  assert.equal(decideAssistanceTiming({ ...base, informationValue: "negligible", urgency: "critical" }).outcome, "silence");
});
