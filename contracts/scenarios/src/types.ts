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
    };

export interface ScenarioDefinition {
  id: string;
  name: string;
  description?: string;
  timeline: ScenarioStep[];
}

export type { CognitiveLoadLevel, Gear, ProposalPriority, VehicleState };
