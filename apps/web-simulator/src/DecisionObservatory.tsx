import { decisionObservatory } from './core/decision-observatory';
import { uiText } from './core/ui-copy';
import type { GatewayState } from './core/useAuraCommand';

/** Developer observability only, outside all five production screens. */
export function DecisionObservatory({ state }: { state: GatewayState }) {
  const decision = decisionObservatory(state);
  const fields = decision ? [
    ['乘員／來源角色', uiText(decision.actor)], ['意圖', decision.intent],
    ['資源', decision.resource], ['決定權', decision.authority],
    ['目前駕駛負荷', uiText(state.load)], ['連線狀態', uiText(state.connectivity.mode)],
    ['Core 決策', uiText(decision.decision)], ['目標畫面', uiText(decision.target)],
    ['原因碼', decision.reasonCode], ['追蹤 ID', decision.traceId],
    ['決策時間', new Date(decision.decidedAt).toLocaleTimeString('zh-TW')],
  ] : [];
  return <details open aria-label="PACT 決策觀測">
    <summary>PACT 決策觀測 · Core 事件證據</summary>
    <p>僅顯示收到的結構化決策，不推斷缺失資料或呈現思考過程。乘員身份為情境設定，並非真實感測。</p>
    {decision ? <div className="display-connections">{fields.map(([label, value]) => <div className="display-connection-card" key={label}><b>{label}</b><small className="connection-message">{value}</small></div>)}</div> : <p>尚未收到決策事件。</p>}
    <div className="console-feedback"><span>本地核心：權限、策略、注意力、行程與後座模式</span><span>模擬雲端能力：即時旅程資訊 · {uiText(state.rearExperience.liveJourney)}</span><span>後座模式：{uiText(state.rearExperience.mode)}</span></div>
  </details>;
}
