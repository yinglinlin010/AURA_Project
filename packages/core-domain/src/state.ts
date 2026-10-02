import type { AuraSharedState } from "../../../contracts/protocol/src/types.js";

export function createInitialState(): AuraSharedState {
  return {
    revision: 0,
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
  };
}
