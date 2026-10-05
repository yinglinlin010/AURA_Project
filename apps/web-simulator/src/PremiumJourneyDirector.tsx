import { manualJourneyStep } from './core/manual-journey';
import { DecisionObservatory } from './DecisionObservatory';
import { uiText } from './core/ui-copy';
import { useEffect, useRef, useState } from 'react';
import type { GatewayState, useAuraCommand } from './core/useAuraCommand';
import { premiumJourneyProposal } from '../../../packages/core-domain/src/premium-journey';
import { playPremiumJourney, PLAYBACK_STEPS, type PlaybackAction } from './core/premium-journey-playback';

/** Engineering controls only; production HMI remains in App/ClusterDisplay. */
export default function PremiumJourneyDirector({ state, sendCommand }: { state: GatewayState; sendCommand: ReturnType<typeof useAuraCommand>['sendCommand'] }) {
  const manualOnly = new URLSearchParams(window.location.search).get('manual') === '1';
  const [film, setFilm] = useState(() => !manualOnly && new URLSearchParams(window.location.search).get('film') === '1');
  const [requester, setRequester] = useState<'rear-tablet' | 'window-tablet'>('rear-tablet');
  const [playback, setPlayback] = useState({ status: 'idle', step: 0, label: "就緒" });
  const [manualGate, setManualGate] = useState<'accept' | 'resume' | null>(null);
  const [trace, setTrace] = useState<Array<{ timestamp: string; elapsedMs: number; action: string; kind?: 'observed-state'; observed: unknown }>>([]);
  const run = useRef<AbortController | null>(null);
  const latest = useRef({ state, sendCommand });
  latest.current = { state, sendCommand };
  useEffect(() => () => { run.current?.abort(); run.current = null; }, []);
  const center = state.connections['center-main'].status === 'connected';
  const rear = state.connections['rear-tablet'].status === 'connected';
  const point = state.journeyPoint;
  const proposal = [...state.proposals].reverse().find(p => p.payload?.competitionScenario === 'premium-journey');
  const pending = proposal && !['completed', 'declined', 'rejected', 'cancelled', 'interrupted'].includes(proposal.status);
  const added = state.journeyStops.some(stop => stop.placeId === point?.pointId);
  const load = (level: 'high' | 'normal') => sendCommand('center-main', { type: 'driver.cognitive_load.report', payload: { level, confidence: .95, timestamp: Date.now() } });
  const cloud = (mode: 'online' | 'offline') => sendCommand('center-main', { type: 'connectivity.mode.report', payload: { mode, evidence: `scenario-fixture:cloud-${mode}` } });
  const running = playback.status === 'running';
  const manualTake = useRef({ revision: '', startedAt: 0, last: '', resetRecorded: false, offlineSeen: false, quietSeen: false });
  const manualStep = manualJourneyStep(state, manualTake.current.revision === point?.revision ? manualTake.current : {});
  useEffect(() => {
    if (!manualOnly || !state.journeyPoint) return;
    const take = manualTake.current;
    if (take.revision !== state.journeyPoint.revision) {
      Object.assign(take, { revision: state.journeyPoint.revision, startedAt: Date.now(), last: '', resetRecorded: false, offlineSeen: false, quietSeen: false });
      setTrace([]);
    }
    const hasStop = state.journeyStops.some(s => s.placeId === state.journeyPoint?.pointId);
    if (hasStop && state.connectivity.mode === 'offline') take.offlineSeen = true;
    if (hasStop && state.rearExperience.mode === 'quiet') take.quietSeen = true;
    const step = manualJourneyStep(state, take);
    if (!step.observed || step.observed === take.last || (step.observed === 'reset' && take.resetRecorded)) return;
    take.last = step.observed;
    if (step.observed === 'reset') take.resetRecorded = true;
    const p = [...state.proposals].reverse().find(p => p.payload?.competitionScenario === 'premium-journey');
    const now = Date.now();
    setTrace(t => [...t, { timestamp: new Date(now).toISOString(), elapsedMs: now - take.startedAt, action: step.observed!, kind: 'observed-state', observed: { proposal: p?.status, decision: p?.lastDecision?.outcome, traceId: step.observed === 'quiet' || step.observed === 'resume' ? state.rearExperience.traceId : ['request', 'normal', 'accept'].includes(step.observed!) ? p?.lastDecision?.traceId : undefined, journeyTraceId: p?.lastDecision?.traceId, reasonCode: step.observed === 'quiet' || step.observed === 'resume' ? state.rearExperience.reasonCode : ['request', 'normal', 'accept'].includes(step.observed!) ? p?.lastDecision?.reasonCode : undefined, load: state.load, cloud: state.connectivity.mode, rearMode: state.rearExperience.mode, intelligence: state.rearExperience.liveJourney, added: state.journeyStops.some(s => s.placeId === state.journeyPoint?.pointId) } }]);
  }, [manualOnly, state]);
  const reset = () => { run.current?.abort(); run.current = null; setManualGate(null); setPlayback({ status: 'idle', step: 0, label: "就緒" }); setTrace([]); sendCommand('center-main', { type: 'demo.reset', payload: {} }); load('normal'); cloud('online'); sendCommand('center-main', { type: 'vehicle.telemetry.report', payload: { vehicle: { speedKph: 40, gear: 'D', drivingState: 'driving' } } }); };
  const stop = () => { run.current?.abort(); run.current = null; setManualGate(null); setPlayback(p => ({ ...p, status: 'stopped', label: "已停止 · 保留目前情境" })); };
  const start = async () => {
    if (manualOnly || run.current) return;
    const controller = new AbortController();
    run.current = controller;
    const startedAt = Date.now();
    setTrace([]);
    setManualGate(null);
    setPlayback({ status: 'running', step: 0, label: "啟動中" });
    const read = () => {
      const s = latest.current.state;
      const p = [...s.proposals].reverse().find(p => p.payload?.competitionScenario === 'premium-journey');
      const isAdded = s.journeyStops.some(stop => stop.placeId === s.journeyPoint?.pointId);
      return { ready: s.connections['center-main'].status === 'connected' && s.connections['rear-tablet'].status === 'connected' && s.connections[requester].status === 'connected', reset: !!s.journeyPoint && !p && !isAdded && s.load === 'normal' && s.speedKph === 40 && s.connectivity.mode === 'online' && s.rearExperience.mode === 'normal', proposal: p?.status, requestId: p?.proposalId, traceId: p?.lastDecision?.traceId ?? p?.traceId, reasonCode: p?.lastDecision?.reasonCode, decision: p?.lastDecision?.outcome, added: isAdded, load: s.load, cloud: s.connectivity.mode, rearMode: s.rearExperience.mode, intelligence: s.rearExperience.liveJourney };
    };
    const execute = (action: PlaybackAction) => {
      const { state: s, sendCommand: send } = latest.current;
      const p = [...s.proposals].reverse().find(p => p.payload?.competitionScenario === 'premium-journey');
      if (action === 'reset') return [send('center-main', { type: 'demo.reset', payload: {} }), send('center-main', { type: 'driver.cognitive_load.report', payload: { level: 'normal', confidence: .95, timestamp: Date.now() } }), send('center-main', { type: 'connectivity.mode.report', payload: { mode: 'online', evidence: 'scenario-fixture:cloud-online' } }), send('center-main', { type: 'vehicle.telemetry.report', payload: { vehicle: { speedKph: 40, gear: 'D', drivingState: 'driving' } } })].every(Boolean);
      if (action === 'request') return s.load === 'high' && !!s.journeyPoint && send(requester, { type: 'action.propose', payload: { proposal: premiumJourneyProposal(crypto.randomUUID(), s.journeyPoint) } });
      if (action === 'high' || action === 'normal') return send('center-main', { type: 'driver.cognitive_load.report', payload: { level: action, confidence: .95, timestamp: Date.now() } });
      if (action === 'accept') return p?.status === 'awaiting_consent' && send('center-main', { type: 'action.consent', payload: { proposalId: p.proposalId, decision: 'approve' } });
      if (action === 'offline' || action === 'restore') return send('center-main', { type: 'connectivity.mode.report', payload: { mode: action === 'offline' ? 'offline' : 'online', evidence: `scenario-fixture:cloud-${action === 'offline' ? 'offline' : 'online'}` } });
      return send('rear-tablet', { type: 'rear.mode.set', payload: { mode: action === 'quiet' ? 'quiet' : 'normal' } });
    };
    try {
      await playPremiumJourney({ read, execute, signal: controller.signal, film, onStep: (step, label) => { setManualGate(null); setPlayback({ status: 'running', step, label }); }, waitForManual: action => { setManualGate(action); setPlayback(p => ({ ...p, label: action === 'accept' ? "等待駕駛主動接受" : "資訊暫存 · 等待主動恢復" })); }, onObserved: (action, observed) => { setManualGate(null); setTrace(t => [...t, { timestamp: new Date().toISOString(), elapsedMs: Date.now() - startedAt, action, observed }]); } });
      if (run.current === controller) setPlayback({ status: 'complete', step: PLAYBACK_STEPS.length, label: "結束 · 已確認恢復" });
    } catch (error) {
      if (run.current === controller) setPlayback(p => ({ ...p, status: controller.signal.aborted ? 'stopped' : 'error', label: error instanceof Error ? error.message : "播放失敗" }));
    } finally { if (run.current === controller) run.current = null; }
  };
  if (new URLSearchParams(window.location.search).get('control') !== '1') return null;
  return <section className="control-console premium-director" aria-label="開發者高階旅程控制">
    <h2>{manualOnly ? "手動拍攝控制" : "開發者情境控制"}</h2><p>車況、景點、抵達時間與雲端資料皆為模擬</p>
    {manualOnly && <div className="console-feedback" aria-live="polite" data-manual-step={manualStep.step} data-manual-observed={manualStep.observed ?? ""}><b>手動進度：{manualStep.step}/9</b><span>{manualStep.instruction}</span><span>此頁只模擬駕駛負荷與連線；乘員、駕駛與 VIP 的操作請在各自畫面完成。</span><span>不會自動接受、不會自動恢復、不會按時間推進。</span></div>}
    <div className="console-load">
      <button disabled={!center} title={!center ? "閘道未連線，請啟動競賽主機" : "回到正常行駛並清除本輪紀錄"} onClick={reset}>重設</button>
      <fieldset disabled={running} style={{ display: 'contents' }}>
      {!manualOnly && <button title={added ? "東湖已加入，請重設開始新一輪" : pending ? "已有提案等待處理" : !point ? "請先重設以載入東湖景點" : "送出所選來源的行程提案"} disabled={state.connections[requester].status !== 'connected' || !point || !!pending || added} onClick={() => point && sendCommand(requester, { type: 'action.propose', payload: { proposal: premiumJourneyProposal(crypto.randomUUID(), point) } })}>行程提案</button>}
      <button disabled={!center} onClick={() => load('high')}>駕駛負荷高</button><button disabled={!center} onClick={() => load('normal')}>駕駛負荷正常</button>
      <button disabled={!center} onClick={() => cloud('offline')}>雲端離線</button>
      {!manualOnly && <button disabled={!rear} onClick={() => sendCommand('rear-tablet', { type: 'rear.mode.set', payload: { mode: 'quiet' } })}>靜謐模式</button>}
      <button disabled={!center} onClick={() => cloud('online')}>雲端恢復</button>
      </fieldset>
      {!manualOnly && <>
      <button disabled={!center || proposal?.status !== 'awaiting_consent' || (running && manualGate !== 'accept')} onClick={() => proposal && sendCommand('center-main', { type: 'action.consent', payload: { proposalId: proposal.proposalId, decision: 'approve' } })}>駕駛接受</button>
      <button disabled={!rear || (running && manualGate !== 'resume')} onClick={() => sendCommand('rear-tablet', { type: 'rear.mode.set', payload: { mode: 'normal' } })}>恢復資訊</button>
      <button disabled={!center || !rear || running} onClick={() => void start()}>自動播放</button>
      <button disabled={!running} onClick={stop}>停止</button>
      <label><input type="checkbox" checked={film} disabled={running} onChange={e => setFilm(e.target.checked)}/> 影片模式 · 延長各階段停留</label>
      <label>行程提案來源 <select value={requester} disabled={running} onChange={e => setRequester(e.target.value as 'rear-tablet' | 'window-tablet')}><option value="rear-tablet">後座</option><option value="window-tablet">智慧車窗</option></select></label>
      </>}
    </div>
    {!manualOnly && <div className="console-feedback" role="status" aria-live="polite" data-playback-status={playback.status} data-playback-step={playback.step}><span>{uiText(playback.status.toUpperCase())} · {playback.step}/{PLAYBACK_STEPS.length} · {uiText(playback.label)}</span><span>{film ? "影片模式 · 定時模擬接受與恢復" : "手動模式 · 人工接受與恢復"} · 沿用閘道指令</span></div>}
    {manualOnly && <details open><summary>這五個控制按鈕的用途</summary><div className="console-feedback"><span><b>重設：</b>開始新一輪，清除東湖提案與已加入的站點，回到正常行駛。</span><span><b>駕駛負荷高：</b>模擬駕駛忙碌；此時提案會延後，不出現中控同意提示。</span><span><b>駕駛負荷正常：</b>模擬駕駛有餘裕；中控可以詢問同意，但不會自動加入行程。</span><span><b>雲端離線：</b>停用模擬雲端旅程資訊，本地行程與操作仍可用。</span><span><b>雲端恢復：</b>雲端能力恢復；VIP 仍在靜謐模式時，資訊保留暫存，不會自動跳回。</span></div></details>}
    <DecisionObservatory state={state}/>
    <details><summary>{manualOnly ? "手動狀態證據" : "播放證據"} · {trace.length} 個已觀測步驟</summary><pre aria-label="已觀測播放紀錄">{JSON.stringify(trace, null, 2)}</pre></details>
    <div className="console-feedback"><span data-decision={proposal?.lastDecision?.outcome ?? ''}>PACT {uiText(proposal?.lastDecision?.outcome)} · {proposal?.lastDecision?.reasonCode ?? '尚無行程提案'}</span><span data-rear-mode={state.rearExperience.mode} data-cloud-presentation={state.rearExperience.liveJourney}>後座 {uiText(state.rearExperience.mode)} · 雲端 {uiText(state.rearExperience.liveJourney)}</span><span>本地核心運作中 · 權限／策略／注意力／行程／後座體驗</span><span>{state.connections['center-main'].lastMessage}</span></div>
    {!manualOnly && <p><a href="/?scenario=premium-journey&control=1&manual=1">開啟純手動拍攝控制（每一步由人操作）</a></p>}
    {manualOnly && <p>操作畫面：<a target="_blank" rel="noreferrer" href="/?scenario=premium-journey&record=1&display=window-tablet">智慧車窗</a> · <a target="_blank" rel="noreferrer" href="/?scenario=premium-journey&record=1&display=center-main">中控</a> · <a target="_blank" rel="noreferrer" href="/?scenario=premium-journey&record=1&display=rear-tablet">後座</a>；控制頁不入五屏素材。</p>}
    <a href="/?debug=premium-journey">開發者情境檢查器（測試工具）</a>
  </section>;
}
