import type { AuraCommand, CognitiveLoadLevel, Gear, PolicyOutcome, ProposalPriority, VehicleState } from "../../protocol/src/types.js";

export type ScenarioVoiceState = "IDLE" | "LISTENING" | "TRANSCRIBING" | "THINKING" | "SPEAKING";

export interface ScenarioExpected {
  voice?: {
    policyDecisions?: Array<{
      stepId: string;
      outcome: PolicyOutcome;
      reasonCode?: string;
      consentRequired?: boolean;
    }>;
    consents?: Array<{
      stepId: string;
      proposalAlias: string;
      accepted: boolean;
      receiptStatus?: "RECEIVED" | "REJECTED";
    }>;
    journey?: {
      stopCount: number;
      stopProposalAliases: string[];
    };
    statesAtSteps?: Array<{
      stepId: string;
      state: ScenarioVoiceState;
    }>;
    requiredTransitions?: Array<{
      from: ScenarioVoiceState;
      to: ScenarioVoiceState;
    }>;
  };
}

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
    }
  | { id: string; atMs: number; kind: "voice.start" }
  | {
      id: string;
      atMs: number;
      kind: "voice.text";
      text: string;
      proposalAlias?: string;
    }
  | { id: string; atMs: number; kind: "voice.barge_in" }
  | { id: string; atMs: number; kind: "voice.stop" }
  | {
      id: string;
      atMs: number;
      kind: "voice.consent";
      proposalAlias: string;
      displayId: string;
      decision: "approve" | "decline";
    };

export interface ScenarioDefinition {
  id: string;
  name: string;
  description?: string;
  timeline: ScenarioStep[];
  expected?: ScenarioExpected;
}

export type { CognitiveLoadLevel, Gear, ProposalPriority, VehicleState };
