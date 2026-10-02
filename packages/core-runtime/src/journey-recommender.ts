import type {
  ActionProposalRequest,
  AuraSharedState,
  JourneyRecommendationMessage,
  JourneyRecommendationResultMessage,
  SignalFreshness,
  SignalSource,
} from "../../../contracts/protocol/src/types.js";

/** Every recommendation input carries its origin and freshness so simulated or stale data is never presented as live. */
export interface JourneyEvidence<T> {
  value: T;
  source: SignalSource;
  sourceLabel: string;
  observedAt: number;
  freshness: SignalFreshness;
}

export interface JourneyFollowUp {
  label: string;
  category: string;
  walkingDistanceKm: JourneyEvidence<number>;
}

export interface JourneyOption {
  placeId: string;
  label: string;
  category: string;
  identityEvidence?: JourneyEvidence<{
    placeId: string;
    label: string;
    category: string;
    provider: string;
    use?: "temporary" | "durable";
  }>;
  poiQuality?: JourneyEvidence<number>; // 0–5
  detourMinutes?: JourneyEvidence<number>;
  parkingAvailability?: JourneyEvidence<"available" | "limited" | "unavailable" | "unknown">;
  parkingType?: JourneyEvidence<"onsite" | "street" | "garage" | "none" | "unknown">;
  parkingCost?: JourneyEvidence<{ amount: number; currency: string }>;
  trafficDelayMinutes?: JourneyEvidence<number>;
  weatherImpact?: JourneyEvidence<"favorable" | "neutral" | "adverse">;
  arrivalMinutes?: JourneyEvidence<number>;
  deadlineMinutes?: JourneyEvidence<number>;
  walkingDistanceKm?: JourneyEvidence<number>;
  preferenceFit?: JourneyEvidence<number>; // 0–1
  nearbyFollowUps?: JourneyEvidence<JourneyFollowUp[]>;
}

export interface JourneyAnchor {
  label: string;
  placeId?: string;
  location?: { latitude: number; longitude: number };
}

export interface WholeJourneyEvidence {
  origin: JourneyEvidence<JourneyAnchor>;
  destination: JourneyEvidence<JourneyAnchor>;
  currentRoute: JourneyEvidence<{ distanceMeters: number; durationMinutes: number }>;
  options: JourneyOption[];
}

/** Implementations must return facts for the complete requested trip, never a transient search result alone. */
export interface JourneyRecommendationEvidenceSource {
  getEvidence(input: {
    requestText: string;
    state: Readonly<AuraSharedState>;
    /** Optional deterministic clock forwarded by the caller for freshness checks. */
    now?: number;
  }): Promise<WholeJourneyEvidence | null>;
}

export interface JourneyRecommendation {
  selected: JourneyOption | null;
  score: number | null;
  simulated: boolean;
  evidenceCoverage: number;
  rationale: string[];
  alternatives: Array<{ placeId: string; label: string; score: number }>;
}

type ScoredOption = { option: JourneyOption; score: number; rationale: string[]; used: number; simulated: boolean };

const EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000;
const usable = <T>(e: JourneyEvidence<T> | undefined, now: number): e is JourneyEvidence<T> =>
  !!e &&
  (e.freshness === "fresh" || e.freshness === "cached") &&
  Number.isInteger(e.observedAt) &&
  e.observedAt <= now &&
  now - e.observedAt <= EVIDENCE_MAX_AGE_MS &&
  typeof e.sourceLabel === "string" &&
  e.sourceLabel.trim().length > 0 &&
  e.sourceLabel.length <= 128 &&
  (["sensor", "simulated", "api", "derived", "cache"] as string[]).includes(e.source);
