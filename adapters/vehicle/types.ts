import type { DisplayRole } from "../../contracts/protocol/src/types.js";

/** Simulator contracts only; these are not vehicle-control commands. */
export interface SimulatedParkingCapability {
  capabilityId: string;
  version: number;
  availability: "available" | "unavailable" | "unknown";
  feasibility: "feasible" | "infeasible" | "unknown";
  observedAt: number;
  validUntil: number;
  reasonCode: string;
  source: "simulated";
  reality: "simulated";
}

export interface SimulatedParkingAuthorization {
  taskId: string;
  proposalId: string;
  planVersion: number;
  capabilityVersion: number;
  responderRole: DisplayRole;
  decision: "approve" | "decline";
  scope: "parking.start";
  expiresAt: number;
}

export interface SimulatedParkingRequest {
  actionId: string;
  taskId: string;
  proposalId: string;
  planVersion: number;
  authorization: SimulatedParkingAuthorization;
}

export type SimulatedParkingStatus = "running" | "paused" | "completed" | "cancelled" | "failed" | "unknown";

export interface SimulatedParkingAction {
  actionId: string;
  taskId: string;
  proposalId: string;
  planVersion: number;
  capabilityVersion: number;
  status: SimulatedParkingStatus;
  startedAt: number;
  updatedAt: number;
  reasonCode: string;
  source: "simulated";
  reality: "simulated";
  vehicleControlAllowed: false;
}

/** Explicit simulator-system outcome; elapsed time or animations never finish an action. */
export interface SimulatedParkingOutcomeReport {
  reportId: string;
  actionId: string;
  status: "completed" | "failed" | "unknown";
  observedAt: number;
  reasonCode: string;
  source: "simulated";
}
