import type {
  ActionProposal,
  AuraSharedState,
  DisplayRole,
  PolicyDecision,
} from "../../../contracts/protocol/src/types.js";

export interface ActionGateInput {
  proposal: ActionProposal;
  state: AuraSharedState;
  allowedRoles: ReadonlySet<DisplayRole>;
  decisionId: string;
  decidedAt: number;
  consentGranted?: boolean;
}

export function evaluateActionProposal(input: ActionGateInput): PolicyDecision {
  const { proposal, state } = input;
  const base = {
    decisionId: input.decisionId,
    proposalId: proposal.proposalId,
    traceId: proposal.traceId,
    consentRequired: proposal.requiresConsent,
    targetRole: proposal.targetRole,
    policyVersion: "aura-action-gate-v1",
    decidedAt: input.decidedAt,
  };

  if (!("secondary normal".split(" ").includes(proposal.priority as string))) {
    return { ...base, outcome: "REJECT", reasonCode: "INVALID_PROPOSAL_PRIORITY" };
  }

  // Generic proposals, including model/provider output, cannot claim the
  // trusted Safety Supervisor's urgent-warning capability. Critical signals
  // continue through createSafetyOverride's separate event path.
  if ((proposal.kind as string) === "WARN") {
    return { ...base, outcome: "REJECT", reasonCode: "SAFETY_WARNING_REQUIRES_SUPERVISOR" };
  }
  if ((proposal.priority as string) === "urgent") {
    return { ...base, outcome: "REJECT", reasonCode: "URGENT_PRIORITY_REQUIRES_SAFETY_SUPERVISOR" };
  }

  if (!input.allowedRoles.has(proposal.targetRole)) {
    return {
      ...base,
      outcome: "REJECT",
      reasonCode: "TARGET_ROLE_UNAVAILABLE",
    };
  }

  if (state.driver.currentLoad === undefined) {
    return {
      ...base,
      outcome: "DEFER",
      reasonCode: "DRIVER_LOAD_UNAVAILABLE",
      deferUntil: {
        type: "driver_load_below",
        currentThreshold: "high",
        reevaluateOn: "driver.cognitive_load",
      },
    };
  }

  if (state.driver.currentLoad === "high" || state.driver.currentLoad === "critical") {
    return {
      ...base,
      outcome: "DEFER",
      reasonCode: "DRIVER_COGNITIVE_LOAD_HIGH",
      deferUntil: {
        type: "driver_load_below",
        currentThreshold: "high",
        reevaluateOn: "driver.cognitive_load",
      },
    };
  }

  if (input.consentGranted) {
    return {
      ...base,
      outcome: "EXECUTE",
      reasonCode: "CONSENT_GRANTED_POLICY_REVALIDATED",
    };
  }

  return {
    ...base,
    outcome: "ROUTE",
    reasonCode: "DRIVER_LOAD_BELOW_DEFERRAL_THRESHOLD",
  };
}
