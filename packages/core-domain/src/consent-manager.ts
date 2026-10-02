import type {
  ActionProposal,
  AuraSharedState,
  DisplayRole,
} from "../../../contracts/protocol/src/types.js";
import { findProposal } from "./reducer.js";

export type ConsentDecision = "approve" | "decline";

export type ConsentResult =
  | { accepted: true; proposal: ActionProposal; status: "executing" | "declined"; reasonCode: string }
  | { accepted: false; reasonCode: string };

export function evaluateConsent(
  state: AuraSharedState,
  proposalId: string,
  responderRole: DisplayRole,
  decision: ConsentDecision,
): ConsentResult {
  const proposal = findProposal(state, proposalId);
  if (!proposal) return { accepted: false, reasonCode: "PROPOSAL_NOT_FOUND" };
  if (!proposal.requiresConsent) {
    return { accepted: false, reasonCode: "CONSENT_NOT_REQUIRED" };
  }
  if (proposal.status !== "awaiting_consent") {
    return { accepted: false, reasonCode: "PROPOSAL_NOT_AWAITING_CONSENT" };
  }
  if (proposal.targetRole !== responderRole) {
    return { accepted: false, reasonCode: "CONSENT_ROLE_MISMATCH" };
  }

  return decision === "approve"
    ? { accepted: true, proposal, status: "executing", reasonCode: "TARGET_ROLE_APPROVED" }
    : { accepted: true, proposal, status: "declined", reasonCode: "TARGET_ROLE_DECLINED" };
}
