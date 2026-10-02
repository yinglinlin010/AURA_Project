export interface PerceptionObservation {
  schemaVersion: "aura.perception.observation.v1";
  observationId: string;
  observedAt: string;
  receivedAt: string;
  reality: "real" | "simulated";
  source: { kind: "camera" | "context" | "simulator"; sourceId: string };
  freshness: { state: "fresh" | "stale" | "unknown"; ageMs: number | null; maxAgeMs: number };
  confidence: number;
  uncertainty: { level: "low" | "moderate" | "high" | "unknown"; reasons: string[] };
  permission: {
    state: "granted" | "denied" | "not_requested" | "revoked" | "not_applicable_simulation";
    scope: "parking_context_observation";
    grantedAt?: string;
  };
  parkingContext: {
    phase: "searching" | "approaching" | "maneuvering" | "parked" | "unknown";
    cues: Array<"parking_maneuver_active" | "repeated_adjustment" | "unfamiliar_parking_context" | "driver_requested_guidance">;
  };
}