const numeric = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** Deterministic whole-journey ranking. Missing/stale inputs contribute no score and are called out. */
export function scoreJourneyOptions(options: JourneyOption[], now = Date.now()): JourneyRecommendation {
  const scored: ScoredOption[] = options.map((option) => {
    let score = 50;
    let used = 0;
    const rationale: string[] = [];
    let simulated = false;
    const apply = <T>(e: JourneyEvidence<T> | undefined, weight: number, value: (v: T) => number, explanation: (v: T) => string) => {
      if (!usable(e, now)) return;
      score += weight * value(e.value);
      used++;
      simulated ||= e.source === "simulated";
      rationale.push(explanation(e.value));
    };
    apply(option.poiQuality, 5, (v) => (numeric(v, 0, 5) - 2.5) / 2.5, (v) => `POI quality ${numeric(v, 0, 5).toFixed(1)}/5.`);
    apply(option.detourMinutes, 12, (v) => 1 - numeric(v, 0, 60) / 30, (v) => `${numeric(v, 0, 60)} min route detour.`);
    apply(option.parkingAvailability, 10, (v) => ({ available: 1, limited: 0.25, unavailable: -1, unknown: 0 }[v]), (v) => `Parking is ${v}.`);
    apply(option.parkingType, 3, (v) => ({ onsite: 1, garage: 0.5, street: 0, none: -1, unknown: 0 }[v]), (v) => `Parking type: ${v}.`);
    apply(option.parkingCost, 4, (v) => 1 - numeric(v.amount, 0, 20) / 10, (v) => `Parking cost ${v.amount} ${v.currency}.`);
    apply(option.trafficDelayMinutes, 8, (v) => 1 - numeric(v, 0, 45) / 22.5, (v) => `${numeric(v, 0, 45)} min traffic delay.`);
    apply(option.weatherImpact, 3, (v) => ({ favorable: 1, neutral: 0, adverse: -1 }[v]), (v) => `Weather impact is ${v}.`);
    if (usable(option.arrivalMinutes, now) && usable(option.deadlineMinutes, now)) {
      const slack = option.deadlineMinutes.value - option.arrivalMinutes.value;
      score += 12 * (slack >= 20 ? 1 : slack >= 0 ? 0.4 : -1);
      used++;
      simulated ||= option.arrivalMinutes.source === "simulated" || option.deadlineMinutes.source === "simulated";
      rationale.push(slack >= 0 ? `${slack} min deadline margin.` : `${Math.abs(slack)} min past the arrival deadline.`);
    }
    apply(option.walkingDistanceKm, 5, (v) => 1 - numeric(v, 0, 5) / 2.5, (v) => `${numeric(v, 0, 5)} km walking distance.`);
    apply(option.preferenceFit, 8, (v) => (numeric(v, 0, 1) - 0.5) * 2, (v) => `Preference-fit score ${numeric(v, 0, 1).toFixed(2)}/1.`);
    apply(option.nearbyFollowUps, 5, (v) => numeric(v.length, 0, 3) / 3, (v) => `${v.length} nearby follow-up option(s).`);
    return { option, score, rationale, used, simulated };
  }).sort((a, b) => b.score - a.score || a.option.placeId.localeCompare(b.option.placeId));

  const best = scored[0];
  if (!best) return { selected: null, score: null, simulated: false, evidenceCoverage: 0, rationale: ["No journey options supplied."], alternatives: [] };
  if (best.used === 0) {
    return {
      selected: null,
      score: null,
      simulated: scored.some((item) => item.simulated),
      evidenceCoverage: 0,
      rationale: ["No fresh or cached evidence was available; no journey recommendation is substantiated."],
      alternatives: scored.map(({ option, score }) => ({ placeId: option.placeId, label: option.label, score })),
    };
  }
  const rationale = [...best.rationale];
  if (scored[1]) {
    const other = scored[1];
    rationale.push(describeTradeoff(best, other, now));
  }
  return {
    selected: best.option,
    score: best.score,
    simulated: scored.some((item) => item.simulated),
    evidenceCoverage: best.used / 11,
    rationale,
    alternatives: scored.slice(1).map(({ option, score }) => ({ placeId: option.placeId, label: option.label, score })),
  };
}

/** Build a governed proposal after a person chooses a recommendation; never executes or grants consent. */
export function recommendationStopProposal(recommendation: JourneyRecommendation, proposalId: string): ActionProposalRequest | null {
  const place = recommendation.selected;
  if (!place) return null;
  return {
    proposalId,
    kind: "ADD_TRIP_STOP",
    summary: `Add ${place.label} to the journey`,
    targetRole: "center",
    priority: "secondary",
    requiresConsent: true,
    payload: { placeId: place.placeId, label: place.label, category: place.category },
  };
}

