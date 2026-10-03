import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { default as Ajv } from "ajv";
import type { AuraSharedState, JourneyRecommendationMessage, SignalFreshness, SignalSource } from "../../../contracts/protocol/src/types.js";
import type { JourneyEvidence, JourneyOption, JourneyRecommendationEvidenceSource, WholeJourneyEvidence } from "../src/journey-recommender.js";
import { recommendWholeJourney, scoreJourneyOptions } from "../src/journey-recommender.js";
import { SimulatedJourneyRecommendationEvidenceSource } from "../src/journey-recommendation-fixture.js";

const state = {} as AuraSharedState;
const message: JourneyRecommendationMessage = {
  kind: "journey.recommendation.request",
  protocolVersion: 1,
  requestId: "recommendation-1",
  traceId: "trace-1",
  requestText: "Find a dinner restaurant on this journey",
};

function evidence<T>(value: T, now: number, options: { source?: SignalSource; sourceLabel?: string; freshness?: SignalFreshness; observedAt?: number } = {}): JourneyEvidence<T> {
  return {
    value,
    source: options.source ?? "simulated",
    sourceLabel: options.sourceLabel ?? "journey-test-fixture",
    observedAt: options.observedAt ?? now,
    freshness: options.freshness ?? "fresh",
  };
}

function option(now: number, values: { placeId: string; label: string; poiQuality: number; detourMinutes: number }): JourneyOption {
  const identity = {
    placeId: values.placeId,
    label: values.label,
    category: "restaurant",
    provider: "simulated-fixture",
    use: "durable" as const,
  };
  return {
    placeId: values.placeId,
    label: values.label,
    category: "restaurant",
    identityEvidence: evidence(identity, now),
    poiQuality: evidence(values.poiQuality, now),
    detourMinutes: evidence(values.detourMinutes, now),
  };
}

function wholeJourney(now: number): WholeJourneyEvidence {
  return {
    origin: evidence({ label: "Munich", location: { latitude: 48.1372, longitude: 11.5756 } }, now),
    destination: evidence({ label: "Stuttgart", placeId: "stuttgart" }, now),
    currentRoute: evidence({ distanceMeters: 236_000, durationMinutes: 180 }, now),
    options: [
      option(now, { placeId: "harbor-table", label: "Harbor Table", poiQuality: 4.9, detourMinutes: 24 }),
      option(now, { placeId: "garden-cafe", label: "Garden Cafe", poiQuality: 4.4, detourMinutes: 6 }),
    ],
  };
}

function source(getEvidence: JourneyRecommendationEvidenceSource["getEvidence"]): JourneyRecommendationEvidenceSource {
  return { getEvidence };
}

test("fresh whole-journey evidence returns a Center consent proposal with a concrete tradeoff", async () => {
  const now = 10_000;
  const result = await recommendWholeJourney({ message, state, now, source: source(async () => wholeJourney(now)) });

  assert.equal(result.status, "proposal");
  if (result.status !== "proposal") return;
  assert.equal(result.centerProposal.targetRole, "center");
  assert.equal(result.centerProposal.requiresConsent, true);
  assert.equal(result.centerProposal.kind, "ADD_TRIP_STOP");
  assert.equal(result.centerProposal.payload.placeId, "garden-cafe");
  const recommendation = result.recommendation;
  assert.equal(recommendation.simulated, true);
  assert.ok(recommendation.rationale.some((line) => line.includes("detour 6 vs 24 min")));
  assert.ok(recommendation.evidence.every((item) => item.criterion !== "identityEvidence"));
  assert.equal("recommendation" in result.centerProposal.payload, false);
  assert.ok(recommendation.alternatives.length > 0);
  assert.ok(recommendation.alternatives[0]?.evidence.some((item) => item.criterion === "detourMinutes"));
  const schema = JSON.parse(readFileSync("contracts/protocol/schemas/protocol.schema.json", "utf8"));
  const ajv = new Ajv.default({ strict: false });
  ajv.addSchema(schema);
  const validate = ajv.compile({ $ref: "https://aura.local/schemas/protocol.schema.json#/definitions/journeyRecommendationResultsMessage" });
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
});

test("drop-off and charging request receives explicitly simulated evidence and ranks access facts", async () => {
  const now = 10_000;
  const fixture = new SimulatedJourneyRecommendationEvidenceSource();
  const evidenceSet = await fixture.getEvidence({ requestText: "找一個方便媽媽下車、附近有充電的地方", state, now });
  assert.ok(evidenceSet);
  assert.equal(evidenceSet?.options.length, 2);
  for (const option of evidenceSet?.options ?? []) {
    assert.equal(option.passengerDropoff?.source, "simulated");
    assert.equal(option.nearbyCharging?.source, "simulated");
  }
  const recommendation = scoreJourneyOptions(evidenceSet!.options, now, { prioritizePassengerDropoff: true });
  assert.ok(recommendation.selected);
  assert.equal(recommendation.simulated, true);
  assert.ok(recommendation.rationale.some((line) => line.includes("Passenger drop-off")));
  assert.ok(recommendation.rationale.some((line) => line.includes("Nearby charging")));
});

