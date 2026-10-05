import CabinSystemApp from './CabinSystemApp';
import { uiText } from './core/ui-copy';
import { useEffect, useState, type ReactNode } from 'react';
import windowReference from './assets/window-rainy-alpine.webp';
import aquamarinePhoto from './assets/dining/aquamarine.jpg';
import flamePhoto from './assets/dining/the-flame.jpg';
import auroraPhoto from './assets/dining/aurora.jpg';
import terraPhoto from './assets/dining/terra.jpg';
import { resolveBrand } from '../../../packages/core-domain/src/brand';
import { resolvePresentation } from '../../../packages/core-domain/src/presentation-resolver';
import type { PresenceSnapshot } from '../../../contracts/protocol/src/types';
import { DISPLAY_REGISTRATIONS, useAuraCommand, type DiscoveryState, type GatewayState, type JourneyRecommendationState, type RecommendationProposal, type SharedProposal, type SharedSafetyWarning, type SharedStop, type TransientPlace } from './core/useAuraCommand';
import { canUseDisplay, parseBrowserDisplaySelection } from './core/browser-display-selection';
import { CenterTaskPanel } from './CenterTaskPanel';
import { AssistanceTimingPanel } from './AssistanceTimingPanel';
import { ClusterDisplay } from './ClusterDisplay';
import PremiumJourneyDirector from './PremiumJourneyDirector';
import { premiumJourneyProposal, type PremiumJourneyPoint } from '../../../packages/core-domain/src/premium-journey';
import DongHwaDemo from './DongHwaDemo';
import type { ActiveTask, TaskLifecycleCommand } from '../../../contracts/protocol/src/types';
import './App.css';
import { useSimulatedCabin } from './core/simulated-cabin';
import { CenterControls, ClimateControls, DisplaySettings, MediaControls } from './SimulatorControls';

const BRAND = resolveBrand({
  productName: import.meta.env.VITE_AURA_PRODUCT_NAME,
  assistantName: import.meta.env.VITE_AURA_ASSISTANT_NAME,
  wakeWord: import.meta.env.VITE_AURA_WAKE_WORD,
});

type IconName = 'play' | 'pause' | 'back' | 'next' | 'arrow-up' | 'phone' | 'seat' | 'display' | 'settings' | 'pin' | 'route' | 'sun' | 'cloud' | 'rain' | 'mic' | 'check' | 'close' | 'signal';

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    play: <path d="m7 4 13 8-13 8z" fill="currentColor" stroke="none" />,
    pause: <><path d="M8 5v14" /><path d="M16 5v14" /></>,
    back: <><path d="m15 5-7 7 7 7" /><path d="M9 12h11" /></>,
    next: <><path d="m9 5 7 7-7 7" /><path d="M4 12h11" /></>,
    'arrow-up': <><path d="M12 20V4" /><path d="m5 11 7-7 7 7" /></>,
    phone: <path d="M7 3h3l2 5-2 2a15 15 0 0 0 4 4l2-2 5 2v3c0 1-1 2-2 2C10 18 5 13 4 5c0-1 1-2 3-2Z" />,
    seat: <><path d="M7 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" /><path d="M6 9v4l-2 5h11l-2-5-1-4H6Z" /><path d="M14 11h4l2 7h-6" /></>,
    display: <><rect x="3" y="4" width="18" height="13" rx="1" /><path d="M8 21h8M12 17v4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.2 1.8-1.8 1.8-1.8-1.2-.1-.1-1.7.7-.4 2.1h-2.6l-.4-2.1-1.7-.7-.1.1-1.8 1.2-1.8-1.8 1.2-1.8.1-.1-.7-1.7L5 13v-2.6l2.1-.4.7-1.7-.1-.1-1.2-1.8 1.8-1.8 1.8 1.2.1.1 1.7-.7.4-2.1h2.6l.4 2.1 1.7.7.1-.1 1.8-1.2 1.8 1.8-1.2 1.8-.1.1.7 1.7 2.1.4V13l-2.1.4-.7 1.6Z" transform="translate(-1 -1) scale(.95)" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    route: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h3a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    cloud: <path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7Z" />,
    rain: <><path d="M7 15a4 4 0 0 1-.5-8A6 6 0 0 1 18 6a4.5 4.5 0 0 1-.5 9H7Z" /><path d="m8 18-1 3m6-3-1 3m6-3-1 3" /></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0m-7 7v3m-4 0h8" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    signal: <><path d="M3 8a14 14 0 0 1 18 0M6 11a9 9 0 0 1 12 0m-9 3a4 4 0 0 1 6 0m-3 4h.01" /></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function StatusBar({ time = '16:03' }: { time?: string }) {
  return <div className="device-status" aria-label="模擬狀態列：時間、溫度與連線圖示皆為示例"><span>{time}</span><span>21°C</span><span className="status-source">模擬</span><span className="status-spacer" /><span>5G</span><Icon name="signal" size={15} /><span className="battery"><i /></span></div>;
}

function PresenceBadge({ presence }: { presence: PresenceSnapshot | null }) {
  const state = presence?.state ?? null;
  const label = state === 'OFFLINE' ? '離線 · 本地' : state;
  return <span className={`aura-presence-badge ${state ? state.toLowerCase() : 'pending'}`} aria-label={state ? `AURA 狀態 ${uiText(state)}` : 'AURA 狀態等待中'} title={state ? `AURA 狀態 · 版本 ${presence?.revision}` : '等待 Core Host 的 AURA 狀態'}>
    <i aria-hidden="true" />AURA · {uiText(label ?? 'PENDING')}
  </span>;
}

function ScreenHeading({ title, details, gatewayStatus, presence, windowExamples = false }: { title: string; details: string; gatewayStatus: string; presence: PresenceSnapshot | null; windowExamples?: boolean }) {
  return <div className="screen-heading"><h1>{title}</h1><span className="screen-heading-meta"><span>{details} · 閘道 {uiText(gatewayStatus)}</span><PresenceBadge presence={presence}/>{windowExamples && <small className="window-example-label">模擬示例</small>}</span></div>;
}

function RouteMap() {
  return <svg className="route-map" viewBox="0 0 700 390" role="img" aria-label="慕尼黑至斯圖加特的模擬路線圖">
    <rect width="700" height="390" fill="#3a3a3b" />
    <g fill="none" stroke="#5b5b5c" strokeWidth="1.2" opacity=".8">
      <path d="M-10 60 95 88 175 38 284 72 360 22 470 82 560 50 720 95M-20 130 75 153 143 119 260 151 336 118 445 162 548 130 710 163M-20 220 74 192 150 240 250 201 358 237 450 201 548 244 715 217M-15 302 92 276 175 320 270 284 365 334 465 290 567 326 710 290M42 -20 60 390M144 -20 173 390M250 -20 266 390M364 -20 358 390M487 -20 468 390M604 -20 575 390" />
      <path d="m0 104 700 122M0 258 700 70M112 0 622 390M520 0 188 390" stroke="#727273" strokeWidth="2" />
    </g>
    <path d="M90 286 C153 277 151 205 236 213 S328 150 393 171 S457 203 507 143 S560 123 614 94" fill="none" stroke="#ff5a00" strokeWidth="6" strokeLinecap="round" />
    <circle cx="92" cy="286" r="7" fill="#ff5a00" /><circle cx="614" cy="94" r="8" fill="#ff5a00" stroke="#f2f2f2" strokeWidth="2" />
    <g fill="#f2f2f2" fontFamily="Arial, sans-serif" fontSize="16" fontWeight="700"><text x="63" y="320">慕尼黑</text><text x="548" y="72">斯圖加特</text><text x="346" y="143">A–8</text></g>
  </svg>;
}

