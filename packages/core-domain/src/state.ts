import type { AuraSharedState } from "../../../contracts/protocol/src/types.js";

export function createInitialState(): AuraSharedState {
  return {
    revision: 0,
    rearExperience: { mode: "normal", liveJourney: "unavailable", source: "scenario-fixture" },
    vehicle: {
      speedKph: 0,
      gear: "UNKNOWN",
      drivingState: "unknown",
    },
    driver: {},
    activeProposals: [],
    activeTasks: [],
    latestSignals: {},
    displayConnections: {},
    journey: { stops: [] },
    connectivity: {
      mode: "degraded",
      source: "derived",
      observedAt: 0,
      freshness: "unknown",
      evidence: "CONNECTIVITY_UNCONFIRMED",
    },
    activeSafetyWarning: null,
  };
}
