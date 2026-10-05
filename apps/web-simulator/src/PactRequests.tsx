import { attention, cancelRequest, confirm, offerCompromise, respondCompromise, suggestedCompromise } from '../../../packages/core-domain/src/pact/engine';
import type { Cabin, Intent, Role } from '../../../packages/core-domain/src/pact/engine';

export const occupantNames: Record<Role, string> = { driver: '駕駛', passenger: '副駕', rear: '後座' };
export function intentLabel(intent: Intent): string {
  switch (intent.kind) {
    case 'climate': return `空調 ${intent.temperature}°C`;
    case 'navigation': return `導航到 ${intent.destination}`;
    case 'search': return '搜尋餐廳';
    case 'entertainment': return '開啟娛樂';
    case 'hud': return '切換 HUD';
    default: return '無法辨識的需求';
  }
}
export type UpdateCabin = (transition: (current: Cabin) => Cabin) => void;
export default function PactRequests({ cabin, role, onUpdate }: { cabin: Cabin; role: Role; onUpdate: UpdateCabin }) {
  const focused = attention(cabin) >= 70;
  const requests = cabin.pending.filter(p => p.target === role);
  if (!requests.length || (role === 'driver' && focused)) return null;
  const p = requests[0]!;
  const compromise = suggestedCompromise(cabin, p);
  return <div className="pact-consent" aria-live="polite">
    <p>{occupantNames[p.request.role]}：{intentLabel(p.request.intent)}</p>
    {p.compromise ? <>
      <strong>駕駛提議全車 {p.compromise.temperature}°C</strong>
      <small>目前全車 {cabin.temperatures.driver}°C；雙方同意後才套用。{focused ? '駕駛負荷高時會延後套用。' : '目前設定維持不變。'}</small>
      {!p.compromise.accepted && <div className="pact-actions">
        <button onClick={() => onUpdate(c => respondCompromise(c, p.request.id, role, true))}>{occupantNames[role]}接受折衷</button>
        <button onClick={() => onUpdate(c => respondCompromise(c, p.request.id, role, false))}>保留原需求</button>
        <button onClick={() => onUpdate(c => cancelRequest(c, p.request.id, role))}>撤回需求</button>
      </div>}
    </> : <>
      <small>{p.request.intent.kind === 'climate' && `目前全車 ${cabin.temperatures.driver}°C。`}是否同意變更？{compromise !== null && `也可提議折衷 ${compromise}°C。`}</small>
      <div className="pact-actions">
        <button onClick={() => onUpdate(c => confirm(c, p.request.id, 'driver', true))}>駕駛同意</button>
        <button onClick={() => onUpdate(c => confirm(c, p.request.id, 'driver', false))}>駕駛拒絕</button>
        {compromise !== null && <button onClick={() => onUpdate(c => offerCompromise(c, p.request.id, 'driver'))}>提議 {compromise}°C</button>}
      </div>
    </>}
    {requests.length > 1 && <small>還有 {requests.length - 1} 項需求等待協調。</small>}
  </div>;
}
