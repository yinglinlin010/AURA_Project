import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AuraSharedState } from "../../../contracts/protocol/src/types.js";
import type {
  JourneyAnchor,
  JourneyEvidence,
  JourneyOption,
  JourneyRecommendationEvidenceSource,
  WholeJourneyEvidence,
} from "./journey-recommender.js";

const FIXTURE_RELATIVE_PATH = "scenarios/fixtures/journey-recommendation-tradeoff.json";
const FIXTURE_SOURCE_LABEL = "journey-recommendation-tradeoff fixture";

/**
 * Credential-free, explicitly simulated source for the local tradeoff fixture.
 * This source does not query providers or read the current trip as live evidence.
 */
export class SimulatedJourneyRecommendationEvidenceSource implements JourneyRecommendationEvidenceSource {
  async getEvidence(input: { requestText: string; state: Readonly<AuraSharedState>; now?: number }): Promise<WholeJourneyEvidence | null> {
    void input.state;
    if (!isRestaurantRequest(input.requestText)) return null;

    try {
      const fixture = JSON.parse(readFileSync(findFixturePath(), "utf8")) as unknown;
      if (!isRecord(fixture) || typeof fixture.fixtureLabel !== "string" ||
          !fixture.fixtureLabel.startsWith("SIMULATED") || !Array.isArray(fixture.options)) return null;

      const now = input.now ?? Date.now();
      const origin = refreshEvidence(fixture.origin, now) as JourneyEvidence<JourneyAnchor> | undefined;
      const destination = refreshEvidence(fixture.destination, now) as JourneyEvidence<JourneyAnchor> | undefined;
      const currentRoute = refreshEvidence(fixture.currentRoute, now) as WholeJourneyEvidence["currentRoute"] | undefined;
      const options = fixture.options.map((option) => refreshEvidence(option, now) as JourneyOption | undefined);
      if (!origin || !destination || !currentRoute || options.some((option) => !option)) return null;

      return { origin, destination, currentRoute, options: options as JourneyOption[] };
    } catch {
      return null;
    }
  }
}

function isRestaurantRequest(requestText: string): boolean {
  const normalized = requestText.trim();
  if (normalized.length === 0) return false;
  return /\b(?:restaurant|dinner|lunch|meal|food|eatery)\b|餐廳|餐厅|晚餐|午餐|用餐|吃飯|吃饭/i.test(normalized);
}

function findFixturePath(): string {
  let directory = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(directory, FIXTURE_RELATIVE_PATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error("SIMULATED_JOURNEY_FIXTURE_NOT_FOUND");
}

/** Rebase fixture timestamps to request time and force every fixture fact to simulated provenance. */
function refreshEvidence(value: unknown, observedAt: number): unknown {
  if (Array.isArray(value)) return value.map((item) => refreshEvidence(item, observedAt));
  if (!isRecord(value)) return value;
  if (Object.prototype.hasOwnProperty.call(value, "value") &&
      Object.prototype.hasOwnProperty.call(value, "source") &&
      Object.prototype.hasOwnProperty.call(value, "freshness")) {
    return {
      value: refreshEvidence(value.value, observedAt),
      source: "simulated",
      sourceLabel: FIXTURE_SOURCE_LABEL,
      observedAt,
      freshness: "fresh",
    };
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, refreshEvidence(item, observedAt)]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
