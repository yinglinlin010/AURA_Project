import type {
  ActiveTask,
  ContextSignal,
  PolicyDecision,
  SafetyWarningState,
} from "../../../contracts/protocol/src/types.js";

export interface SafetyOverride {
  signal: ContextSignal;
  decision: PolicyDecision;
  interruptedTasks: ActiveTask[];
  warning: SafetyWarningState;
}

export function isCriticalSafetySignal(signal: ContextSignal): boolean {
  if (signal.type === "safety.critical") return true;
  if (typeof signal.value === "string") {
    return signal.value.trim().toLowerCase() === "critical";
  }
  if (typeof signal.value === "object" && signal.value !== null) {
    const value = signal.value as Record<string, unknown>;
    const severity = value.severity ?? value.level;
    return typeof severity === "string" && severity.trim().toLowerCase() === "critical";
  }
  return false;
}

export function createSafetyOverride(
  signal: ContextSignal,
  runningTasks: readonly ActiveTask[],
  traceId: string,
  decisionId: string,
  decidedAt: number,
): SafetyOverride | null {
  if (!isCriticalSafetySignal(signal)) return null;

  return {
    signal,
    decision: {
      decisionId,
      proposalId: `safety:${signal.signalId}`,
      traceId,
      outcome: "EXECUTE",
      reasonCode: "CRITICAL_SAFETY_SIGNAL_LOCAL_OVERRIDE",
      consentRequired: false,
      targetRole: "cluster",
      policyVersion: "aura-safety-supervisor-v1",
      decidedAt,
    },
    interruptedTasks: runningTasks.filter(
      (task) => task.status === "running" && task.priority === "secondary",
    ),
    warning: {
      warningId: signal.signalId,
      signalId: signal.signalId,
      signalType: signal.type,
      severity: "critical",
      source: signal.source,
      freshness: signal.freshness ?? "unknown",
      activatedAt: decidedAt,
    },
  };
}
