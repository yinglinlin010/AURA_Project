import assert from "node:assert/strict";
import test from "node:test";
import { resolvePresentation } from "../../core-domain/src/presentation-resolver.js";

test("four load levels resolve independently of confidence metadata", () => {
  const expected = [
    ["low", "rich", false, false],
    ["normal", "concise", false, false],
    ["high", "reduced", true, true],
    ["critical", "safety_only", true, true],
  ] as const;
  for (const [load, density, defer, suppressAmbient] of expected) {
    const result = resolvePresentation({ role: "center", load, loadConfidence: 0.4, activeSafetyWarning: false });
    assert.equal(result.load, load);
    assert.equal(result.loadConfidence, 0.4);
    assert.equal(result.informationDensity, density);
    assert.equal(result.deferNonCritical, defer);
    assert.equal(result.suppressAmbientActivity, suppressAmbient);
  }
});

test("HIGH reduces and defers on Cluster and Center, with marker eligible only on Center", () => {
  for (const role of ["cluster", "center"] as const) {
    const result = resolvePresentation({ role, load: "high", activeSafetyWarning: false });
    assert.equal(result.informationDensity, "reduced");
    assert.equal(result.deferNonCritical, true);
    assert.equal(result.suppressNonSafetyContent, false);
    assert.equal(result.centerHighLoadMarkerEligible, role === "center");
  }
});

test("CRITICAL suppresses non-safety content on driver displays, not passenger displays", () => {
  for (const role of ["cluster", "center"] as const) {
    const result = resolvePresentation({ role, load: "critical", activeSafetyWarning: false });
    assert.equal(result.informationDensity, "safety_only");
    assert.equal(result.suppressNonSafetyContent, true);
    assert.equal(result.centerHighLoadMarkerEligible, false);
  }
  const passenger = resolvePresentation({ role: "front_passenger", load: "critical", activeSafetyWarning: false });
  assert.equal(passenger.informationDensity, "rich");
  assert.equal(passenger.suppressNonSafetyContent, false);
  assert.equal(passenger.deferNonCritical, true);
});

test("active safety warning takes precedence on Cluster and Center at every load", () => {
  for (const role of ["cluster", "center"] as const) {
    for (const load of [undefined, "low", "normal", "high", "critical"] as const) {
      const result = resolvePresentation({ role, ...(load === undefined ? {} : { load }), activeSafetyWarning: true });
      assert.equal(result.safetyPriority, true);
      assert.equal(result.suppressNonSafetyContent, true);
      assert.equal(result.informationDensity, "safety_only");
      assert.equal(result.suppressAmbientActivity, true);
      assert.equal(result.centerHighLoadMarkerEligible, false);
    }
  }
});

test("non-driver roles retain their content density and are not driver-load suppressed", () => {
  for (const role of ["front_passenger", "rear", "interactive_window"] as const) {
    const high = resolvePresentation({ role, load: "high", activeSafetyWarning: false });
    assert.equal(high.informationDensity, "rich");
    assert.equal(high.deferNonCritical, true);
    assert.equal(high.suppressNonSafetyContent, false);
    assert.equal(high.centerHighLoadMarkerEligible, false);
    const warning = resolvePresentation({ role, load: "normal", activeSafetyWarning: true });
    assert.equal(warning.safetyPriority, true);
    assert.equal(warning.suppressNonSafetyContent, false);
  }
});

test("missing load uses concise defaults and preserves confidence as separate metadata", () => {
  const result = resolvePresentation({ role: "center", loadConfidence: 0.2, activeSafetyWarning: false });
  assert.equal(result.load, undefined);
  assert.equal(result.loadConfidence, 0.2);
  assert.equal(result.informationDensity, "concise");
  assert.equal(result.deferNonCritical, false);
  assert.equal(result.centerHighLoadMarkerEligible, false);
});

test("unknown runtime load metadata falls back without creating a fifth load level", () => {
  const result = resolvePresentation({
    role: "center",
    load: "uncertain" as never,
    activeSafetyWarning: false,
  });
  assert.equal(result.informationDensity, "concise");
  assert.equal(result.deferNonCritical, false);
  assert.equal(result.centerHighLoadMarkerEligible, false);
});

test("assistance level is a distinct concept and is not accepted as cognitive load", () => {
  const result = resolvePresentation({ role: "center", load: "normal", activeSafetyWarning: false });
  assert.equal(result.load, "normal");
  assert.equal("assistanceLevel" in result, false);
});

test("Quiet Mode and recovered cloud hold affect only Rear and Window", () => {
  for (const role of ["rear", "interactive_window", "cluster", "center", "front_passenger"] as const) {
    const zone = role === "rear" || role === "interactive_window";
    const quiet = resolvePresentation({ role, load: "normal", activeSafetyWarning: false, rearZoneMode: "quiet", cloudPresentation: "available_but_held" });
    assert.equal(quiet.suppressNonCriticalNotifications, zone);
    assert.equal(quiet.holdCloudInformation, zone);
    assert.equal(quiet.informationDensity, zone ? "reduced" : "concise");
    const resumed = resolvePresentation({ role, load: "normal", activeSafetyWarning: false, rearZoneMode: "normal", cloudPresentation: "presented" });
    assert.equal(resumed.holdCloudInformation, false);
    assert.equal(resumed.suppressNonCriticalNotifications, false);
    const held = resolvePresentation({ role, activeSafetyWarning: false, rearZoneMode: "normal", cloudPresentation: "available_but_held" });
    assert.equal(held.holdCloudInformation, zone);
  }
});
