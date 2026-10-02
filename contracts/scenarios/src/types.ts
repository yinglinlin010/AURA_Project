import type { AuraCommand, CognitiveLoadLevel, Gear, ProposalPriority, VehicleState } from "../../protocol/src/types.js";

export interface ScenarioSignalInput {
  type: string;
  value: unknown;
  confidence?: number;
}

export type ScenarioStep =
  | {
      id: string;
      atMs: number;
      kind: "signal";
      signal: ScenarioSignalInput;
    }
  | {
      id: string;
      atMs: number;
      kind: "command";
      displayId: string;
      command: AuraCommand;
    }
  | {
      id: string;
      atMs: number;
      kind: "task.start";
      task: {
        taskId: string;
        priority: "primary" | "secondary" | "critical";
      };
    }
  | {
      id: string;
      atMs: number;
      kind: "intent";
      text: string;
      requestedByRole: import("../../protocol/src/types.js").DisplayRole;
      expectedAvailability?: "cloud" | "local" | "offline_local" | "unavailable";
    }
  | {
      id: string;
      atMs: number;
      kind: "perception.parking";
      proposalId: string;
      cues: Array<"parking_maneuver_active" | "repeated_adjustment" | "unfamiliar_parking_context" | "driver_requested_guidance">;
    };

export interface ScenarioDefinition {
  id: string;
  name: string;
  description?: string;
  timeline: ScenarioStep[];
}

export type { CognitiveLoadLevel, Gear, ProposalPriority, VehicleState };