function proposalStateLabel(proposal: SharedProposal) {
  const routePreview = proposal.payload?.discoveryMode === 'route_preview';
  if (routePreview && proposal.status === 'completed') return "駕駛已閱 · 行程未變";
  if (routePreview && proposal.status === 'executing') return "駕駛同意 · 行程未變";
  if (proposal.status === 'deferred') return "已延後 · 等待駕駛負荷降低";
  if (proposal.status === 'awaiting_consent' && proposal.lastReasonCode === 'DEFER_RELEASED_DRIVER_LOAD_LOW') return "負荷已降低 · 等待駕駛同意";
  if (proposal.status === 'awaiting_consent') return "等待駕駛同意";
  if (proposal.status === 'completed') return proposal.kind === 'SHOW_GUIDANCE' ? "模擬引導已顯示 · 不控制車輛" : "已加入行程";
  if (proposal.status === 'executing' && proposal.kind === 'SHOW_GUIDANCE') return "模擬引導已啟用 · 不控制車輛";
  if (proposal.status === 'declined') return "駕駛已拒絕 · 行程未變";
  if (proposal.status === 'interrupted') return "已中止 · 安全事件優先";
  return `${proposal.status}${proposal.lastReasonCode ? ` · ${proposal.lastReasonCode}` : ''}`;
}

function recommendationAbstention(reasonCode: string) {
  const messages: Record<string, string> = {
    WHOLE_JOURNEY_EVIDENCE_SOURCE_UNAVAILABLE: "此主機尚未設定旅程建議來源，未查詢外部資料或產生建議。",
    WHOLE_JOURNEY_EVIDENCE_SOURCE_FAILED: "旅程資料來源失敗，未產生建議。",
    WHOLE_JOURNEY_EVIDENCE_UNAVAILABLE: "來源未提供旅程資料，未產生建議。",
    WHOLE_JOURNEY_CONTEXT_INCOMPLETE_OR_STALE: "需要最新起點、目的地與路線資訊；目前資料不完整或已過期。",
    NO_CANDIDATE_WITH_FRESH_ROUTE_DETOUR_EVIDENCE: `缺少最新繞路依據，${BRAND.assistantName} 無法提供可靠建議。`,
    NO_FRESH_DECISION_EVIDENCE: "沒有最新決策依據，未產生建議。",
    NO_FRESH_ROUTE_DETOUR_EVIDENCE: "無法確認最新繞路資訊，未產生建議。",
    NO_SUBSTANTIATED_RECOMMENDATION: "現有依據不足以提供旅程建議。",
  };
  return messages[reasonCode] ?? `未產生建議（${reasonCode}）。`;
}

function journeyAiError(code: string) {
  const labels: Record<string, string> = {
    GEMINI_AUTH_FAILED: 'Gemini 金鑰認證失敗', GEMINI_API_KEY_MISSING: '尚未設定 Gemini 金鑰',
    GEMINI_QUOTA_EXCEEDED: 'Gemini 配額不足', GEMINI_SERVICE_BUSY: 'Gemini 服務暫時忙碌', GEMINI_MODEL_UNAVAILABLE: 'Gemini 模型不可用',
    JOURNEY_AI_TIMEOUT: '模型回覆逾時', JOURNEY_AI_OFFLINE: '目前離線',
    JOURNEY_AI_RESPONSE_INVALID: '模型回覆未通過驗證', JOURNEY_AI_PROVIDER_FAILED: '模型服務未連線或請求失敗',
  };
  return labels[code] ?? '模型服務不可用';
}