/** Runs the safe caller path. Missing or incomplete whole-trip evidence always abstains. */
export async function recommendWholeJourney(input: {
  message: JourneyRecommendationMessage;
  state: Readonly<AuraSharedState>;
  source?: JourneyRecommendationEvidenceSource;
  now?: number;
}): Promise<JourneyRecommendationResultMessage> {
  const { message } = input;
  const abstain = (reasonCode: string): JourneyRecommendationResultMessage => ({
    kind: "journey.recommendation.result",
    protocolVersion: 1,
    requestId: message.requestId,
    traceId: message.traceId,
    status: "abstained",
    reasonCode,
  });

  if (!input.source) return abstain("WHOLE_JOURNEY_EVIDENCE_SOURCE_UNAVAILABLE");

  let evidence: WholeJourneyEvidence | null;
  try {
    evidence = await input.source.getEvidence({
      requestText: message.requestText,
      state: input.state,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
  } catch {
    return abstain("WHOLE_JOURNEY_EVIDENCE_SOURCE_FAILED");
  }
  if (!evidence) return abstain("WHOLE_JOURNEY_EVIDENCE_UNAVAILABLE");

  // Use post-fetch wall time so evidence stamped during the async source call is not rejected as future.
  // An injected clock remains fixed for deterministic callers and is forwarded to the source above.
  const now = input.now ?? Date.now();

  if (
    !validAnchorEvidence(evidence.origin, now, true) ||
    !validAnchorEvidence(evidence.destination, now, false) ||
    !usable(evidence.currentRoute, now) ||
    isTransientSearchEvidence(evidence.currentRoute) ||
    !validRoute(evidence.currentRoute.value) ||
    !Array.isArray(evidence.options)
  ) {
    return abstain("WHOLE_JOURNEY_CONTEXT_INCOMPLETE_OR_STALE");
  }

  const eligibleOptions = evidence.options.filter((option) =>
    isRecord(option) &&
    validId(option.placeId, 256) &&
    validText(option.label, 256) &&
    validText(option.category, 128) &&
    validPlaceIdentity(option, now) &&
    usable(option.detourMinutes, now) &&
    Number.isFinite(option.detourMinutes.value) &&
    option.detourMinutes.value >= 0 &&
    validOptionEvidenceValues(option, now),
  );
  if (eligibleOptions.length === 0) return abstain("NO_CANDIDATE_WITH_FRESH_ROUTE_DETOUR_EVIDENCE");

  const recommendation = scoreJourneyOptions(eligibleOptions, now);
  if (!recommendation.selected || recommendation.score === null || !Number.isFinite(recommendation.score)) {
    return abstain("NO_FRESH_DECISION_EVIDENCE");
  }

  const proposal = recommendationStopProposal(recommendation, message.requestId);
  if (!proposal) return abstain("NO_SUBSTANTIATED_RECOMMENDATION");

  const supportingEvidence = evidenceSummary(recommendation.selected, now);
  if (!supportingEvidence.some((item) => item.criterion === "detourMinutes")) {
    return abstain("NO_FRESH_ROUTE_DETOUR_EVIDENCE");
  }
  const simulatedEvidence = [evidence.origin, evidence.destination, evidence.currentRoute, ...supportingEvidence]
    .some((item) => item.source === "simulated");
  proposal.payload.recommendation = {
    score: recommendation.score,
    simulated: recommendation.simulated || simulatedEvidence,
    evidenceCoverage: recommendation.evidenceCoverage,
    rationale: recommendation.rationale,
    evidence: supportingEvidence,
    wholeJourneyContext: [
      evidenceSummaryItem("origin", evidence.origin),
      evidenceSummaryItem("destination", evidence.destination),
      evidenceSummaryItem("currentRoute", evidence.currentRoute),
    ],
  };

  return {
    kind: "journey.recommendation.result",
    protocolVersion: 1,
    requestId: message.requestId,
    traceId: message.traceId,
    status: "proposal",
    centerProposal: proposal,
  };
}

function validAnchorEvidence(evidence: JourneyEvidence<JourneyAnchor>, now: number, requiresLocation: boolean): boolean {
  return usable(evidence, now) && !isTransientSearchEvidence(evidence) && isRecord(evidence.value) &&
    validText(evidence.value.label, 256) &&
    (requiresLocation
      ? validGeoPoint(evidence.value.location)
      : validId(evidence.value.placeId, 256) || validGeoPoint(evidence.value.location));
}

function validGeoPoint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.latitude === "number" && Number.isFinite(value.latitude) && value.latitude >= -90 && value.latitude <= 90 &&
    typeof value.longitude === "number" && Number.isFinite(value.longitude) && value.longitude >= -180 && value.longitude <= 180;
}

function validPlaceIdentity(option: JourneyOption, now: number): boolean {
  const evidence = option.identityEvidence;
  if (!usable(evidence, now) || isTransientSearchEvidence(evidence) || !isRecord(evidence.value)) return false;
  return evidence.value.placeId === option.placeId &&
    evidence.value.label === option.label &&
    evidence.value.category === option.category &&
    validText(evidence.value.provider, 96) &&
    !evidence.value.provider.toLowerCase().replace(/[^a-z0-9]/g, "").includes("mapboxsearch") &&
    evidence.value.use === "durable";
}

function isTransientSearchEvidence(evidence: JourneyEvidence<unknown>): boolean {
  return evidence.sourceLabel.toLowerCase().replace(/[^a-z0-9]/g, "").includes("mapboxsearch");
}

function validRoute(value: { distanceMeters: number; durationMinutes: number }): boolean {
  return isRecord(value) &&
    Number.isFinite(value.distanceMeters) && value.distanceMeters >= 0 &&
    Number.isFinite(value.durationMinutes) && value.durationMinutes >= 0;
}

function evidenceSummary(option: JourneyOption, now: number): Array<{ criterion: string; source: SignalSource; sourceLabel: string; observedAt: number; freshness: SignalFreshness }> {
  return Object.entries(option)
    .filter(([key, value]) => key !== "placeId" && key !== "label" && key !== "category" && key !== "identityEvidence" && usable(value as JourneyEvidence<unknown> | undefined, now))
    .map(([criterion, value]) => {
      const evidence = value as JourneyEvidence<unknown>;
      return { criterion, source: evidence.source, sourceLabel: evidence.sourceLabel, observedAt: evidence.observedAt, freshness: evidence.freshness };
    });
}

function describeTradeoff(best: ScoredOption, other: ScoredOption, now: number): string {
  const factors: string[] = [];
  if (usable(best.option.poiQuality, now) && usable(other.option.poiQuality, now)) {
    factors.push(`POI rating ${numeric(best.option.poiQuality.value, 0, 5).toFixed(1)} vs ${numeric(other.option.poiQuality.value, 0, 5).toFixed(1)}/5`);
  }
  if (usable(best.option.detourMinutes, now) && usable(other.option.detourMinutes, now)) {
    factors.push(`detour ${numeric(best.option.detourMinutes.value, 0, 60)} vs ${numeric(other.option.detourMinutes.value, 0, 60)} min`);
  }
  if (usable(best.option.parkingAvailability, now) && usable(other.option.parkingAvailability, now)) {
    factors.push(`parking ${best.option.parkingAvailability.value} vs ${other.option.parkingAvailability.value}`);
  }
  if (usable(best.option.arrivalMinutes, now) && usable(best.option.deadlineMinutes, now) &&
      usable(other.option.arrivalMinutes, now) && usable(other.option.deadlineMinutes, now)) {
    const bestSlack = best.option.deadlineMinutes.value - best.option.arrivalMinutes.value;
    const otherSlack = other.option.deadlineMinutes.value - other.option.arrivalMinutes.value;
    factors.push(`deadline margin ${bestSlack} vs ${otherSlack} min`);
  }
  if (usable(best.option.nearbyFollowUps, now) && usable(other.option.nearbyFollowUps, now)) {
    factors.push(`nearby follow-ups ${best.option.nearbyFollowUps.value.length} vs ${other.option.nearbyFollowUps.value.length}`);
  }
  const comparison = factors.length > 0 ? factors.join(", ") : "no shared fresh comparison factors";
  return `Tradeoff: ${best.option.label.slice(0, 64)} (${best.score.toFixed(1)}) over ${other.option.label.slice(0, 64)} (${other.score.toFixed(1)}); ${comparison}.`;
}

function evidenceSummaryItem(criterion: string, evidence: JourneyEvidence<unknown>): { criterion: string; source: SignalSource; sourceLabel: string; observedAt: number; freshness: SignalFreshness } {
  return { criterion, source: evidence.source, sourceLabel: evidence.sourceLabel, observedAt: evidence.observedAt, freshness: evidence.freshness };
}

function validOptionEvidenceValues(option: JourneyOption, now: number): boolean {
  const numericEvidence = [option.poiQuality, option.detourMinutes, option.trafficDelayMinutes, option.arrivalMinutes, option.deadlineMinutes, option.walkingDistanceKm, option.preferenceFit];
  if (numericEvidence.some((evidence) => evidence && usable(evidence, now) && !Number.isFinite(evidence.value))) return false;
  if (option.parkingAvailability && usable(option.parkingAvailability, now) &&
    !["available", "limited", "unavailable", "unknown"].includes(option.parkingAvailability.value)) return false;
  if (option.parkingType && usable(option.parkingType, now) &&
    !["onsite", "street", "garage", "none", "unknown"].includes(option.parkingType.value)) return false;
  if (option.weatherImpact && usable(option.weatherImpact, now) &&
    !["favorable", "neutral", "adverse"].includes(option.weatherImpact.value)) return false;
  if (option.parkingCost && usable(option.parkingCost, now) &&
    (!isRecord(option.parkingCost.value) || !Number.isFinite(option.parkingCost.value.amount) ||
      option.parkingCost.value.amount < 0 || !validText(option.parkingCost.value.currency, 8))) return false;
  if (option.nearbyFollowUps && usable(option.nearbyFollowUps, now) &&
    (!Array.isArray(option.nearbyFollowUps.value) || option.nearbyFollowUps.value.some((item) =>
      !isRecord(item) || !validText(item.label, 256) || !validText(item.category, 128) ||
      !usable(item.walkingDistanceKm, now) || !Number.isFinite(item.walkingDistanceKm.value) || item.walkingDistanceKm.value < 0))) return false;
  return true;
}

function validText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function validId(value: unknown, maxLength: number): value is string {
  return validText(value, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
