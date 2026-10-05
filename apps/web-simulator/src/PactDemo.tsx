import { useEffect, useState } from 'react';
import { attention, initialCabin, submit, updateContext } from '../../../packages/core-domain/src/pact/engine';
import type { Cabin, Role } from '../../../packages/core-domain/src/pact/engine';
import { restorePreferences, serializePreferences } from '../../../packages/core-domain/src/pact/preferences';
import PactRequests, { occupantNames } from './PactRequests';
import PactTaskPanel from './PactTaskPanel';
import './PactDemo.css';

const preferenceKey = 'pact.applied-preferences.v1';
function loadCabin(): Cabin {
  try { return restorePreferences(localStorage.getItem(preferenceKey)); } catch { return initialCabin(); }
}

const names = occupantNames;
const steps = ['多人需求與多螢幕', '雙區空調協調', '複雜路口 · Focus Mode', '副駕修改目的地', '安全後詢問駕駛', '離線核心協調', '恢復連線'];
function advance(c: Cabin, step: number): Cabin {
  switch (step) {
    case 0: return submit(submit(submit(c, 'driver', '導航到花蓮車站'), 'passenger', '找餐廳'), 'rear', '播放電影');
    case 1: return submit(submit(c, 'driver', '空調 21'), 'passenger', '空調 25');
    case 2: return updateContext(c, { speed: 40, complexity: 100, hmiTasks: 1 });
    case 3: return submit(c, 'passenger', '改去海邊餐廳');
    case 4: return updateContext(c, { complexity: 10, hmiTasks: 0 });
    case 5: return submit(updateContext(c, { online: false }), 'rear', '空調 24');
    default: return updateContext(c, { online: true });
  }
}
export default function PactDemo({ bundled = false }: { bundled?: boolean }) {
  const [c, setCabin] = useState(loadCabin);
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [role, setRole] = useState<Role>('passenger');
  const [text, setText] = useState('改去海邊餐廳');
  const load = attention(c), focus = load >= 70;
  const driverRequests = c.pending.filter(p => p.target === 'driver');
  useEffect(() => {
    try { localStorage.setItem(preferenceKey, serializePreferences(c)); setSaveError(false); }
    catch { setSaveError(true); }
  }, [c]);
  useEffect(() => {
    if (!auto || (step === 5 && c.pending.length > 0)) return;
    const timer = window.setTimeout(() => {
      if (step >= steps.length) { setAuto(false); return; }
      setCabin(current => advance(current, step));
      setStep(step + 1);
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [auto, step, c.pending.length]);
  const send = (who: Role, command: string) => setCabin(current => submit(current, who, command));
  return <main className={`pact-shell${bundled ? ' pact-bundled' : ''}`}>
    <header><div><h1>PACT</h1><p>One Cabin. Many People. One AI.</p></div>{!bundled && <a href="/">返回 AURA</a>}<span>{c.online ? 'ONLINE · 模擬雲端增強' : 'OFFLINE · 本機核心'}</span></header>
    <section className="pact-demo-controls" aria-label="Demo 控制"><div><h2>多人 AI 協調座艙</h2><p>三個邏輯螢幕，共享一套安全與權限決策。所有車輛訊號、餐廳與娛樂皆為模擬。</p></div><button disabled={step >= steps.length || auto} onClick={() => { setCabin(current => advance(step === 0 ? initialCabin() : current, step)); setStep(step + 1); }}>{step < steps.length ? `${step + 1} / 7　${steps[step]}` : 'Demo 完成'}</button><button onClick={() => { if (auto) setAuto(false); else { if (step === 0 || step >= steps.length) { setCabin(advance(initialCabin(), 0)); setStep(1); } setAuto(true); } }}>{auto ? '暫停自動播放' : step > 0 && step < steps.length ? '繼續播放 Demo' : '自動播放 Demo'}</button><button onClick={() => { setAuto(false); setCabin(initialCabin()); setStep(0); }}>重設 Demo</button><button onClick={() => { setAuto(false); setStep(0); setRole('passenger'); setCabin(submit(submit({ ...initialCabin(), dualZone: false }, 'driver', '空調 21'), 'passenger', '空調 25')); }}>單區協商情境</button></section>
    {auto && <p role="status">每 12 秒推進；駕駛確認時暫停，請在駕駛螢幕同意或拒絕。</p>}
    {saveError && <p role="status">裝置無法保存設定；本次操作仍可繼續。</p>}
    <section className="pact-context" aria-label="模擬車輛情境">
      <strong>{focus ? 'FOCUS MODE' : '一般駕駛'} · 注意力 {load}%</strong>
      <label>車速 {c.speed} km/h<input type="range" min="0" max="120" value={c.speed} onChange={e => setCabin(current => updateContext(current, { speed: Number(e.target.value) }))}/></label>
      <label>道路複雜度 {c.complexity}%<input type="range" min="0" max="100" value={c.complexity} onChange={e => setCabin(current => updateContext(current, { complexity: Number(e.target.value) }))}/></label>
      <label>HMI 任務 {c.hmiTasks}<input type="range" min="0" max="4" value={c.hmiTasks} onChange={e => setCabin(current => updateContext(current, { hmiTasks: Number(e.target.value) }))}/></label>
      <label><input type="checkbox" checked={c.dualZone} onChange={e => setCabin(current => updateContext(current, { dualZone: e.target.checked }))}/>模擬分區空調</label>
      <label><input type="checkbox" checked={c.gazeAway} onChange={e => setCabin(current => updateContext(current, { gazeAway: e.target.checked }))}/>模擬視線離路</label>
      <button onClick={() => setCabin(current => updateContext(current, { online: !current.online }))}>{c.online ? '切換離線' : '恢復連線'}</button>
    </section>
    <div className="pact-displays">
      {(['driver', 'passenger', 'rear'] as const).map(who => <section className={`pact-display ${who}`} key={who} aria-label={`${names[who]}螢幕`}>
        <h2>{names[who]} <small>{who === 'driver' ? 'DRIVER DISPLAY' : who === 'passenger' ? 'PASSENGER DISPLAY' : 'REAR DISPLAY'}</small></h2>
        <div className="pact-screen-content">
          {who === 'driver' ? <><p>{focus ? '專注駕駛 · 僅保留必要資訊' : '導航進行中'}</p><h3>{c.destination}</h3><p>模擬導航 · 直行 800 m{!focus && c.hudCompact ? ' · 精簡 HUD' : ''}</p></> : who === 'passenger' ? <><p>個人探索</p><h3>{c.search ? '海邊餐廳' : '等待餐廳搜尋'}</h3><p>{c.search ? '本機示範資料 · 非即時推薦' : '餐廳結果會留在副駕螢幕'}</p></> : <><p>後座娛樂</p><h3>{c.entertainment ? '電影已準備就緒' : '尚未開啟娛樂'}</h3><p>模擬播放狀態 · 不含影音串流</p></>}
          <PactRequests cabin={c} role={who} onUpdate={setCabin} />
          {who !== 'driver' && c.pending.some(p => p.request.role === who && p.compromise?.accepted) && <small role="status">雙方已同意折衷，安全後再套用。</small>}
          {(!c.pending.some(p => p.target === who) && (who !== 'driver' || !focus)) && <>
          <div className="pact-temperature"><span>{c.dualZone ? '個人空調' : '全車空調'}</span><strong>{c.temperatures[who]}°C</strong></div>
          <div className="pact-actions"><button onClick={() => send(who, `空調 ${who === 'driver' ? 21 : 25}`)}>設為 {who === 'driver' ? 21 : 25}°C</button>{who === 'driver' && !focus && <button onClick={() => send(who, '修改 HUD')}>切換 HUD</button>}{who === 'passenger' && <button onClick={() => send(who, '找餐廳')}>搜尋餐廳</button>}{who === 'rear' && <><button onClick={() => send(who, '播放電影')}>開啟娛樂</button><button onClick={() => send(who, '修改 HUD')}>嘗試修改 HUD</button></>}</div>
          </>}
        </div>
        {who === 'driver' && driverRequests.length === 0 && <p>目前沒有待確認需求。</p>}
        {who === 'driver' && focus && driverRequests.length > 0 && <p>非必要需求已延後，安全後再提示。</p>}
      </section>)}
    </div>
    <PactTaskPanel cabin={c} role={role} onRoleChange={setRole} onUpdate={setCabin} />
    <section className="pact-ledger"><div><h2>提出需求</h2><form onSubmit={e => { e.preventDefault(); send(role, text); }}><label>乘員<select value={role} onChange={e => setRole(e.target.value as Role)}>{Object.entries(names).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><label>指令<input value={text} onChange={e => setText(e.target.value)} required maxLength={200} placeholder="例如：空調 25、找餐廳、改去花蓮車站"/></label><button type="submit">送出需求</button></form><p>套用設定會保存；重新啟動後取消待確認需求。支援：空調 16–30、導航到目的地、改去目的地、找餐廳、播放電影、修改 HUD。</p></div><div><h2>決策紀錄</h2><ol aria-live="polite">{c.history.length === 0 ? <li>點選 Demo 或提出需求，查看協調結果。</li> : c.history.map((r, i) => <li key={`${r.request.id}-${i}`}><b className={`pact-${r.decision.toLowerCase()}`}>{r.lifecycle === 'CANCELLED' ? '撤回' : r.lifecycle === 'SUPERSEDED' ? '取代' : r.decision}</b><span>{names[r.request.role]} → {names[r.target]} · {r.scope}{r.conflict ? ' · 空調衝突' : ''}<small>{r.reason}</small></span></li>)}</ol></div></section>
  </main>;
}
