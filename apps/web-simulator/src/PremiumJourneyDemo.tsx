import { uiText } from './core/ui-copy';
import { DecisionObservatory } from './DecisionObservatory';
import { useState } from 'react';
import { useAuraCommand } from './core/useAuraCommand';
import type { DisplayId } from './core/browser-display-selection';
import './PremiumJourneyDemo.css';

/** Developer Scenario Inspector / Test Harness. Never the production HMI. */
export default function PremiumJourneyDemo() {
  const { state: s, sendCommand } = useAuraCommand();
  const [surface, setSurface] = useState('all');
  const [message, setMessage] = useState('請重設競賽模擬主機以開始。');
  const connected = Object.values(s.connections).every(c => c.status === 'connected');
  const quiet = s.rearExperience.mode === 'quiet';
  const added = s.journeyStops.some(stop => stop.label === 'Donghu');
  const p = [...s.proposals].reverse().find(p => p.payload?.competitionScenario === 'premium-journey');
  const send = (id: DisplayId, type: string, payload: Record<string, unknown>) => {
    if (!sendCommand(id, { type, payload })) setMessage('閘道不可用，請啟動 8081 競賽主機後重新整理。');
    else setMessage(`已送出 ${type}；請查看執行結果。`);
  };
  const load = (level: string) => send('center-main', 'driver.cognitive_load.report', { level, confidence: .95, timestamp: Date.now() });
  const cloud = (mode: string) => send('center-main', 'connectivity.mode.report', { mode, evidence: `scenario-fixture:cloud-${mode}` });
  const request = (displayId: DisplayId = 'rear-tablet') => send(displayId, 'action.propose', { proposal: { proposalId: crypto.randomUUID(), kind: 'ADD_TRIP_STOP', summary: "東湖 · +12 分鐘", targetRole: 'center', priority: 'secondary', requiresConsent: true, payload: { placeId: 'fixture-donghu', label: 'Donghu', competitionScenario: 'premium-journey', source: 'simulated', etaImpactMinutes: 12 } } });
  const consent = (decision: string) => p && send('center-main', 'action.consent', { proposalId: p.proposalId, decision });
  const rearMode = (mode: string) => send('rear-tablet', 'rear.mode.set', { mode });
  const pending = !!p && !['completed', 'declined', 'rejected', 'cancelled', 'interrupted'].includes(p.status);
  const rearConnected = s.connections['rear-tablet'].status === 'connected';
  const screens = [
    { id: 'cluster', title: "儀表", content: <><strong className="pj-speed">{Math.round(s.speedKph)} <small>km/h</small></strong><p>{added ? '東湖 · 下一站' : "沿目前路線繼續行駛"}</p><p>{s.load === 'high' || s.load === 'critical' ? "專注模式" : "駕駛資訊"}</p>{s.activeSafetyWarning && <p role="alert">安全警示 · {s.activeSafetyWarning.signalType}</p>}</> },
    { id: 'center', title: "中控", content: <><h2>共享行程</h2><p>{added ? "行程已更新 · 已加入東湖" : "高階商務旅程"}</p>{p?.status === 'awaiting_consent' ? <div className="pj-consent"><h3>行程更新待確認</h3><p>東湖 · +12 分鐘</p><button onClick={() => consent('approve')}>接受</button><button onClick={() => consent('decline')}>維持路線</button></div> : <p>{p?.status === 'deferred' ? "提案延後 · 暫不打擾駕駛" : added ? "東湖已加入共享行程" : "保留目前路線"}</p>}</> },
    { id: 'passenger', title: "副駕", content: <><h2>你的旅程</h2><p>高階商務旅程</p><p>共享旅程資訊</p></> },
    { id: 'rear', title: '後座 VIP', content: <div className={quiet ? 'pj-zone is-quiet' : 'pj-zone'}>
      <div className="pj-normal-content" aria-hidden={quiet}><h2>{added ? '東湖 · 下一站' : "你的專屬旅程"}</h2><h3>即時旅程資訊</h3><p>{s.rearExperience.liveJourney === 'presented' ? "抵達 14:26 · 路線順暢" : "暫時無法使用"}</p><button disabled={quiet || !rearConnected} tabIndex={quiet ? -1 : 0} onClick={() => rearMode('quiet')}>靜謐模式</button></div>
      <div className="pj-quiet-content" aria-hidden={!quiet}><h2>14:19</h2><p>靜謐模式</p><p>{added ? '東湖 · 18 分鐘' : "旅程持續"}</p><button disabled={!quiet || !rearConnected} tabIndex={quiet ? 0 : -1} onClick={() => rearMode('normal')}>恢復資訊</button></div><small>模擬資料 · {s.rearExperience.source}</small></div> },
    { id: 'window', title: '智慧車窗', content: <div className={quiet ? 'pj-zone is-quiet' : 'pj-zone'}>
      <div className="pj-normal-content" aria-hidden={quiet}><h2>東湖</h2><p>{added ? "下一站" : "湖畔景點停留"}</p>{!added && <><p>行程增加 12 分鐘</p><button tabIndex={quiet ? -1 : 0} disabled={quiet || s.connections['window-tablet'].status !== 'connected' || pending} onClick={() => request('window-tablet')}>加入行程</button></>}{p && !added && <p>{['declined', 'rejected'].includes(p.status) ? "維持路線 · 提案已拒絕" : "行程提案已送出"}</p>}</div>
      <div className="pj-quiet-content" aria-hidden={!quiet}><h2>14:19</h2><p>{added ? '東湖 · 下一站' : ''}</p></div><small>模擬旅程資訊</small></div> },
  ];
  return <main className="premium-journey"><header><h1>開發者情境檢查器</h1><p>高階旅程 · 僅供測試</p><a href="/?scenario=premium-journey">開啟 AURA 正式五屏</a><small>互動原型 · 模擬車況 · 模擬雲端服務</small></header>
    <nav aria-label="顯示畫面">{['all', ...screens.map(x => x.id)].map(id => <button key={id} aria-pressed={surface === id} onClick={() => setSurface(id)}>{id === 'all' ? "五屏" : uiText(id)}</button>)}</nav>
    <div className={`pj-screens ${surface !== 'all' ? 'pj-takeover' : ''}`}>{screens.filter(x => surface === 'all' || surface === x.id).map(x => <section key={x.id} className={`pj-screen pj-${x.id}`} aria-label={x.title}><h3 className="pj-role">{x.title}</h3>{x.content}</section>)}</div>
    <details open className="pj-engineering"><summary>情境控制／PACT 決策觀測</summary><div className="pj-controls">
      <button disabled={!connected} onClick={() => { send('center-main', 'demo.reset', {}); load('high'); cloud('online'); send('center-main', 'vehicle.telemetry.report', { vehicle: { speedKph: 40, gear: 'D', drivingState: 'driving' } }); }}>重設</button>
      <button disabled={!connected || pending || added} onClick={() => request()}>行程提案</button><button disabled={!connected} onClick={() => load('high')}>駕駛負荷高</button><button disabled={!connected} onClick={() => load('normal')}>駕駛負荷正常</button>
      <button disabled={!connected || p?.status !== 'awaiting_consent'} onClick={() => consent('approve')}>駕駛接受</button><button disabled={!connected} onClick={() => cloud('offline')}>雲端離線</button><button disabled={!rearConnected} onClick={() => rearMode('quiet')}>靜謐模式</button><button disabled={!connected} onClick={() => cloud('online')}>雲端恢復</button><button disabled={!rearConnected} onClick={() => rearMode('normal')}>恢復資訊</button>
    </div><DecisionObservatory state={s}/>
      <p>本地提供權限、策略、注意力、行程與後座體驗；雲端資料為固定模擬，未接入即時交通服務。</p><p role="status">{message}</p><ul>{Object.entries(s.connections).map(([id,c]) => <li key={id}>{id}: {uiText(c.status)} · {c.lastMessage}</li>)}</ul>
    </details></main>;
}
