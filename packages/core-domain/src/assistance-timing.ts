/** Explainable timing policy for non-actuating assistant information. */
export type InformationValue = "negligible" | "useful" | "important";
export type AssistanceUrgency = "low" | "normal" | "high" | "critical";
export type InterruptionCost = "low" | "moderate" | "high";
export type DriverLoad = "low" | "normal" | "high" | "critical" | "unknown";
export type Sensitivity = "ordinary" | "sensitive";

export interface AssistanceTimingInput {
  informationValue: InformationValue;
  urgency: AssistanceUrgency;
  interruptionCost: InterruptionCost;
  driverLoad: DriverLoad;
  /** Explicit user authorization to route this item to an available passenger. */
  passengerHandoffAuthorized: boolean;
  sensitivity: Sensitivity;
}

export type AssistanceTimingOutcome = "immediate" | "deferred" | "passenger_handoff" | "silence";
export type AssistanceTimingReason =
  | "INFORMATION_NOT_ACTIONABLE"
  | "SENSITIVE_CONTENT_WITHHELD"
  | "AUTHORIZED_PASSENGER_HANDOFF"
  | "URGENT_INFORMATION"
  | "DRIVER_LOAD_HIGH"
  | "INTERRUPTION_COST_HIGH"
  | "LOW_VALUE_LOW_URGENCY"
  | "SAFE_TO_PRESENT_NOW";

export interface AssistanceTimingDecision {
  outcome: AssistanceTimingOutcome;
  reasonCode: AssistanceTimingReason;
  /** False means the content itself must not be rendered or spoken. */
  exposeContent: boolean;
}

/**
 * Selects when non-actuating assistance may be presented. It never approves
 * an action or transfers driver authority. Sensitive material is always
 * withheld from this presentation path, including passenger handoff.
 */
export function decideAssistanceTiming(input: AssistanceTimingInput): AssistanceTimingDecision {
  if (input.informationValue === "negligible") {
    return { outcome: "silence", reasonCode: "INFORMATION_NOT_ACTIONABLE", exposeContent: false };
  }

  if (input.sensitivity === "sensitive") {
    return { outcome: "deferred", reasonCode: "SENSITIVE_CONTENT_WITHHELD", exposeContent: false };
  }

  const highLoad = input.driverLoad === "high" || input.driverLoad === "critical" || input.driverLoad === "unknown";
  if (highLoad && input.passengerHandoffAuthorized) {
    return { outcome: "passenger_handoff", reasonCode: "AUTHORIZED_PASSENGER_HANDOFF", exposeContent: true };
  }

  // High and critical information may interrupt only when the driver state is
  // known to be below high load and interruption cost is not high.
  if (input.urgency === "critical" || input.urgency === "high") {
    if (!highLoad && input.interruptionCost !== "high") {
      return { outcome: "immediate", reasonCode: "URGENT_INFORMATION", exposeContent: true };
    }
    return { outcome: "deferred", reasonCode: highLoad ? "DRIVER_LOAD_HIGH" : "INTERRUPTION_COST_HIGH", exposeContent: true };
  }

  if (highLoad) {
    return { outcome: "deferred", reasonCode: "DRIVER_LOAD_HIGH", exposeContent: true };
  }
  if (input.interruptionCost === "high") {
    return { outcome: "deferred", reasonCode: "INTERRUPTION_COST_HIGH", exposeContent: true };
  }
  if (input.informationValue === "useful" && input.urgency === "low") {
    return { outcome: "silence", reasonCode: "LOW_VALUE_LOW_URGENCY", exposeContent: false };
  }
  return { outcome: "immediate", reasonCode: "SAFE_TO_PRESENT_NOW", exposeContent: true };
}
