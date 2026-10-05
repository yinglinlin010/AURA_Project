import type { GatewayState } from './useAuraCommand';

/** Observational filming guidance only. It never sends commands or decides policy. */
export function manualJourneyStep(state: GatewayState, history: { offlineSeen?: boolean; quietSeen?: boolean } = {}): { step: number; observed: string | null; instruction: string } {
  const point = state.journeyPoint;
  const proposal = [...state.proposals].reverse().find(p => p.payload?.competitionScenario === 'premium-journey');
  const added = !!point && state.journeyStops.some(s => s.placeId === point.pointId);
  if (state.connections['center-main'].status !== 'connected' || state.connections['rear-tablet'].status !== 'connected') return { step: 0, observed: null, instruction: '閘道尚未連線，請先啟動競賽主機。' };
  if (state.activeSafetyWarning) return { step: 0, observed: null, instruction: '安全事件優先，請先處理目前安全狀態。' };
  if (!point) return { step: 0, observed: null, instruction: '按「重設」，等待正常行駛與東湖景點載入。' };
  if (added) {
    if (proposal?.status !== 'completed') return { step: 5, observed: null, instruction: '等待 Core 確認行程更新完成。' };
    if (state.rearExperience.mode === 'quiet') {
      if (state.connectivity.mode === 'online' && state.rearExperience.liveJourney === 'available_but_held' && history.offlineSeen) return { step: 8, observed: 'restore', instruction: '雲端已恢復，資訊仍暫存。由 VIP 在後座畫面按「恢復資訊」。' };
      if (state.connectivity.mode === 'online' && !history.offlineSeen) return { step: 7, observed: 'quiet', instruction: '資訊已暫存，但本輪尚未觀測雲端離線。在此控制頁按「雲端離線」，再按「雲端恢復」。' };
      return { step: 7, observed: 'quiet', instruction: '後座與車窗已進入靜謐模式。在此控制頁按「雲端恢復」。' };
    }
    if (state.connectivity.mode === 'offline') return { step: 6, observed: 'offline', instruction: '本地行程仍保留。由 VIP 在後座畫面按「靜謐模式」。' };
    if (state.connectivity.mode === 'online' && state.rearExperience.liveJourney === 'presented' && state.rearExperience.reasonCode === 'REAR_RESUME_REQUESTED') return history.offlineSeen && history.quietSeen ? { step: 9, observed: 'resume', instruction: 'VIP 已主動恢復資訊，手動流程完成。下一輪按「重設」。' } : { step: 5, observed: 'resume', instruction: '已收到 VIP 恢復資訊，但本輪未收齊離線／靜謐證據。完整拍攝請按「重設」。' };
    return { step: 5, observed: 'accept', instruction: '東湖已加入，各屏已同步。在此控制頁按「雲端離線」。' };
  }
  if (proposal?.status === 'declined' || proposal?.status === 'rejected') return { step: 2, observed: 'keep-route', instruction: '原行程未變。先確認高負荷，再於車窗重新提出行程；或按「重設」。' };
  if (proposal?.status === 'deferred' && proposal.lastDecision?.outcome === 'DEFER') return { step: 3, observed: 'request', instruction: 'PACT 已延後，中控不顯示同意。在此控制頁按「駕駛負荷正常」。' };
  if (proposal?.status === 'awaiting_consent' && proposal.lastDecision?.outcome === 'ASK' && state.load === 'normal') return { step: 4, observed: 'normal', instruction: '由駕駛在中控畫面按「接受」或「維持路線」。接受前行程不會更新。' };
  if (proposal) return { step: 3, observed: null, instruction: '等待 Core 回報提案／行程狀態，請勿重複送出。' };
  if (state.load === 'high') return { step: 2, observed: 'high', instruction: '高負荷已由 Core 確認。由乘員在智慧車窗點「東湖」，再按「加入行程」。' };
  if (state.load === 'normal' && state.speedKph === 40 && state.connectivity.mode === 'online' && state.rearExperience.mode === 'normal') return { step: 1, observed: 'reset', instruction: '正常行駛已就緒。在此控制頁按「駕駛負荷高」，等待確認後再提出行程。' };
  return { step: 0, observed: null, instruction: '按「重設」準備一輪手動拍攝。' };
}