test("drop-off distance affects ranking only after the user confirms it matters", async () => {
  const now = 10_000;
  const evidenceSet = wholeJourney(now);
  for (const option of evidenceSet.options) {
    option.poiQuality = evidence(4, now);
    option.detourMinutes = evidence(10, now);
    option.passengerDropoff = evidence({ access: "curbside", distanceToEntranceMeters: option.placeId === "harbor-table" ? 5 : 400 }, now);
    option.nearbyCharging = evidence([], now);
  }
  const request = async (requestText: string) => recommendWholeJourney({
    message: { ...message, requestText }, state, now,
    source: source(async () => structuredClone(evidenceSet)),
  });
  const unspecified = await request("Find a dinner restaurant");
  const preferred = await request("Find a dinner restaurant; entrance proximity matters");
  const declined = await request("Find a dinner restaurant; entrance proximity not important");

  assert.equal(unspecified.status, "proposal");
  assert.equal(preferred.status, "proposal");
  assert.equal(declined.status, "proposal");
  if (unspecified.status === "proposal" && preferred.status === "proposal" && declined.status === "proposal") {
    assert.ok(!unspecified.recommendation.rationale.some((line) => line.startsWith("Passenger drop-off:")));
    assert.ok(preferred.recommendation.rationale.some((line) => line.startsWith("Passenger drop-off:")));
    assert.ok(!declined.recommendation.rationale.some((line) => line.startsWith("Passenger drop-off:")));
    assert.equal(preferred.centerProposal.payload.placeId, "harbor-table");
  }
});

test("missing evidence abstains", async () => {
  const result = await recommendWholeJourney({ message, state, source: source(async () => null), now: 10_000 });
  assert.equal(result.status, "abstained");
  if (result.status === "abstained") assert.equal(result.reasonCode, "WHOLE_JOURNEY_EVIDENCE_UNAVAILABLE");
});

test("missing whole-journey context abstains", async () => {
  const incomplete = wholeJourney(10_000) as Partial<WholeJourneyEvidence>;
  delete incomplete.origin;
  const result = await recommendWholeJourney({
    message,
    state,
    now: 10_000,
    source: source(async () => incomplete as WholeJourneyEvidence),
  });
  assert.equal(result.status, "abstained");
  if (result.status === "abstained") assert.equal(result.reasonCode, "WHOLE_JOURNEY_CONTEXT_INCOMPLETE_OR_STALE");
});

test("stale evidence abstains", async () => {
  const stale = wholeJourney(10_000);
  stale.origin = evidence({ label: "Munich", location: { latitude: 48.1372, longitude: 11.5756 } }, 10_000, {
    observedAt: 10_000 - 15 * 60 * 1000 - 1,
  });
  const result = await recommendWholeJourney({ message, state, now: 10_000, source: source(async () => stale) });
  assert.equal(result.status, "abstained");
  if (result.status === "abstained") assert.equal(result.reasonCode, "WHOLE_JOURNEY_CONTEXT_INCOMPLETE_OR_STALE");
});

test("temporary Search Box candidate evidence abstains", async () => {
  const transient = wholeJourney(10_000);
  transient.options[0]!.identityEvidence = evidence({
    placeId: "harbor-table",
    label: "Harbor Table",
    category: "restaurant",
    provider: "mapbox-search-box",
    use: "temporary",
  }, 10_000, { sourceLabel: "mapbox-search-box" });
  transient.options = [transient.options[0]!];
  const result = await recommendWholeJourney({ message, state, now: 10_000, source: source(async () => transient) });
  assert.equal(result.status, "abstained");
  if (result.status === "abstained") assert.equal(result.reasonCode, "NO_CANDIDATE_WITH_FRESH_ROUTE_DETOUR_EVIDENCE");
});

test("default clock accepts fresh evidence stamped after the async source starts", async () => {
  const originalNow = Date.now;
  let wallClock = 50_000;
  Date.now = () => wallClock;
  try {
    const evidenceSource = source(async () => {
      wallClock += 1;
      return wholeJourney(wallClock);
    });
    const result = await recommendWholeJourney({ message, state, source: evidenceSource });
    assert.equal(result.status, "proposal");
  } finally {
    Date.now = originalNow;
  }
});

test("injected clock is forwarded to source and future evidence remains rejected", async () => {
  const now = 70_000;
  let receivedNow: number | undefined;
  const fixedSource = source(async (input) => {
    receivedNow = input.now;
    return wholeJourney(input.now ?? now);
  });
  const accepted = await recommendWholeJourney({ message, state, now, source: fixedSource });
  assert.equal(accepted.status, "proposal");
  assert.equal(receivedNow, now);

  const future = await recommendWholeJourney({
    message,
    state,
    now,
    source: source(async () => wholeJourney(now + 1)),
  });
  assert.equal(future.status, "abstained");
  if (future.status === "abstained") assert.equal(future.reasonCode, "WHOLE_JOURNEY_CONTEXT_INCOMPLETE_OR_STALE");
});
