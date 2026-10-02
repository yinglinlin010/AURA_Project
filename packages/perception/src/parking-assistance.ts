import type { PerceptionObservation } from "./types.js";

export interface ParkingAssistanceAssessment {
  schemaVersion: "aura.perception.assessment.v1";
  assessmentId: string;
  observationId: string;
  reality: "real" | "simulated";
  source: PerceptionObservation["source"];
  observedAt: string;
  freshness: PerceptionObservation["freshness"];
  inputConfidence: number;
  uncertainty: PerceptionObservation["uncertainty"];
  helpLikelihood: number;
  outcome: "OFFER" | "NO_OFFER" | "UNCERTAIN";
  offer: null | {
    type: "proactive_assistance_offer";
    text: "Would you like parking guidance?";
    targetRole: "center";
    requiresConsent: true;
  };
  boundaries: {
    vehicleControlAllowed: false;
    diagnosisAllowed: false;
    automaticActionAllowed: false;
  };
  reasons: string[];
}

const cueWeights: Record<PerceptionObservation["parkingContext"]["cues"][number], number> = {
  parking_maneuver_active: 0.35,
  repeated_adjustment: 0.25,
  unfamiliar_parking_context: 0.15,
  driver_requested_guidance: 0.45,
};

/** Pure deterministic fixture logic; it neither captures camera data nor proposes vehicle actuation. */
export function assessParkingAssistance(
  observation: PerceptionObservation,
): ParkingAssistanceAssessment {
  validatePerceptionObservation(observation);
  const likelihood = Math.min(
    1,
    Number(observation.parkingContext.cues.reduce((sum, cue) => sum + cueWeights[cue], 0).toFixed(2)),
  );
  const reasons: string[] = [];
  if (observation.reality === "simulated") reasons.push("SIMULATED_INPUT");
  if (observation.permission.state !== "granted" && observation.reality === "real") reasons.push("PERMISSION_NOT_GRANTED");
  if (
    observation.freshness.state !== "fresh" ||
    observation.freshness.ageMs === null ||
    observation.freshness.ageMs > observation.freshness.maxAgeMs
  ) reasons.push("OBSERVATION_NOT_FRESH");
  if (observation.confidence < 0.7) reasons.push("CONFIDENCE_BELOW_OFFER_THRESHOLD");
  if (observation.uncertainty.level === "high" || observation.uncertainty.level === "unknown") reasons.push("UNCERTAINTY_TOO_HIGH");
  if (observation.parkingContext.phase === "unknown" || observation.parkingContext.phase === "parked") reasons.push("NO_ACTIVE_PARKING_CONTEXT");

  const gated = reasons.some((reason) => !["SIMULATED_INPUT", "NO_ACTIVE_PARKING_CONTEXT"].includes(reason));
  const activeParking = observation.parkingContext.phase !== "unknown" && observation.parkingContext.phase !== "parked";
  const qualifies = !gated && activeParking && likelihood >= 0.6;
  const outcome = qualifies ? "OFFER" : gated ? "UNCERTAIN" : "NO_OFFER";
  return {
    schemaVersion: "aura.perception.assessment.v1",
    assessmentId: `assessment:${observation.observationId}`,
    observationId: observation.observationId,
    reality: observation.reality,
    source: observation.source,
    observedAt: observation.observedAt,
    freshness: observation.freshness,
    inputConfidence: observation.confidence,
    uncertainty: observation.uncertainty,
    helpLikelihood: likelihood,
    outcome,
    offer: qualifies ? {
      type: "proactive_assistance_offer",
      text: "Would you like parking guidance?",
      targetRole: "center",
      requiresConsent: true,
    } : null,
    boundaries: {
      vehicleControlAllowed: false,
      diagnosisAllowed: false,
      automaticActionAllowed: false,
    },
    reasons,
  };
}

/** Reject malformed or contradictory provenance before assessment. */
export function validatePerceptionObservation(value: PerceptionObservation): void {
  if (!value || value.schemaVersion !== "aura.perception.observation.v1") throw new Error("INVALID_PERCEPTION_SCHEMA_VERSION");
  if (!value.observationId || !Number.isFinite(Date.parse(value.observedAt)) || !Number.isFinite(Date.parse(value.receivedAt))) throw new Error("INVALID_PERCEPTION_ID_OR_TIME");
  if (!(value.reality === "real" || value.reality === "simulated")) throw new Error("INVALID_PERCEPTION_REALITY");
  if (!(value.source.kind === "camera" || value.source.kind === "context" || value.source.kind === "simulator") || !value.source.sourceId) throw new Error("INVALID_PERCEPTION_SOURCE");
  if (value.reality === "simulated" && (value.source.kind !== "simulator" || value.permission.state !== "not_applicable_simulation")) throw new Error("SIMULATION_PROVENANCE_MISMATCH");
  if (value.reality === "real" && (value.source.kind === "simulator" || value.permission.state === "not_applicable_simulation")) throw new Error("REAL_PROVENANCE_MISMATCH");
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error("INVALID_PERCEPTION_CONFIDENCE");
  if (!Number.isInteger(value.freshness.maxAgeMs) || value.freshness.maxAgeMs < 1 || (value.freshness.ageMs !== null && (!Number.isInteger(value.freshness.ageMs) || value.freshness.ageMs < 0))) throw new Error("INVALID_PERCEPTION_FRESHNESS");
  if (!(value.freshness.state === "fresh" || value.freshness.state === "stale" || value.freshness.state === "unknown")) throw new Error("INVALID_PERCEPTION_FRESHNESS_STATE");
  if (!(value.uncertainty.level === "low" || value.uncertainty.level === "moderate" || value.uncertainty.level === "high" || value.uncertainty.level === "unknown") || !Array.isArray(value.uncertainty.reasons)) throw new Error("INVALID_PERCEPTION_UNCERTAINTY");
  if (!(value.permission.state === "granted" || value.permission.state === "denied" || value.permission.state === "not_requested" || value.permission.state === "revoked" || value.permission.state === "not_applicable_simulation") || value.permission.scope !== "parking_context_observation") throw new Error("INVALID_PERCEPTION_PERMISSION");
  if (!(value.parkingContext.phase === "searching" || value.parkingContext.phase === "approaching" || value.parkingContext.phase === "maneuvering" || value.parkingContext.phase === "parked" || value.parkingContext.phase === "unknown") || !Array.isArray(value.parkingContext.cues)) throw new Error("INVALID_PARKING_CONTEXT");
  const allowedCues = new Set(["parking_maneuver_active", "repeated_adjustment", "unfamiliar_parking_context", "driver_requested_guidance"]);
  if (value.parkingContext.cues.some((cue) => !allowedCues.has(cue))) throw new Error("INVALID_PARKING_CUE");
}
