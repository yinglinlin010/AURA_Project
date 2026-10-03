import type { ActionKind, AuraCommand, CognitiveLoadLevel, DisplayRole, Gear, PolicyOutcome, ProposalPriority, ProposalStatus, VehicleState } from "../../protocol/src/types.js";

export type ScenarioVoiceState = "IDLE" | "LISTENING" | "TRANSCRIBING" | "THINKING" | "SPEAKING";

export interface ScenarioStateFieldExpectation {
  /** JSON Pointer into AuraSharedState, for example `/journey/stops/0/placeId`. */
  path: string;
  equals: unknown;
}

export type ScenarioMetricName =
  | "completedSteps"
  | "commandReceiptCount"
  | "signalReceiptCount"
  | "policyDecisionCount"
  | "journeyStopCount"
  | "voiceTransitionCount"
  | "stateRevision"
  | "durationMs";

export interface ScenarioExpected {
  initialState?: { fields: ScenarioStateFieldExpectation[] };
  finalState?: { fields: ScenarioStateFieldExpectation[] };
  commands?: Array<{
    stepId: string;
    status: "RECEIVED" | "REJECTED";
    reasonCode?: string;
  }>;
  decisions?: Array<{
    stepId: string;
    outcome: PolicyOutcome;
    proposalId?: string;
    reasonCode?: string;
    consentRequired?: boolean;
  }>;
  actions?: Array<{
    stepId: string;
    proposalId?: string;
    proposalAlias?: string;
    kind?: ActionKind;
    targetRole?: DisplayRole;
    status?: ProposalStatus;
  }>;
  displays?: Array<{
    displayId: string;
    role?: DisplayRole;
    stateFields?: ScenarioStateFieldExpectation[];
  }>;
  metrics?: Array<{
    name: ScenarioMetricName;
    equals?: number;
    min?: number;
    max?: number;
  }>;
  signalFreshness?: Array<{ stepId: string; state: "fresh" | "cached" | "stale" | "unknown" }>;
  taskLifecycle?: Array<{
    stepId: string;
    taskId: string;
    status: "running" | "interrupted" | "completed";
    actionCount?: number;
    actionStatuses?: Array<"pending" | "running" | "paused" | "unknown" | "succeeded" | "failed" | "cancelled">;
    completionEventCount?: number;
    revalidationReality?: "simulated";
  }>;
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
  freshness?: "fresh" | "cached" | "stale" | "unknown";
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
        goal?: string;
        currentStep?: string;
        conditions?: Array<{
          key: string;
          classification: "confirmed" | "inferred" | "unknown";
          value?: string;
          source: "simulated";
          validForMs?: number;
        }>;
      };
    }
  | {
      id: string;
      atMs: number;
      kind: "task.action";
      taskId: string;
      actionId: string;
      idempotencyKey: string;
      status: "pending" | "running" | "paused" | "unknown" | "succeeded" | "failed" | "cancelled";
      reasonCode?: string;
      repeatIdempotently?: boolean;
    }
  | {
      id: string;
      atMs: number;
      kind: "task.resume";
      taskId: string;
      revalidation: {
        reality: "simulated";
        sourceLabel: string;
        candidateFresh: boolean;
        capabilityConfirmed: boolean;
        authorizationCurrent: boolean;
        priorActionOutcomeKnown: boolean;
      };
    }
  | { id: string; atMs: number; kind: "task.complete"; taskId: string; repeatIdempotently?: boolean }
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
