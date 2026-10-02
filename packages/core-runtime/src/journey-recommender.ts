import type { ActionProposalRequest, SignalFreshness, SignalSource } from "../../../contracts/protocol/src/types.js";

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

export interface JourneyRecommendation {
  selected: JourneyOption | null;
  score: number | null;
  simulated: boolean;
  evidenceCoverage: number;
  rationale: string[];
  alternatives: Array<{ placeId: string; label: string; score: number }>;
}

type ScoredOption = { option: JourneyOption; score: number; rationale: string[]; used: number; simulated: boolean };

const usable = <T>(e?: JourneyEvidence<T>): e is JourneyEvidence<T> => !!e && e.freshness !== "stale" && e.freshness !== "unknown";
const numeric = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** Deterministic whole-journey ranking. Missing/stale inputs contribute no score and are called out. */
export function scoreJourneyOptions(options: JourneyOption[]): JourneyRecommendation {
  const scored: ScoredOption[] = options.map((option) => {
    let score = 50;
    let used = 0;
    const rationale: string[] = [];
    let simulated = false;
    const apply = <T>(e: JourneyEvidence<T> | undefined, weight: number, value: (v: T) => number, explanation: (v: T) => string) => {
      if (!usable(e)) return;
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
    if (usable(option.arrivalMinutes) && usable(option.deadlineMinutes)) {
      const slack = option.deadlineMinutes.value - option.arrivalMinutes.value;
      score += 12 * (slack >= 20 ? 1 : slack >= 0 ? 0.4 : -1);
      used++;
      simulated ||= option.arrivalMinutes.source === "simulated" || option.deadlineMinutes.source === "simulated";
      rationale.push(slack >= 0 ? `${slack} min deadline margin.` : `${Math.abs(slack)} min past the arrival deadline.`);
    }
    apply(option.walkingDistanceKm, 5, (v) => 1 - numeric(v, 0, 5) / 2.5, (v) => `${numeric(v, 0, 5)} km walking distance.`);
    apply(option.preferenceFit, 8, (v) => (numeric(v, 0, 1) - 0.5) * 2, () => "Matches stated preferences.");
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
    rationale.push(`Tradeoff: ${best.option.label} ranks above ${other.option.label} (${best.score.toFixed(1)} vs ${other.score.toFixed(1)}); compare the listed route, parking, deadline, and preference factors.`);
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
