import type { PerceptionObservation } from "../../packages/perception/src/types.js";

/** Synthetic fixture only: no camera, physical vehicle, network, or user data. */
export function createSimulatedParkingObservation(
  observationId = "m5-simulated-parking-guidance",
  cues: PerceptionObservation["parkingContext"]["cues"] = [
    "parking_maneuver_active",
    "repeated_adjustment",
    "unfamiliar_parking_context",
  ],
): PerceptionObservation {
  const timestamp = "2026-01-01T00:00:00.000Z";
  return {
    schemaVersion: "aura.perception.observation.v1",
    observationId,
    observedAt: timestamp,
    receivedAt: timestamp,
    reality: "simulated",
    source: { kind: "simulator", sourceId: "fixture:parking-context-v1" },
    freshness: { state: "fresh", ageMs: 0, maxAgeMs: 1000 },
    confidence: 0.92,
    uncertainty: { level: "low", reasons: ["SYNTHETIC_FIXTURE_SIGNAL"] },
    permission: { state: "not_applicable_simulation", scope: "parking_context_observation" },
    parkingContext: { phase: "maneuvering", cues },
  };
}
