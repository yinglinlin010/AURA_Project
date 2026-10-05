import type { GatewayState } from './useAuraCommand';

/** Read-only view of received Core decisions; never makes or replays policy decisions. */
export function decisionObservatory(state: GatewayState) {
  const proposal = [...state.proposals].reverse().find(p => p.payload?.competitionScenario === 'premium-journey' && p.lastDecision);
  const rear = state.rearDecision;
  if (rear && rear.decidedAt >= (proposal?.lastDecision?.decidedAt ?? 0)) {
    return { actor: rear.actor, intent: rear.mode === 'quiet' ? '啟用靜謐模式' : '恢復資訊', resource: '後座個人區域', authority: '後座乘員', decision: rear.decision, target: '後座與智慧車窗', reasonCode: rear.reasonCode, traceId: rear.traceId, decidedAt: rear.decidedAt };
  }
  if (!proposal?.lastDecision) return null;
  return { actor: proposal.requestedByRole ?? '角色證據未提供', intent: '加入東湖停靠點', resource: '共享行程', authority: proposal.targetRole === 'center' ? '駕駛（中控確認）' : proposal.targetRole, decision: proposal.lastDecision.outcome, target: proposal.targetRole, reasonCode: proposal.lastDecision.reasonCode, traceId: proposal.lastDecision.traceId, decidedAt: proposal.lastDecision.decidedAt };
}