function RecommendationResult({ recommendation, proposals, onSubmit }: { recommendation: JourneyRecommendationState; proposals: SharedProposal[]; onSubmit: (proposal: RecommendationProposal) => void }) {
  if (recommendation.status === 'idle' || recommendation.status === 'pending') return null;
  if (recommendation.status === 'abstained') return <div className="recommendation-message abstained" role="status"><b>沒有足夠依據提供建議</b><span>{recommendationAbstention(recommendation.reasonCode)}</span><small>{recommendation.reasonCode}</small></div>;
  if (recommendation.status === 'error') return <div className="recommendation-message failed" role="alert"><b>建議請求失敗</b><span>{recommendation.message}</span><small>{recommendation.errorCode}</small></div>;

  const proposal = recommendation.proposal;
  const details = recommendation.recommendation;
  const rationale = details.rationale;
  const evidence = details.evidence as unknown as Array<Record<string, unknown>>;
  const context = details.wholeJourneyContext as unknown as Array<Record<string, unknown>>;
  const sourceSummary = [...evidence, ...context].map((item) => `${String(item.sourceLabel ?? item.source ?? '來源未知')} · ${String(item.freshness ?? 'unknown')}`).filter((value, index, all) => all.indexOf(value) === index).join(' / ');
  const submittedProposal = proposals.find((item) => item.proposalId === proposal.proposalId);
  const submittedState = recommendation.status === 'submitted'
    ? submittedProposal ? proposalStateLabel(submittedProposal) : "已送交策略閘道，等待中控確認"
    : null;
  const formatEvidence = (item: Record<string, unknown>) => {
    const time = typeof item.observedAt === 'number' ? new Date(item.observedAt).toLocaleTimeString() : '時間未知';
    return `${String(item.criterion)} — ${String(item.sourceLabel)} (${String(item.source)}, ${String(item.freshness)}, observed ${time})`;
  };

  return <div className={`recommendation-result ${details?.simulated === true ? 'simulated' : ''}`}>
    <div className="recommendation-result-heading"><span>{details?.simulated === true ? "模擬依據" : "有依據的建議"}</span><b>{proposal.summary}</b></div>
    {recommendation.status === 'proposal' && recommendation.submissionError && <p className="recommendation-rejection" role="alert">策略閘道拒絕提案（{recommendation.submissionError}）。行程未變，請檢視建議或重新詢問。</p>}
    {details.aiAnalysis && <div className="journey-ai-analysis" role="status" aria-label="AI 旅程說明">
      <b>{details.aiAnalysis.provider === 'gemini' ? 'Gemini 雲端' : 'Ollama 本地'} · {details.aiAnalysis.model}</b>
      {details.aiAnalysis.status === 'completed' ? <><span>{details.aiAnalysis.summary}</span><small>實際模型回覆 · {(details.aiAnalysis.durationMs / 1000).toFixed(1)} 秒{details.simulated ? ' · 行程依據仍為模擬資料' : ''}</small></> : <span>{journeyAiError(details.aiAnalysis.errorCode)}；保留本地規則建議。</span>}
      {details.aiAnalysis.fallbackReason && <small>{journeyAiError(details.aiAnalysis.fallbackReason)}，已改用本地模型。</small>}
      <small>模型僅提供說明；送交並取得駕駛同意後才更新行程。</small>
    </div>}
    {submittedState
      ? <p className="recommendation-submitted" role="status">{submittedState}。駕駛在中控確認後才更新行程。</p>
      : <>
        {rationale[0] && <p className="recommendation-rationale">{rationale[0]}</p>}
        <p className="recommendation-provenance"><b>依據</b> {sourceSummary || "來源資訊不可用"}</p>
        <details className="recommendation-details"><summary>建議理由與依據</summary>
          {rationale.length > 1 && <ul>{rationale.slice(1).map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>}
          <div className="recommendation-evidence-group"><b>建議因素</b>{evidence.length ? <ul>{evidence.map((item, index) => <li key={`${String(item.criterion)}-${index}`}>{formatEvidence(item)}</li>)}</ul> : <p>尚未取得因素來源。</p>}</div>
          <div className="recommendation-evidence-group"><b>完整旅程資訊</b>{context.length ? <ul>{context.map((item, index) => <li key={`${String(item.criterion)}-${index}`}>{formatEvidence(item)}</li>)}</ul> : <p>尚未取得完整旅程来源。</p>}</div>
          {details.alternatives.length > 0 && <div className="recommendation-evidence-group"><b>其他候選項目</b><ul>{details.alternatives.map((option) => <li key={option.placeId}><b>{option.label}</b>{option.rationale.length > 0 && <span> — {option.rationale.join(' ')}</span>}{option.evidence.length > 0 && <ul>{option.evidence.map((item, index) => <li key={`${item.criterion}-${index}`}>{formatEvidence(item as unknown as Record<string, unknown>)}</li>)}</ul>}</li>)}</ul></div>}
        </details>
        <button className="recommendation-submit" onClick={() => onSubmit(proposal)}>送交駕駛確認</button>
      </>}
  </div>;
}

function CenterDisplay({ journeyPoint, proposals, journeyStops, connection, warning, presentation, recommendation, tasks, taskReceipt, onTaskCommand, onConsent, onRecommendationRequest, onRecommendationSubmit }: { journeyPoint: PremiumJourneyPoint | null; proposals: SharedProposal[]; journeyStops: SharedStop[]; connection: { status: string; lastMessage: string }; warning: SharedSafetyWarning | null; presentation: ReturnType<typeof resolvePresentation>; recommendation: JourneyRecommendationState; tasks: ActiveTask[]; taskReceipt: { commandId: string; status: string; reasonCode?: string } | null; onTaskCommand: (command: TaskLifecycleCommand) => boolean; onConsent: (proposalId: string, decision: 'approve' | 'decline') => void; onRecommendationRequest: (text: string) => boolean; onRecommendationSubmit: (proposal: RecommendationProposal) => void }) {
  const premiumAdded = journeyStops.some(stop => stop.placeId === journeyPoint?.pointId);
  const impact = premiumAdded ? journeyPoint?.etaImpactMinutes ?? 0 : 0;
  const stopProposals = proposals.filter((item) => item.kind === 'ADD_TRIP_STOP' && item.targetRole === 'center');
  const guidanceProposals = proposals.filter((item) => item.kind === 'SHOW_GUIDANCE' && item.targetRole === 'center');
  const routePreviewProposals = proposals.filter((item) => item.kind === 'SHOW_INFORMATION' && item.targetRole === 'center' && item.payload?.discoveryMode === 'route_preview');
  const centerProposals = [...stopProposals, ...guidanceProposals, ...routePreviewProposals];
  const hasDeferredProposal = centerProposals.some((item) => item.status === 'deferred');
  const proposalDetailsVisible = presentation.load !== undefined && !presentation.deferNonCritical && !presentation.suppressNonSafetyContent;
  const [recommendationText, setRecommendationText] = useState('');
  const [dropoffClarificationNeeded, setDropoffClarificationNeeded] = useState(false);
  const recommendationUnavailable = presentation.load === undefined || presentation.deferNonCritical || presentation.suppressNonSafetyContent;
  const submittedProposal = recommendation.status === 'submitted' ? proposals.find((item) => item.proposalId === recommendation.proposal.proposalId) : undefined;
  const recommendationBusy = recommendation.status === 'pending' || (recommendation.status === 'submitted' && (!submittedProposal || !['completed', 'declined', 'rejected', 'cancelled', 'interrupted'].includes(submittedProposal.status)));
  const densityClass = presentation.informationDensity === 'reduced' ? 'load-reduced' : presentation.informationDensity === 'safety_only' ? 'load-critical' : '';
  return <section className={`device center-device ${densityClass} ${warning ? 'safety-active' : ''}`} aria-label="中控畫面">
    <aside className="journey-column">
      <h2>行程</h2>
      <div className="journey-meta"><small className="journey-source-label">模擬情境</small><small className={`display-connection ${uiText(connection.status)}`}>閘道 {uiText(connection.status)}</small></div>
      <div className="journey-timeline">
        <div className="journey-stop done"><time>14:32</time><i/><div><b>慕尼黑</b><span>起點 · 已出發</span></div></div>
        <div className="journey-stop"><time>15:45</time><i/><div><b>晚餐 <small>預約</small></b><span>Ambra 飯店 · 停留 12 分鐘</span></div></div>
        <div className="journey-stop traffic"><time>17:15</time><i/><div><b>A–8 高速公路</b><span>交通延誤 · +8 分鐘</span></div></div>
        {proposalDetailsVisible && stopProposals.filter((item) => item.status === 'awaiting_consent').map((item) => <div className="journey-stop proposed" key={item.proposalId}><time>提案</time><i/><div><b>{uiText(item.summary)}</b><span>{proposalStateLabel(item)}</span></div></div>)}
        {journeyStops.slice(-1).map((stop) => <div className="journey-stop done" key={stop.stopId}><time>已加入</time><i/><div><b>{uiText(stop.label)}</b><span>經 HMI 閘道確認</span></div></div>)}
        {journeyStops.length > 1 && <details className="journey-stop-details"><summary>{journeyStops.length - 1} 個先前核准的停靠點</summary><ul>{journeyStops.slice(0, -1).map((stop) => <li key={stop.stopId}>{uiText(stop.label)}</li>)}</ul></details>}
        <div className="journey-stop destination"><time>19:30</time><i/><div><b>斯圖加特</b><span>目的地 · 98 公里</span></div></div>
      </div>
    </aside>
    <div className="center-main"><StatusBar />
      {warning && <div className="center-safety-warning" role="alert" aria-live="assertive"><span>重大安全警示</span><b>偵測到需立即處理的安全狀況</b><small>{warning.source === 'simulated' ? "模擬" : warning.source.toUpperCase()} · {warning.freshness.toUpperCase()} 訊號 · 啟用時間 {new Date(warning.activatedAt).toLocaleTimeString()}</small></div>}
      <div className="route-summary"><div><Icon name="route"/><b>98 km</b><span>至目的地</span></div><div><Icon name="settings"/><b>{64 + impact} 分鐘</b><span>{impact ? "預計 19:44 · 模擬" : "預計 19:32"}</span></div><div><Icon name="next"/><b>{premiumAdded ? "下一站" : "目前路段"}</b><span>{premiumAdded ? uiText(journeyPoint?.label) : "A–8 高速公路"}</span></div><small className="route-source-label">模擬導航數據</small></div>
      <div className="map-wrap"><RouteMap /><span className="map-source-label">{premiumAdded ? `行程已更新 · ${uiText(journeyPoint?.label)} · 模擬路線` : "模擬路線"}</span>
        <div className="recommendation-tools">
          {!recommendationUnavailable && <form className="recommendation-form" onSubmit={(event) => { event.preventDefault(); if (/\b(?:mom|mother)\b|媽媽/i.test(recommendationText) && /\b(?:get out|drop[- ]?off)\b|下車|下车/i.test(recommendationText) && /\b(?:charg(?:ing|er))\b|充電|充电/i.test(recommendationText)) { setDropoffClarificationNeeded(true); return; } if (onRecommendationRequest(recommendationText)) { setRecommendationText(''); setDropoffClarificationNeeded(false); } }}>
            <label className="sr-only" htmlFor="journey-recommendation-request">詢問旅程建議</label>
            <input id="journey-recommendation-request" value={recommendationText} maxLength={1000} disabled={recommendationBusy} onChange={(event) => setRecommendationText(event.target.value)} placeholder="詢問行程，例如：沿途用餐地點" />
            <button type="submit" disabled={recommendationBusy || !recommendationText.trim()}>建議</button>
            {dropoffClarificationNeeded && <div className="recommendation-message" role="group" aria-label="乘員下車偏好"><span>是否需要靠近入口或方便乘員下車？</span><button type="button" onClick={() => { if (onRecommendationRequest(`${recommendationText} entrance proximity matters`)) { setRecommendationText(''); setDropoffClarificationNeeded(false); } }}>需要</button><button type="button" onClick={() => { if (onRecommendationRequest(`${recommendationText} entrance proximity not important`)) { setRecommendationText(''); setDropoffClarificationNeeded(false); } }}>沒有特別偏好</button></div>}
          </form>}
          {presentation.load === undefined && !presentation.suppressNonSafetyContent && <span className="recommendation-paused" role="status">等待駕駛負荷資訊後再提供建議。</span>}
          {presentation.deferNonCritical && !presentation.suppressNonSafetyContent && <span className="recommendation-paused" role="status">駕駛忙碌，暫緩非必要資訊。</span>}
          {recommendation.status === 'pending' && proposalDetailsVisible && <span className="recommendation-pending" role="status">正在核對旅程資訊…</span>}
          {proposalDetailsVisible && <RecommendationResult recommendation={recommendation} proposals={proposals} onSubmit={onRecommendationSubmit}/>}
        </div>
      </div>
      {proposalDetailsVisible && centerProposals.filter((item) => item.status === 'awaiting_consent' && item.requiresConsent).map((item) => <div className="proposal-panel" key={item.proposalId}><div><span className="proposal-kicker">{item.kind === 'SHOW_GUIDANCE' ? "模擬停車資訊 · 駕駛決定" : item.payload?.discoveryMode === 'route_preview' ? "乘員路線預覽 · 來源資料 · 駕駛決定" : "乘員提案 · 共享行程"}</span><b>{item.payload?.competitionScenario === "premium-journey" ? "行程更新待確認" : item.summary}</b><span>{item.payload?.competitionScenario === "premium-journey" ? `${uiText(item.payload.label)} · +${Number(item.payload.etaImpactMinutes)} 分鐘` : proposalStateLabel(item)}</span>{item.kind === 'SHOW_GUIDANCE' && <span>來源：模擬 · 時效： {String((item.payload?.freshness as { state?: string } | undefined)?.state ?? 'unknown')} · 不控制車輛</span>}{item.payload?.discoveryMode === 'route_preview' && <span>路線：API · {String(item.payload.provider)} · 時效： {String(item.payload.freshness ?? 'unknown')} · 觀測時間 {new Date(Number(item.payload.observedAt)).toLocaleTimeString()} · {String(item.payload.attribution)}</span>}{item.payload?.discoveryMode === 'route_preview' && <span>地點：API · {String(item.payload.placeProvider)} · 時效： {String(item.payload.placeFreshness ?? 'unknown')} · 觀測時間 {new Date(Number(item.payload.placeObservedAt)).toLocaleTimeString()} · {String(item.payload.placeAttribution)} · 僅確認資訊，行程未變</span>}</div><button className="quiet-action" onClick={() => onConsent(item.proposalId, 'decline')}><Icon name="close"/> {item.payload?.competitionScenario === "premium-journey" ? "維持路線" : "拒絕"}</button><button className="accept-action" onClick={() => onConsent(item.proposalId, 'approve')}><Icon name="check"/> {item.payload?.competitionScenario === "premium-journey" ? "接受" : "同意"}</button></div>)}
      {proposalDetailsVisible && routePreviewProposals.filter((item) => item.status === 'completed' || item.status === 'declined').map((item) => <div className="proposal-panel guidance-result" key={item.proposalId}><div><span className="proposal-kicker">乘員路線預覽 · API · 暫時使用</span><b>{proposalStateLabel(item)}</b><span>{uiText(item.summary)}</span><small>路線時效： {String(item.payload?.freshness ?? 'unknown')} · 觀測時間 {new Date(Number(item.payload?.observedAt)).toLocaleTimeString()} · {String(item.payload?.attribution ?? 'Attribution unavailable')}</small><small>地點時效： {String(item.payload?.placeFreshness ?? 'unknown')} · 觀測時間 {new Date(Number(item.payload?.placeObservedAt)).toLocaleTimeString()} · {String(item.payload?.placeAttribution ?? 'Attribution unavailable')}</small></div></div>)}
      {proposalDetailsVisible && guidanceProposals.filter((item) => item.status === 'executing' || item.status === 'completed' || item.status === 'declined').map((item) => <div className="proposal-panel guidance-result" key={item.proposalId}><div><span className="proposal-kicker">模擬停車輔助</span><b>{proposalStateLabel(item)}</b><span>來源：模擬 · 不控制車輛</span></div></div>)}
      {presentation.centerHighLoadMarkerEligible && hasDeferredProposal && <span className="deferred-proposal-indicator" aria-label="旅程建議將在駕駛負荷降低後呈現" title="旅程建議將在駕駛負荷降低後呈現" />}
      {connection.status !== 'connected' && <div className="gateway-display-error">中控閘道 {uiText(connection.status)}: {uiText(connection.lastMessage)}</div>}
      <CenterTaskPanel tasks={tasks} connected={connection.status === 'connected'} available={proposalDetailsVisible && !warning} receipt={taskReceipt} send={onTaskCommand}/>
      <CenterControls blocked={recommendationUnavailable || !!warning} stops={journeyStops.map(stop => uiText(stop.label))}/>
    </div>
  </section>;
}



function PassengerDisplay({ onSampleProposal, onProposal: _onProposal, proposal: _proposal, connection: _connection, connectivity: _connectivity, discovery: _discovery, searchPlaces: _searchPlaces, previewRoute: _previewRoute }: {
  onSampleProposal: (name: string) => boolean;
  onProposal: (place: TransientPlace, route: DiscoveryState['route']['routes'][number], originLabel: string) => void;
  proposal?: SharedProposal;
  connection: { status: string; lastMessage: string };
  connectivity: GatewayState['connectivity'];
  discovery: DiscoveryState;
  searchPlaces: (slot: 'origin' | 'destination', query: string) => boolean;
  previewRoute: (origin: TransientPlace, destination: TransientPlace) => boolean;
}) {
  const [filter, setFilter] = useState("全部");
  const [sent, setSent] = useState(false);
  const [sentBaseline, setSentBaseline] = useState<string | undefined>();
  const [message, setMessage] = useState('');
  const proposalPending = !!_proposal && !['completed', 'declined', 'rejected', 'cancelled', 'interrupted'].includes(_proposal.status);
  useEffect(() => { if (!sent) return; const timer = setTimeout(() => { setSent(false); setMessage('尚未收到提案狀態，請確認閘道連線後重試'); }, 10000); return () => clearTimeout(timer); }, [sent]);
  const filters = ["全部", "精緻餐飲", "咖啡館", "植物料理"];

  const samplePlaces = [
    { name: '焰火', style: "現代料理 · ★ 4.9 · +4 分鐘", image: flamePhoto },
    { name: '曙光', style: "咖啡館 · ★ 4.7 · +3 分鐘", image: auroraPhoto },
    { name: '大地', style: "植物料理 · ★ 4.6 · +6 分鐘", image: terraPhoto },
  ];

  return <section className="device passenger-device" aria-label="副駕畫面">
    <aside className="discovery-sidebar">
      <h2>美食<br/>指南</h2>

      <div className="sidebar-section">
        <h3>在地風味</h3>
        <p>探索沿途餐廳。</p>
      </div>

      <div className="sidebar-section">
        <h3>精選餐廳</h3>
        <p>比較料理與模擬繞路時間。</p>
      </div>

      <div className="side-rule" />

      <div className="sidebar-section">
        <h3>篩選與搜尋</h3>
        <div className="vertical-filters">
          {filters.map((item) => (
            <button
              type="button"
              key={item}
              className={filter === item ? 'filter-btn selected' : 'filter-btn'}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
    </aside>

    <div className="discovery-main">
      <div className="discovery-top">
        <span className="time-display">16:03</span>
        <span className="status-display">AURA · 待命 · 示例餐廳</span>
      </div>

      <div className="featured-place">
        <div className="feature-art">
          <img src={aquamarinePhoto} alt="海藍餐廳"/>
        </div>
        <div className="feature-caption-overlay">
          <div className="feature-text">
            <b>海藍餐廳</b>
            <small>地中海料理 · ★ 4.8 · 繞路 +5 分鐘</small>
          </div>
          <button className="propose-button" disabled={_connection.status !== 'connected' || proposalPending || (sent && _proposal?.proposalId === sentBaseline)} onClick={() => { if (onSampleProposal('海藍餐廳')) { setSentBaseline(_proposal?.proposalId); setSent(true); setMessage('提案已送出 · 等待駕駛確認'); } else setMessage('送出失敗，請確認閘道連線後重試'); }}>提議停靠</button>
        </div>
      </div>

      <div className="place-list">
        {samplePlaces.filter(place => filter === '全部' || (filter === '精緻餐飲' && place.name === '焰火') || (filter === '咖啡館' && place.name === '曙光') || (filter === '植物料理' && place.name === '大地')).map((place) => (
          <article key={place.name} className={`place-card`}>
            <div className="place-info">
              <b>{place.name}</b>
              <small>{place.style}</small>
            </div>
            <img src={place.image} alt={place.name} className="place-image" />
          </article>
        ))}
      </div>

      <p className="sim-feedback" role="status">{_connection.status !== 'connected' ? '閘道尚未連線，連線後可提出停靠' : _proposal && _proposal.proposalId !== sentBaseline ? proposalStateLabel(_proposal) : message}</p>
      <div className="passenger-footer">
        示例地點；需駕駛同意，才會加入模擬行程。
      </div>
    </div>
  </section>;
}

function RearDisplay({ onRestStopProposal, proposal, journeyPoint, journeyStops, experience, presentation, connected, onMode }: { onRestStopProposal: () => void; proposal?: SharedProposal; journeyPoint: PremiumJourneyPoint | null; journeyStops: SharedStop[]; experience: GatewayState['rearExperience']; presentation: ReturnType<typeof resolvePresentation>; connected: boolean; onMode: (mode: 'normal' | 'quiet') => void }) {
  const quiet = !!journeyPoint && presentation.suppressNonCriticalNotifications;
  const added = journeyStops.some(stop => stop.placeId === journeyPoint?.pointId);
  const pending = !!proposal && !['completed', 'declined', 'rejected', 'cancelled', 'interrupted'].includes(proposal.status);
  const [cabin, setCabin] = useSimulatedCabin();
  const [settings, setSettings] = useState('');
  return <section className="device rear-device" data-zone-mode={quiet ? "quiet" : "normal"} data-live-journey={experience.liveJourney} aria-label="後座畫面">
    <div className="rear-tile media-tile">
      <h3>影音播放</h3>
      <p>音樂與音訊</p>
      <MediaControls/>
    </div>
    <div className="rear-tile climate-tile">
      <h3>空調控制</h3>
      <span className="tile-label">後座溫度</span>
      <ClimateControls rear/>
    </div>
    <div className="rear-tile communication-tile">
      <h3>後座通訊</h3>
      <div className="comm-row premium-secondary">
        <div>
          <b>聯絡駕駛</b>
          <span>{cabin.call ? '等待駕駛確認' : '待命'}</span>
        </div>
        <button className="orange-button call-button" aria-pressed={cabin.call} onClick={() => setCabin({ call: !cabin.call })}><Icon name="phone" size={18}/>{cabin.call ? "取消呼叫" : "呼叫"}</button>
      </div>
      <hr className="divider" />
      <div className="comm-row">
        <div>
          <b>{journeyPoint ? (added ? `${uiText(journeyPoint.label)} · 下一站` : uiText(journeyPoint.label)) : "行程提案"}</b>
          <span>{journeyPoint ? (quiet ? "靜謐模式 · 行程保留" : pending ? proposalStateLabel(proposal!) : added ? "行程已更新" : "景點探索 · +12 分鐘") : "需要駕駛同意"}</span>
        </div>
        <button className="outline-button rest-stop-button" disabled={!connected || pending || (!!journeyPoint && (added || quiet))} onClick={onRestStopProposal}><Icon name="pause" size={18}/>{journeyPoint ? "加入行程" : "休息站"}</button>
      </div>
      {journeyPoint && <div className="rear-journey-intelligence" hidden={presentation.holdCloudInformation} aria-live={quiet ? "off" : "polite"}><b>即時旅程資訊</b><span>{experience.liveJourney === 'presented' ? '可用 · 抵達 14:26 · 模擬資料' : "暫時無法使用"}</span></div>}
    </div>
    <div className="rear-tile settings-tile">
      <h3>系統設定</h3>
      {settings && <DisplaySettings general={settings === "general"}/>}
      <div className="settings-options">
        <button className="setting-row" aria-expanded={settings === "display"} onClick={() => setSettings(settings === "display" ? "" : "display")}><Icon name="display" size={24}/><span>顯示與音訊</span></button>
        <button className="setting-row" aria-expanded={settings === "general"} onClick={() => setSettings(settings === "general" ? "" : "general")}><Icon name="settings" size={24}/><span>設定</span></button>
        {journeyPoint && <button className="setting-row" disabled={!connected} aria-pressed={quiet} onClick={() => onMode(quiet ? "normal" : "quiet")}><Icon name="pause" size={24}/><span>{quiet ? "恢復資訊" : "靜謐模式"}</span></button>}
      </div>
    </div>
  </section>;
}

function WindowDisplay({ connectivity, presence, journeyPoint, journeyStops, proposal, presentation, connected, onJourneyRequest }: { connectivity: GatewayState['connectivity']; presence: PresenceSnapshot | null; journeyPoint: PremiumJourneyPoint | null; journeyStops: SharedStop[]; proposal?: SharedProposal; presentation: ReturnType<typeof resolvePresentation>; connected: boolean; onJourneyRequest: () => boolean }) {
  const [selected, setSelected] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const quiet = !!journeyPoint && presentation.suppressNonCriticalNotifications;
  const added = journeyStops.some(stop => stop.placeId === journeyPoint?.pointId);
  const pending = !!proposal && !['completed', 'declined', 'rejected', 'cancelled', 'interrupted'].includes(proposal.status);
  useEffect(() => { if (quiet) setSelected(false); }, [quiet]);
  useEffect(() => {
    if (!proposal || ['declined', 'rejected', 'cancelled', 'interrupted'].includes(proposal.status)) { setRequestSent(false); return; }
    setRequestSent(true);
    const timer = setTimeout(() => setRequestSent(false), 2200);
    return () => clearTimeout(timer);
  }, [proposal?.proposalId]);
  const networkLabel = connectivity.mode === 'offline' ? '離線 · 本地' : connectivity.mode === 'degraded' ? '連線受限 · 模擬' : '連線 · 模擬';
  return <section className="device window-device" data-zone-mode={quiet ? "quiet" : "normal"} aria-label="智慧車窗">
    <div className="window-scene">
      <div className="window-photo"><img src={windowReference} alt="示意窗外景色；疊加資訊皆為模擬示例"/></div>
      <div className="window-status" aria-label="模擬環境狀態">
        <span className="window-time"><b>19:42</b><small>時間<span className="window-label-detail"> · 模擬</span></small></span>
        <span><Icon name="rain" size={22}/><b>12°C · 雨</b><small>天氣<span className="window-label-detail"> 示例</span></small></span>
        <span><Icon name="arrow-up" size={22}/><b>14 KM</b><small><span className="window-route-prefix">高山道路 · </span>路線示例</small></span>
        <span className="window-energy"><i className="energy-battery" aria-hidden="true"><i /></i><b>82% · 412 KM</b><small>{networkLabel.split(" · ")[0]}<span className="window-label-detail"> · {networkLabel.split(" · ")[1]}</span></small></span>
      </div>
      {journeyPoint && <div className="window-journey-overlay" data-poi-state={added ? 'accepted' : pending ? 'requested' : selected ? 'selected' : 'available'}>
        {added ? <span className="window-next-stop">{uiText(journeyPoint.label.toUpperCase())} · 下一站</span> : !quiet && <>
          {!selected && !pending ? <button className="window-poi-anchor" onClick={() => setSelected(true)}><b>{uiText(journeyPoint.label.toUpperCase())}</b><small>{uiText(journeyPoint.category)}</small></button> : <div className="window-poi-detail"><b>{uiText(journeyPoint.label.toUpperCase())}</b><span>{uiText(journeyPoint.description)}</span><span>+{journeyPoint.etaImpactMinutes} 分鐘繞路時間</span><button disabled={!connected || pending} onClick={() => { if (onJourneyRequest()) setSelected(false); }}>加入行程</button></div>}
          {requestSent && pending && <span className="window-request-feedback" role="status">行程提案已送出</span>}
          {proposal && ['declined', 'rejected'].includes(proposal.status) && <small>維持原路線</small>}
          <small>模擬旅程資訊</small>
        </>}
      </div>}
      <span className="window-presence">AURA · {uiText(presence?.state ?? 'STATE PENDING')}</span>
    </div>
  </section>;
}

function ControlConsole({ speedKph, load, connectivity, connections, status, lastMessage, onSpeed, onLoad: _onLoad, onConnectivity, clusterMotionPaused: _clusterMotionPaused, onClusterMotionPaused: _onClusterMotionPaused }: { speedKph: number; load: 'low' | 'normal' | 'high' | 'critical' | null; connectivity: GatewayState['connectivity']; connections: GatewayState['connections']; status: string; lastMessage: string; onSpeed: (speed: number) => void; onLoad: (level: 'low' | 'normal' | 'high' | 'critical') => void; onConnectivity: (mode: 'online' | 'degraded' | 'offline') => void; clusterMotionPaused: boolean; onClusterMotionPaused: (paused: boolean) => void }) {
  const [speedInput, setSpeedInput] = useState(String(speedKph));
  useEffect(() => setSpeedInput(String(speedKph)), [speedKph]);
  return <section className="control-console" aria-labelledby="console-title">
    <div className="console-heading"><div><span className="console-kicker">開發工具 · 獨立於五屏之外</span><h2 id="console-title">HMI 閘道控制台</h2></div><span className={`gateway-state ${uiText(status)}`}>{uiText(status)}</span></div>
    <p className="console-description">協定 v1 · center-main / main-computer · 共享車速 <b>{Math.round(speedKph)} km/h</b> · 駕駛負荷 <b>{uiText(load ?? 'not reported')}</b> · 連線 <b>{uiText(connectivity.mode)} ({connectivity.source})</b></p>
    <p className="console-description logical-socket-note">此瀏覽器模擬五個邏輯螢幕，並非五個實體螢幕或獨立硬體。</p>
    <div className="display-connections" aria-label="邏輯螢幕閘道連線狀態">{DISPLAY_REGISTRATIONS.map(({ displayId }) => {
      const connection = connections[displayId];
      return <div className="display-connection-card" key={displayId}><div><b>{displayId}</b><small>{connection.deviceId} · {uiText(connection.role)}</small></div><span className={`gateway-state ${uiText(connection.status)}`}>{uiText(connection.status)}</span><small className="connection-message">{uiText(connection.lastMessage)}</small></div>;
    })}</div>
    <div className="console-controls"><label>車速 <span><input type="number" min="0" max="300" value={speedInput} onChange={(event) => setSpeedInput(event.target.value)} /> km/h</span></label><button onClick={() => { const speed = Number(speedInput); if (Number.isFinite(speed) && speed >= 0 && speed <= 300) onSpeed(speed); }}>送出模擬車速</button><label>模擬連線狀態</label><button aria-pressed={connectivity.mode === 'online' && connectivity.source === 'simulated'} onClick={() => onConnectivity('online')}>設為連線</button><button aria-pressed={connectivity.mode === 'degraded' && connectivity.source === 'simulated'} onClick={() => onConnectivity('degraded')}>設為連線受限</button><button aria-pressed={connectivity.mode === 'offline' && connectivity.source === 'simulated'} onClick={() => onConnectivity('offline')}>設為離線</button></div>
    <div className="console-feedback"><span>連線： {uiText(status)}{status === 'connected' ? ' · registered · welcome received' : ''}</span><span>最新閘道訊息： {uiText(lastMessage)}</span></div>
  </section>;
}

function SimulatorApp() {
  const [clusterMotionPaused, setClusterMotionPaused] = useState(false);
  const [entry] = useState(() => parseBrowserDisplaySelection(window.location.search));
  const showsDisplay = (displayId: (typeof DISPLAY_REGISTRATIONS)[number]['displayId']) => canUseDisplay(entry, displayId);
  const { state: gateway, sendCommand, sendTaskCommand, taskReceipt, voice, startVoice, stopVoice, discovery, searchPlaces, previewRoute, recommendation, requestJourneyRecommendation, submitJourneyRecommendation } = useAuraCommand(entry);
  const premiumRoute = new URLSearchParams(window.location.search).get('scenario') === 'premium-journey';
  const controlOnly = premiumRoute && new URLSearchParams(window.location.search).get('control') === '1';
  const recording = entry.mode === 'single' && new URLSearchParams(window.location.search).get('record') === '1';
  const point = gateway.journeyPoint;
  const premiumStop = gateway.journeyStops.find(stop => stop.placeId === point?.pointId);
  const centerConnection = gateway.connections['center-main'];
  const passengerConnection = gateway.connections['front-passenger-main'];
  const clusterConnection = gateway.connections['cluster-main'];
  const rearConnection = gateway.connections['rear-tablet'];
  const windowConnection = gateway.connections['window-tablet'];
  const clusterPresentation = resolvePresentation({ role: 'cluster', ...(gateway.load ? { load: gateway.load } : {}), activeSafetyWarning: gateway.activeSafetyWarning !== null });
  const centerPresentation = resolvePresentation({ role: 'center', ...(gateway.load ? { load: gateway.load } : {}), activeSafetyWarning: gateway.activeSafetyWarning !== null });
  const rearPresentation = resolvePresentation({ role: 'rear', activeSafetyWarning: gateway.activeSafetyWarning !== null, rearZoneMode: gateway.rearExperience.mode, cloudPresentation: gateway.rearExperience.liveJourney });
  const windowPresentation = resolvePresentation({ role: 'interactive_window', activeSafetyWarning: gateway.activeSafetyWarning !== null, rearZoneMode: gateway.rearExperience.mode, cloudPresentation: gateway.rearExperience.liveJourney });
  const premiumProposal = [...gateway.proposals].reverse().find(item => item.payload?.competitionScenario === 'premium-journey');
  const sendJourneyRequest = (displayId: 'rear-tablet' | 'window-tablet') => !!point && sendCommand(displayId, { type: 'action.propose', payload: { proposal: premiumJourneyProposal(crypto.randomUUID(), point) } });
  const passengerProposal = [...gateway.proposals].reverse().find((item) => (item.payload?.origin === 'passenger_simulator' || item.payload?.discoveryMode === 'route_preview') && item.targetRole === 'center');
  const rearProposal = [...gateway.proposals].reverse().find((item) => item.kind === 'ADD_TRIP_STOP' && item.payload?.origin === 'rear_simulator' && item.targetRole === 'center');
  const voiceActive = voice.status !== 'IDLE' && voice.status !== 'ERROR';
  const setConnectivity = (mode: 'online' | 'degraded' | 'offline') => sendCommand('center-main', { type: 'connectivity.mode.report', payload: { mode, evidence: 'CONTROL_CONSOLE_SIMULATION' } });

  if (entry.mode === 'invalid') return <main className="simulator-shell"><div className="voice-feedback voice-error" role="alert">無效的螢幕入口，尚未建立閘道連線。</div></main>;

  if (controlOnly) return <main className="simulator-shell"><PremiumJourneyDirector state={gateway} sendCommand={sendCommand}/></main>;

  return <main className={`simulator-shell${recording ? " hmi-recording" : ""}`}>
    <header className="simulator-header"><div className="brand-lockup"><span className="aura-mark">{BRAND.productName.slice(0, 1).toUpperCase()}</span><div><strong>{BRAND.productName}</strong><span>{premiumRoute ? "高階旅程 · 五屏座艙" : "多屏模擬器"}</span></div></div><div className="session-status"><span className="simulation-tag">模擬示例</span><PresenceBadge presence={gateway.presence}/>{showsDisplay('center-main') && <button className="listen-button" onClick={() => { if (voiceActive) stopVoice(); else void startVoice(); }} aria-pressed={voiceActive}><Icon name="mic" size={16}/>{voiceActive ? "停止聆聽" : voice.status === 'ERROR' ? "重試語音" : "聆聽"}</button>}</div></header>
    {(voice.error || voice.inputTranscript || voice.outputTranscript) && <div className={`voice-feedback ${voice.error ? 'voice-error' : ''}`} aria-live="polite">
      {voice.error && <span>{voice.error}</span>}
      {voice.inputTranscript && <span><b>你：</b> {voice.inputTranscript}</span>}
      {voice.outputTranscript && <span><b>{BRAND.assistantName}:</b> {voice.outputTranscript}</span>}
    </div>}
    <div className="vehicle-layout">
      {(showsDisplay('cluster-main') || showsDisplay('center-main')) && <div className="driver-zone">{showsDisplay('cluster-main') && <><ScreenHeading title="駕駛資訊" details="儀表" gatewayStatus={clusterConnection.status} presence={gateway.presence}/><ClusterDisplay nextStop={premiumStop?.label} speedKph={gateway.speedKph} warning={gateway.activeSafetyWarning} density={clusterPresentation.informationDensity} motionPaused={clusterMotionPaused}/></>}{showsDisplay('center-main') && <><ScreenHeading title="行程與控制" details="中控" gatewayStatus={centerConnection.status} presence={gateway.presence}/><CenterDisplay journeyPoint={point} proposals={gateway.proposals} journeyStops={gateway.journeyStops} connection={centerConnection} warning={gateway.activeSafetyWarning} presentation={centerPresentation} recommendation={recommendation} tasks={gateway.activeTasks} taskReceipt={taskReceipt} onTaskCommand={sendTaskCommand} onRecommendationRequest={requestJourneyRecommendation} onRecommendationSubmit={(proposal) => { submitJourneyRecommendation(proposal); }} onConsent={(proposalId, decision) => sendCommand('center-main', { type: 'action.consent', payload: { proposalId, decision } })}/></>}</div>}
      {showsDisplay('front-passenger-main') && <div className="passenger-zone"><ScreenHeading title="副駕探索" details="前座副駕" gatewayStatus={passengerConnection.status} presence={gateway.presence}/><PassengerDisplay onSampleProposal={name => sendCommand('front-passenger-main', { type: 'action.propose', payload: { proposal: { proposalId: crypto.randomUUID(), kind: 'ADD_TRIP_STOP', summary: `${name} · 模擬餐廳停靠`, targetRole: 'center', priority: 'secondary', requiresConsent: true, payload: { placeId: 'simulated-aquamarine', label: name, origin: 'passenger_simulator', source: 'simulated', freshness: 'unknown' } } } })} discovery={discovery} searchPlaces={searchPlaces} previewRoute={previewRoute} proposal={passengerProposal} connection={passengerConnection} connectivity={gateway.connectivity} onProposal={(place, route, originLabel) => {
        const pathSummary = `${(route.distanceMeters / 1000).toFixed(1)} km · ${(route.durationSeconds / 60).toFixed(0)} min`;
        const payload = discovery.route;
        if (payload.status !== 'available' || payload.freshness !== 'fresh' || payload.source !== 'api' || !payload.provider || typeof payload.observedAt !== 'number' || !payload.attribution || !payload.attributionUrl) return;
        sendCommand('front-passenger-main', { type: 'action.propose', payload: { proposal: {
          proposalId: crypto.randomUUID(), kind: 'SHOW_INFORMATION',
          summary: `Review route to ${place.displayName} from ${originLabel}: ${pathSummary}`,
          targetRole: 'center', priority: 'secondary', requiresConsent: true,
          payload: {
            discoveryMode: 'route_preview', placeLabel: place.displayName,
            routeDistanceMeters: route.distanceMeters, routeDurationSeconds: route.durationSeconds,
            placeProvider: place.provider, placeObservedAt: place.observedAt,
            placeFreshness: place.freshness, placeAttribution: place.attribution,
            provider: payload.provider, source: payload.source, observedAt: payload.observedAt,
            freshness: payload.freshness, attribution: payload.attribution, attributionUrl: payload.attributionUrl,
          },
        } } });
      }}/></div>}
      {showsDisplay('rear-tablet') && <div className="rear-zone"><ScreenHeading title="後座座艙" details="後座畫面" gatewayStatus={rearConnection.status} presence={gateway.presence}/><RearDisplay journeyPoint={point} journeyStops={gateway.journeyStops} experience={gateway.rearExperience} presentation={rearPresentation} connected={rearConnection.status === "connected"} onMode={mode => sendCommand("rear-tablet", { type: "rear.mode.set", payload: { mode } })} proposal={point ? premiumProposal : rearProposal} onRestStopProposal={() => point ? sendJourneyRequest("rear-tablet") : sendCommand('rear-tablet', { type: 'action.propose', payload: { proposal: { proposalId: crypto.randomUUID(), kind: 'ADD_TRIP_STOP', summary: 'Example rest stop · driver approval required', targetRole: 'center', priority: 'secondary', requiresConsent: true, payload: { placeId: 'simulated-rest-stop', label: 'SIMULATED REST STOP', origin: 'rear_simulator', source: 'simulated', freshness: 'unknown' } } } })}/></div>}
      {showsDisplay('window-tablet') && <div className="window-zone"><ScreenHeading title="環境車窗" details="智慧車窗" gatewayStatus={windowConnection.status} presence={gateway.presence} windowExamples/><WindowDisplay key={point?.revision ?? "normal-window"} connectivity={gateway.connectivity} presence={gateway.presence} journeyPoint={point} journeyStops={gateway.journeyStops} proposal={premiumProposal} presentation={windowPresentation} connected={windowConnection.status === "connected"} onJourneyRequest={() => sendJourneyRequest("window-tablet")}/></div>}
    </div>
    {entry.mode === 'overview' && premiumRoute && <PremiumJourneyDirector state={gateway} sendCommand={sendCommand}/>}
    {entry.mode === 'overview' && <ControlConsole speedKph={gateway.speedKph} load={gateway.load} connectivity={gateway.connectivity} connections={gateway.connections} status={centerConnection.status} lastMessage={centerConnection.lastMessage} onSpeed={(speed) => sendCommand('center-main', { type: 'vehicle.telemetry.report', payload: { vehicle: { speedKph: speed } } })} onLoad={(level) => sendCommand('center-main', { type: 'driver.cognitive_load.report', payload: { level, timestamp: Date.now(), confidence: 1 } })} onConnectivity={setConnectivity} clusterMotionPaused={clusterMotionPaused} onClusterMotionPaused={setClusterMotionPaused}/>}
    {entry.mode === 'overview' && <AssistanceTimingPanel />}
    <footer className="simulator-footer"><span>情境&nbsp; <b>慕尼黑 → 斯圖加特</b></span><span>路線數據為模擬；閘道連線後同步共享車況</span></footer>
  </main>;
}

/** Opt-in local recording demo: the Gateway-connected simulator is never mounted here. */
function App() {
  const demoEntries = new URLSearchParams(window.location.search).getAll('demo');
  return demoEntries.length === 1 && demoEntries[0] === 'dong-hwa'
    ? <DongHwaDemo />
    : new URLSearchParams(window.location.search).get('legacy') === '1' ? <SimulatorApp /> : <CabinSystemApp />;
}

export default App;
