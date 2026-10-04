import type { ActiveTask } from "../../../contracts/protocol/src/types.js";
import type { TaskResumeRevalidation } from "../../../packages/core-runtime/src/core-runtime.js";

/** Evidence is deliberately injectable: Core Host has no live vehicle authority wired today. */
export interface HostTaskRecoveryEvidence extends TaskResumeRevalidation {
  reality: "live" | "simulated";
  observedAt: number;
  expiresAt: number;
}

export type HostTaskRecoveryEvidenceProvider = (
  task: Readonly<ActiveTask>,
) => HostTaskRecoveryEvidence | undefined;

/** Adapt explicitly sourced, time-bounded host evidence to CoreRuntime's fail-closed contract. */
export function createTaskResumeRevalidator(
  provider?: HostTaskRecoveryEvidenceProvider,
  now: () => number = Date.now,
): ((task: Readonly<ActiveTask>) => TaskResumeRevalidation) | undefined {
  if (!provider) return undefined;
  return (task) => {
    try {
      const evidence = provider(structuredClone(task));
      if (!evidence || evidence.reality !== "live" ||
          !Number.isFinite(evidence.observedAt) || !Number.isFinite(evidence.expiresAt) ||
          evidence.observedAt > now() || evidence.expiresAt <= now() || evidence.observedAt > evidence.expiresAt) {
        return denied();
      }
      return {
        candidateFresh: evidence.candidateFresh === true,
        capabilityConfirmed: evidence.capabilityConfirmed === true,
        authorizationCurrent: evidence.authorizationCurrent === true,
        priorActionOutcomeKnown: evidence.priorActionOutcomeKnown === true,
      };
    } catch {
      return denied();
    }
  };
}

function denied(): TaskResumeRevalidation {
  return { candidateFresh: false, capabilityConfirmed: false, authorizationCurrent: false, priorActionOutcomeKnown: false };
}
