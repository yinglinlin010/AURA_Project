import type { CognitiveLoadLevel, DisplayRole } from "../../../contracts/protocol/src/types.js";

export type InformationDensity = "rich" | "concise" | "reduced" | "safety_only";

export interface PresentationResolverInput {
  role: DisplayRole;
  load?: CognitiveLoadLevel;
  /** Confidence is metadata about the load estimate, never a load state. */
  loadConfidence?: number;
  activeSafetyWarning: boolean;
}

export interface PresentationResolution {
  role: DisplayRole;
  load: CognitiveLoadLevel | undefined;
  loadConfidence: number | undefined;
  informationDensity: InformationDensity;
  deferNonCritical: boolean;
  suppressAmbientActivity: boolean;
  suppressNonSafetyContent: boolean;
  safetyPriority: boolean;
  centerHighLoadMarkerEligible: boolean;
}

const DRIVER_FACING_ROLES = new Set<DisplayRole>(["cluster", "center"]);

/** Resolves frozen load and safety presentation rules without mutating state. */
export function resolvePresentation(input: PresentationResolverInput): PresentationResolution {
  const driverFacing = DRIVER_FACING_ROLES.has(input.role);
  const highLoad = input.load === "high" || input.load === "critical";
  const criticalLoad = input.load === "critical";
  const safetyPriority = input.activeSafetyWarning || criticalLoad;
  const suppressNonSafetyContent = driverFacing && safetyPriority;

  let informationDensity: InformationDensity;
  switch (input.load) {
    case "low":
      informationDensity = "rich";
      break;
    case "normal":
      informationDensity = "concise";
      break;
    case "high":
      informationDensity = driverFacing ? "reduced" : "rich";
      break;
    case "critical":
      informationDensity = driverFacing ? "safety_only" : "rich";
      break;
    default:
      informationDensity = "concise";
  }

  if (suppressNonSafetyContent) informationDensity = "safety_only";

  return {
    role: input.role,
    load: input.load,
    loadConfidence: input.loadConfidence,
    informationDensity,
    deferNonCritical: highLoad,
    suppressAmbientActivity: highLoad || input.activeSafetyWarning,
    suppressNonSafetyContent,
    safetyPriority,
    centerHighLoadMarkerEligible:
      input.role === "center" && input.load === "high" && !input.activeSafetyWarning,
  };
}
