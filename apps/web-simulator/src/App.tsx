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
import { CenterTaskPanel } from './CenterTaskPanel';
import { AssistanceTimingPanel } from './AssistanceTimingPanel';
import { ClusterDisplay } from './ClusterDisplay';
import type { ActiveTask, TaskLifecycleCommand } from '../../../contracts/protocol/src/types';
import './App.css';

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
  return <div className="device-status" aria-label="Simulated status bar: time and temperature are examples; connectivity icons are illustrative"><span>{time}</span><span>21°C</span><span className="status-source">SIMULATED</span><span className="status-spacer" /><span>5G</span><Icon name="signal" size={15} /><span className="battery"><i /></span></div>;
}

function PresenceBadge({ presence }: { presence: PresenceSnapshot | null }) {
  const state = presence?.state ?? null;
  const label = state === 'OFFLINE' ? 'OFFLINE · LOCAL' : state;
  return <span className={`aura-presence-badge ${state ? state.toLowerCase() : 'pending'}`} aria-label={state ? `AURA presence ${state}` : 'AURA presence state pending'} title={state ? `Canonical AURA presence · revision ${presence?.revision}` : 'Waiting for canonical AURA presence from Core Host'}>
    <i aria-hidden="true" />AURA · {label ?? 'STATE PENDING'}
  </span>;
}

function ScreenHeading({ title, details, gatewayStatus, presence, windowExamples = false }: { title: string; details: string; gatewayStatus: string; presence: PresenceSnapshot | null; windowExamples?: boolean }) {
  return <div className="screen-heading"><h1>{title}</h1><span className="screen-heading-meta"><span>{details} · Gateway {gatewayStatus}</span><PresenceBadge presence={presence}/>{windowExamples && <small className="window-example-label">SIMULATED EXAMPLES</small>}</span></div>;
}

function RouteMap() {
  return <svg className="route-map" viewBox="0 0 700 390" role="img" aria-label="Illustrative route map from Munich to Stuttgart">
    <rect width="700" height="390" fill="#3a3a3b" />
    <g fill="none" stroke="#5b5b5c" strokeWidth="1.2" opacity=".8">
      <path d="M-10 60 95 88 175 38 284 72 360 22 470 82 560 50 720 95M-20 130 75 153 143 119 260 151 336 118 445 162 548 130 710 163M-20 220 74 192 150 240 250 201 358 237 450 201 548 244 715 217M-15 302 92 276 175 320 270 284 365 334 465 290 567 326 710 290M42 -20 60 390M144 -20 173 390M250 -20 266 390M364 -20 358 390M487 -20 468 390M604 -20 575 390" />
      <path d="m0 104 700 122M0 258 700 70M112 0 622 390M520 0 188 390" stroke="#727273" strokeWidth="2" />
    </g>
    <path d="M90 286 C153 277 151 205 236 213 S328 150 393 171 S457 203 507 143 S560 123 614 94" fill="none" stroke="#ff5a00" strokeWidth="6" strokeLinecap="round" />
    <circle cx="92" cy="286" r="7" fill="#ff5a00" /><circle cx="614" cy="94" r="8" fill="#ff5a00" stroke="#f2f2f2" strokeWidth="2" />
    <g fill="#f2f2f2" fontFamily="Arial, sans-serif" fontSize="16" fontWeight="700"><text x="63" y="320">MUNICH</text><text x="548" y="72">STUTTGART</text><text x="346" y="143">A–8</text></g>
  </svg>;
}

function proposalStateLabel(proposal: SharedProposal) {
  const routePreview = proposal.payload?.discoveryMode === 'route_preview';
  if (routePreview && proposal.status === 'completed') return 'Reviewed by driver · journey unchanged';
  if (routePreview && proposal.status === 'executing') return 'Driver approved · journey unchanged';
  if (proposal.status === 'deferred') return 'Deferred · waiting for driver load to fall';
  if (proposal.status === 'awaiting_consent' && proposal.lastReasonCode === 'DEFER_RELEASED_DRIVER_LOAD_LOW') return 'Released · driver load is clear, approval required';
  if (proposal.status === 'awaiting_consent') return 'Awaiting driver approval';
  if (proposal.status === 'completed') return proposal.kind === 'SHOW_GUIDANCE' ? 'Simulator guidance shown · no vehicle control' : 'Added to journey';
  if (proposal.status === 'executing' && proposal.kind === 'SHOW_GUIDANCE') return 'Simulator guidance enabled · no vehicle control';
  if (proposal.status === 'declined') return 'Declined by driver · journey unchanged';
  if (proposal.status === 'interrupted') return 'Interrupted · safety event took priority';
  return `${proposal.status}${proposal.lastReasonCode ? ` · ${proposal.lastReasonCode}` : ''}`;
}

function recommendationAbstention(reasonCode: string) {
  const messages: Record<string, string> = {
    WHOLE_JOURNEY_EVIDENCE_SOURCE_UNAVAILABLE: 'No journey recommendation source is configured on this host. No provider data was queried and no recommendation was generated.',
    WHOLE_JOURNEY_EVIDENCE_SOURCE_FAILED: 'The journey evidence source failed. No recommendation was generated.',
    WHOLE_JOURNEY_EVIDENCE_UNAVAILABLE: 'The journey evidence source returned no trip data. No recommendation was generated.',
    WHOLE_JOURNEY_CONTEXT_INCOMPLETE_OR_STALE: 'Fresh origin, destination, and current-route evidence is required. The available trip context was incomplete or stale.',
    NO_CANDIDATE_WITH_FRESH_ROUTE_DETOUR_EVIDENCE: `No candidate had fresh route detour evidence, so ${BRAND.assistantName} could not substantiate a recommendation.`,
    NO_FRESH_DECISION_EVIDENCE: 'No fresh decision evidence was available. No recommendation was generated.',
    NO_FRESH_ROUTE_DETOUR_EVIDENCE: 'A fresh route detour could not be verified. No recommendation was generated.',
    NO_SUBSTANTIATED_RECOMMENDATION: 'The available evidence did not substantiate a journey recommendation.',
  };
  return messages[reasonCode] ?? `No recommendation was generated (${reasonCode}).`;
}

function RecommendationResult({ recommendation, proposals, onSubmit }: { recommendation: JourneyRecommendationState; proposals: SharedProposal[]; onSubmit: (proposal: RecommendationProposal) => void }) {
  if (recommendation.status === 'idle' || recommendation.status === 'pending') return null;
  if (recommendation.status === 'abstained') return <div className="recommendation-message abstained" role="status"><b>No substantiated recommendation</b><span>{recommendationAbstention(recommendation.reasonCode)}</span><small>{recommendation.reasonCode}</small></div>;
  if (recommendation.status === 'error') return <div className="recommendation-message failed" role="alert"><b>Recommendation request failed</b><span>{recommendation.message}</span><small>{recommendation.errorCode}</small></div>;

  const proposal = recommendation.proposal;
  const details = recommendation.recommendation;
  const rationale = details.rationale;
  const evidence = details.evidence as unknown as Array<Record<string, unknown>>;
  const context = details.wholeJourneyContext as unknown as Array<Record<string, unknown>>;
  const sourceSummary = [...evidence, ...context].map((item) => `${String(item.sourceLabel ?? item.source ?? 'Unknown source')} · ${String(item.freshness ?? 'unknown')}`).filter((value, index, all) => all.indexOf(value) === index).join(' / ');
  const submittedProposal = proposals.find((item) => item.proposalId === proposal.proposalId);
  const submittedState = recommendation.status === 'submitted'
    ? submittedProposal ? proposalStateLabel(submittedProposal) : 'Sent to Action Gate · waiting for Center consent'
    : null;
  const formatEvidence = (item: Record<string, unknown>) => {
    const time = typeof item.observedAt === 'number' ? new Date(item.observedAt).toLocaleTimeString() : 'time unavailable';
    return `${String(item.criterion)} — ${String(item.sourceLabel)} (${String(item.source)}, ${String(item.freshness)}, observed ${time})`;
  };

  return <div className={`recommendation-result ${details?.simulated === true ? 'simulated' : ''}`}>
    <div className="recommendation-result-heading"><span>{details?.simulated === true ? 'Simulated evidence' : 'Evidence-backed recommendation'}</span><b>{proposal.summary}</b></div>
    {recommendation.status === 'proposal' && recommendation.submissionError && <p className="recommendation-rejection" role="alert">Action Gate rejected this proposal ({recommendation.submissionError}). The journey was not changed; review the recommendation or request another one.</p>}
    {submittedState
      ? <p className="recommendation-submitted" role="status">{submittedState}. The journey changes only after the driver approves through Center consent.</p>
      : <>
        {rationale[0] && <p className="recommendation-rationale">{rationale[0]}</p>}
        <p className="recommendation-provenance"><b>Evidence</b> {sourceSummary || 'Provenance unavailable'}</p>
        <details className="recommendation-details"><summary>Rationale and evidence details</summary>
          {rationale.length > 1 && <ul>{rationale.slice(1).map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>}
          <div className="recommendation-evidence-group"><b>Recommendation factors</b>{evidence.length ? <ul>{evidence.map((item, index) => <li key={`${String(item.criterion)}-${index}`}>{formatEvidence(item)}</li>)}</ul> : <p>No factor provenance was returned.</p>}</div>
          <div className="recommendation-evidence-group"><b>Whole journey context</b>{context.length ? <ul>{context.map((item, index) => <li key={`${String(item.criterion)}-${index}`}>{formatEvidence(item)}</li>)}</ul> : <p>No whole-journey provenance was returned.</p>}</div>
          {details.alternatives.length > 0 && <div className="recommendation-evidence-group"><b>Other options considered</b><ul>{details.alternatives.map((option) => <li key={option.placeId}><b>{option.label}</b>{option.rationale.length > 0 && <span> — {option.rationale.join(' ')}</span>}{option.evidence.length > 0 && <ul>{option.evidence.map((item, index) => <li key={`${item.criterion}-${index}`}>{formatEvidence(item as unknown as Record<string, unknown>)}</li>)}</ul>}</li>)}</ul></div>}
        </details>
        <button className="recommendation-submit" onClick={() => onSubmit(proposal)}>Send to driver approval</button>
      </>}
  </div>;
}

function CenterDisplay({ proposals, journeyStops, connection, warning, presentation, recommendation, tasks, taskReceipt, onTaskCommand, onConsent, onRecommendationRequest, onRecommendationSubmit }: { proposals: SharedProposal[]; journeyStops: SharedStop[]; connection: { status: string; lastMessage: string }; warning: SharedSafetyWarning | null; presentation: ReturnType<typeof resolvePresentation>; recommendation: JourneyRecommendationState; tasks: ActiveTask[]; taskReceipt: { commandId: string; status: string; reasonCode?: string } | null; onTaskCommand: (command: TaskLifecycleCommand) => boolean; onConsent: (proposalId: string, decision: 'approve' | 'decline') => void; onRecommendationRequest: (text: string) => boolean; onRecommendationSubmit: (proposal: RecommendationProposal) => void }) {
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
  return <section className={`device center-device ${densityClass} ${warning ? 'safety-active' : ''}`} aria-label="Center display preview">
    <aside className="journey-column">
      <h2>Journey <small className="journey-source-label">SIMULATED SCENARIO</small><small className={`display-connection ${connection.status}`}>Gateway {connection.status}</small></h2>
      <div className="journey-timeline">
        <div className="journey-stop done"><time>14:32</time><i/><div><b>Munich</b><span>Origin · departed</span></div></div>
        <div className="journey-stop"><time>15:45</time><i/><div><b>Dinner <small>Reservation</small></b><span>Hotel Ambra · 12 min stop</span></div></div>
        <div className="journey-stop traffic"><time>17:15</time><i/><div><b>A–8 Autobahn</b><span>Traffic delay · +8 min</span></div></div>
        {proposalDetailsVisible && stopProposals.filter((item) => item.status === 'awaiting_consent').map((item) => <div className="journey-stop proposed" key={item.proposalId}><time>Shared</time><i/><div><b>{item.summary}</b><span>{proposalStateLabel(item)}</span></div></div>)}
        {journeyStops.slice(-1).map((stop) => <div className="journey-stop done" key={stop.stopId}><time>Added</time><i/><div><b>{stop.label}</b><span>Confirmed by HMI Gateway</span></div></div>)}
        {journeyStops.length > 1 && <details className="journey-stop-details"><summary>{journeyStops.length - 1} earlier approved stop{journeyStops.length > 2 ? 's' : ''}</summary><ul>{journeyStops.slice(0, -1).map((stop) => <li key={stop.stopId}>{stop.label}</li>)}</ul></details>}
        <div className="journey-stop destination"><time>19:30</time><i/><div><b>Stuttgart</b><span>Destination · 98 km</span></div></div>
      </div>
    </aside>
    <div className="center-main"><StatusBar />
      {warning && <div className="center-safety-warning" role="alert" aria-live="assertive"><span>CRITICAL SAFETY WARNING</span><b>Immediate safety condition detected</b><small>{warning.source === 'simulated' ? 'SIMULATED' : warning.source.toUpperCase()} · {warning.freshness.toUpperCase()} signal · active since {new Date(warning.activatedAt).toLocaleTimeString()}</small></div>}
      <div className="route-summary"><div><Icon name="route"/><b>98 km</b><span>to destination</span></div><div><Icon name="settings"/><b>64 min</b><span>ETA 19:32</span></div><div><Icon name="next"/><b>Currently</b><span>on A–8</span></div><small className="route-source-label">SIMULATED ROUTE VALUES</small></div>
      <div className="map-wrap"><RouteMap /><span className="map-source-label">SIMULATED ROUTE</span><span className="map-label munich-label">MUNICH</span><span className="map-label stuttgart-label">STUTTGART</span><span className="road-label">A–8</span>
        <div className="recommendation-tools">
          {!recommendationUnavailable && <form className="recommendation-form" onSubmit={(event) => { event.preventDefault(); if (/\b(?:mom|mother)\b|媽媽/i.test(recommendationText) && /\b(?:get out|drop[- ]?off)\b|下車|下车/i.test(recommendationText) && /\b(?:charg(?:ing|er))\b|充電|充电/i.test(recommendationText)) { setDropoffClarificationNeeded(true); return; } if (onRecommendationRequest(recommendationText)) { setRecommendationText(''); setDropoffClarificationNeeded(false); } }}>
            <label className="sr-only" htmlFor="journey-recommendation-request">Ask for a whole-journey recommendation</label>
            <input id="journey-recommendation-request" value={recommendationText} maxLength={1000} disabled={recommendationBusy} onChange={(event) => setRecommendationText(event.target.value)} placeholder="Ask about this journey… e.g. a quick dinner stop" />
            <button type="submit" disabled={recommendationBusy || !recommendationText.trim()}>Recommend</button>
            {dropoffClarificationNeeded && <div className="recommendation-message" role="group" aria-label="Passenger drop-off preference"><span>Does proximity to an entrance or passenger drop-off space matter?</span><button type="button" onClick={() => { if (onRecommendationRequest(`${recommendationText} entrance proximity matters`)) { setRecommendationText(''); setDropoffClarificationNeeded(false); } }}>Yes, it matters</button><button type="button" onClick={() => { if (onRecommendationRequest(`${recommendationText} entrance proximity not important`)) { setRecommendationText(''); setDropoffClarificationNeeded(false); } }}>No, no special preference</button></div>}
          </form>}
          {presentation.load === undefined && !presentation.suppressNonSafetyContent && <span className="recommendation-paused" role="status">Waiting for a current driver-load state before showing journey suggestions.</span>}
          {presentation.deferNonCritical && !presentation.suppressNonSafetyContent && <span className="recommendation-paused" role="status">Paused while driver attention is needed.</span>}
          {recommendation.status === 'pending' && proposalDetailsVisible && <span className="recommendation-pending" role="status">Checking current journey evidence…</span>}
          {proposalDetailsVisible && <RecommendationResult recommendation={recommendation} proposals={proposals} onSubmit={onRecommendationSubmit}/>}
        </div>
      </div>
      {proposalDetailsVisible && centerProposals.filter((item) => item.status === 'awaiting_consent' && item.requiresConsent).map((item) => <div className="proposal-panel" key={item.proposalId}><div><span className="proposal-kicker">{item.kind === 'SHOW_GUIDANCE' ? 'SIMULATED parking context · driver choice' : item.payload?.discoveryMode === 'route_preview' ? 'Passenger route preview · provider data · driver choice' : 'Passenger proposal · shared gateway state'}</span><b>{item.summary}</b><span>{proposalStateLabel(item)}</span>{item.kind === 'SHOW_GUIDANCE' && <span>Source: simulator · Freshness: {String((item.payload?.freshness as { state?: string } | undefined)?.state ?? 'unknown')} · no vehicle control</span>}{item.payload?.discoveryMode === 'route_preview' && <span>Route: API · {String(item.payload.provider)} · Freshness: {String(item.payload.freshness ?? 'unknown')} · observed {new Date(Number(item.payload.observedAt)).toLocaleTimeString()} · {String(item.payload.attribution)}</span>}{item.payload?.discoveryMode === 'route_preview' && <span>Place: API · {String(item.payload.placeProvider)} · Freshness: {String(item.payload.placeFreshness ?? 'unknown')} · observed {new Date(Number(item.payload.placeObservedAt)).toLocaleTimeString()} · {String(item.payload.placeAttribution)} · consent reviews only; journey unchanged</span>}</div><button className="quiet-action" onClick={() => onConsent(item.proposalId, 'decline')}><Icon name="close"/> Decline</button><button className="accept-action" onClick={() => onConsent(item.proposalId, 'approve')}><Icon name="check"/> Approve</button></div>)}
      {proposalDetailsVisible && routePreviewProposals.filter((item) => item.status === 'completed' || item.status === 'declined').map((item) => <div className="proposal-panel guidance-result" key={item.proposalId}><div><span className="proposal-kicker">Passenger route preview · API · temporary use</span><b>{proposalStateLabel(item)}</b><span>{item.summary}</span><small>Route freshness: {String(item.payload?.freshness ?? 'unknown')} · observed {new Date(Number(item.payload?.observedAt)).toLocaleTimeString()} · {String(item.payload?.attribution ?? 'Attribution unavailable')}</small><small>Place freshness: {String(item.payload?.placeFreshness ?? 'unknown')} · observed {new Date(Number(item.payload?.placeObservedAt)).toLocaleTimeString()} · {String(item.payload?.placeAttribution ?? 'Attribution unavailable')}</small></div></div>)}
      {proposalDetailsVisible && guidanceProposals.filter((item) => item.status === 'executing' || item.status === 'completed' || item.status === 'declined').map((item) => <div className="proposal-panel guidance-result" key={item.proposalId}><div><span className="proposal-kicker">SIMULATED parking assistance</span><b>{proposalStateLabel(item)}</b><span>Source: simulator · no vehicle control</span></div></div>)}
      {presentation.centerHighLoadMarkerEligible && hasDeferredProposal && <span className="deferred-proposal-indicator" aria-label="Journey recommendation details are waiting until driver load is lower" title="Journey recommendation details are waiting until driver load is lower" />}
      {connection.status !== 'connected' && <div className="gateway-display-error">Center gateway {connection.status}: {connection.lastMessage}</div>}
      <CenterTaskPanel tasks={tasks} connected={connection.status === 'connected'} available={proposalDetailsVisible && !warning} receipt={taskReceipt} send={onTaskCommand}/>
      <div className="center-actions"><button><b>Navigate</b><span>Route options</span></button><button><b>Radio</b><span>FM 98.4</span></button><button><b>Climate</b><span>22°C Auto</span></button><button><b>Phone</b><span>Connected</span></button></div>
    </div>
  </section>;
}



function PassengerDisplay({ onProposal: _onProposal, proposal: _proposal, connection: _connection, connectivity: _connectivity, discovery: _discovery, searchPlaces: _searchPlaces, previewRoute: _previewRoute }: {
  onProposal: (place: TransientPlace, route: DiscoveryState['route']['routes'][number], originLabel: string) => void;
  proposal?: SharedProposal;
  connection: { status: string; lastMessage: string };
  connectivity: GatewayState['connectivity'];
  discovery: DiscoveryState;
  searchPlaces: (slot: 'origin' | 'destination', query: string) => boolean;
  previewRoute: (origin: TransientPlace, destination: TransientPlace) => boolean;
}) {
  const [filter, setFilter] = useState('All');
  const filters = ['All', 'Fine dining', 'Cafés', 'Vegan'];

  const samplePlaces = [
    { name: 'THE FLAME', style: 'Modern · ★ 4.9 · +4 min', image: flamePhoto },
    { name: 'AURORA', style: 'Café · ★ 4.7 · +3 min', image: auroraPhoto },
    { name: 'TERRA', style: 'Vegan · ★ 4.6 · +6 min', image: terraPhoto },
  ];

  return <section className="device passenger-device" aria-label="Front passenger display preview">
    <aside className="discovery-sidebar">
      <h2>DINING<br/>GUIDE</h2>

      <div className="sidebar-section">
        <h3>LOCAL FLAVOR</h3>
        <p>Explore places along your journey.</p>
      </div>

      <div className="sidebar-section">
        <h3>CURATED SPOTS</h3>
        <p>Compare cuisine and simulated journey impact.</p>
      </div>

      <div className="side-rule" />

      <div className="sidebar-section">
        <h3>FILTER &amp; SEARCH</h3>
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
        <span className="status-display">AURA · IDLE EXAMPLE PLACES</span>
      </div>

      <div className="featured-place">
        <div className="feature-art">
          <img src={aquamarinePhoto} alt="Aquamarine restaurant"/>
        </div>
        <div className="feature-caption-overlay">
          <div className="feature-text">
            <b>AQUAMARINE</b>
            <small>Mediterranean · ★ 4.8 · 繞路 +5 min</small>
          </div>
          <button className="propose-button" onClick={() => {}}>提議停靠</button>
        </div>
      </div>

      <div className="place-list">
        {samplePlaces.map((place) => (
          <article key={place.name} className={`place-card`}>
            <div className="place-info">
              <b>{place.name}</b>
              <small>{place.style}</small>
            </div>
            <img src={place.image} alt={place.name} className="place-image" />
          </article>
        ))}
      </div>

      <div className="passenger-footer">
        示例地點；需駕駛同意，才會加入模擬行程。
      </div>
    </div>
  </section>;
}

function RearDisplay({ onRestStopProposal }: { onRestStopProposal: () => void; proposal?: SharedProposal }) {
  const [temperature, setTemperature] = useState(21.5);
  return <section className="device rear-device" aria-label="Rear display preview">
    <div className="rear-tile media-tile">
      <h3>MEDIA PLAYER</h3>
      <p>MUSIC &amp; AUDIO</p>
      <span className="track-name">The Midnight Echo</span>
      <div className="media-controls">
        <button aria-label="Shuffle"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg></button>
        <button aria-label="Previous track"><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg></button>
        <button aria-label="Play" className="play-button"><svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
        <button aria-label="Next track"><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg></button>
        <button aria-label="Repeat"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg></button>
        <button aria-label="Volume"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg></button>
      </div>
      <div className="track-progress"><i className="playing"/></div>
      <div className="media-footer">0:00 / 3:00 • SIMULATED • NO AUDIO</div>
    </div>
    <div className="rear-tile climate-tile">
      <h3>CLIMATE CONTROL</h3>
      <span className="tile-label">REAR ZONE TEMP</span>
      <div className="temperature">
        <button aria-label="Lower temperature" onClick={() => setTemperature(Math.max(16, temperature - 0.5))}><Icon name="back" size={24}/></button>
        <strong>{temperature.toFixed(1)}°C</strong>
        <button aria-label="Raise temperature" onClick={() => setTemperature(Math.min(28, temperature + 0.5))}><Icon name="next" size={24}/></button>
      </div>
      <div className="climate-footer">
        <button className="outline-button">FAN: 3</button>
        <button className="outline-button">SYNC</button>
        <span className="simulated-text">SIMULATED</span>
      </div>
    </div>
    <div className="rear-tile communication-tile">
      <h3>REAR SEAT COMM.</h3>
      <div className="comm-row">
        <div>
          <b>DRIVER CALL</b>
          <span>IDLE</span>
        </div>
        <button className="orange-button call-button"><Icon name="phone" size={18}/>CALL</button>
      </div>
      <hr className="divider" />
      <div className="comm-row">
        <div>
          <b>JOURNEY REQUEST</b>
          <span>DRIVER APPROVAL REQUIRED</span>
        </div>
        <button className="outline-button rest-stop-button" onClick={onRestStopProposal}><Icon name="pause" size={18}/>REST STOP</button>
      </div>
    </div>
    <div className="rear-tile settings-tile">
      <h3>SYSTEM SETTINGS</h3>
      <div className="settings-options">
        <button className="setting-row"><Icon name="display" size={24}/><span>DISPLAY &amp; AUDIO</span></button>
        <button className="setting-row"><Icon name="settings" size={24}/><span>CONFIGURATION</span></button>
      </div>
    </div>
  </section>;
}

function WindowDisplay({ connectivity, presence }: { connectivity: GatewayState['connectivity']; presence: PresenceSnapshot | null }) {
  const networkLabel = connectivity.mode === 'offline' ? 'OFFLINE · LOCAL' : connectivity.mode === 'degraded' ? 'DEGRADED · SIMULATED' : 'ONLINE · SIMULATED';
  return <section className="device window-device" aria-label="Interactive window preview">
    <div className="window-scene">
      <div className="window-photo"><img src={windowReference} alt="Illustrative outside view; all overlaid values are simulated examples"/></div>
      <div className="window-status" aria-label="Simulated ambient status">
        <span className="window-time"><b>19:42</b><small>TIME<span className="window-label-detail"> · SIMULATED</span></small></span>
        <span><Icon name="rain" size={22}/><b>12°C · RAIN</b><small>WEATHER<span className="window-label-detail"> EXAMPLE</span></small></span>
        <span><Icon name="arrow-up" size={22}/><b>14 KM</b><small><span className="window-route-prefix">ALPINE ROAD · </span>ROUTE EXAMPLE</small></span>
        <span className="window-energy"><i className="energy-battery" aria-hidden="true"><i /></i><b>82% · 412 KM</b><small>{networkLabel.split(" · ")[0]}<span className="window-label-detail"> · {networkLabel.split(" · ")[1]}</span></small></span>
      </div>
      <span className="window-presence">AURA · {presence?.state ?? 'STATE PENDING'}</span>
    </div>
  </section>;
}

function ControlConsole({ speedKph, load, connectivity, connections, status, lastMessage, onSpeed, onLoad, onConnectivity, clusterMotionPaused, onClusterMotionPaused }: { speedKph: number; load: 'low' | 'normal' | 'high' | 'critical' | null; connectivity: GatewayState['connectivity']; connections: GatewayState['connections']; status: string; lastMessage: string; onSpeed: (speed: number) => void; onLoad: (level: 'low' | 'normal' | 'high' | 'critical') => void; onConnectivity: (mode: 'online' | 'degraded' | 'offline') => void; clusterMotionPaused: boolean; onClusterMotionPaused: (paused: boolean) => void }) {
  const [speedInput, setSpeedInput] = useState(String(speedKph));
  useEffect(() => setSpeedInput(String(speedKph)), [speedKph]);
  return <section className="control-console" aria-labelledby="console-title">
    <div className="console-heading"><div><span className="console-kicker">Developer tools · outside all five display previews</span><h2 id="console-title">HMI Gateway Control Console</h2></div><span className={`gateway-state ${status}`}>{status}</span></div>
    <p className="console-description">Protocol v1 · center-main / main-computer · shared vehicle speed <b>{Math.round(speedKph)} km/h</b> · driver load <b>{load ?? 'not reported'}</b> · connectivity <b>{connectivity.mode} ({connectivity.source})</b></p>
    <p className="console-description logical-socket-note">Five logical registry sockets share this one browser simulation; this does not demonstrate five physical displays or independent hardware clients.</p>
    <div className="display-connections" aria-label="Logical display gateway connection states">{DISPLAY_REGISTRATIONS.map(({ displayId }) => {
      const connection = connections[displayId];
      return <div className="display-connection-card" key={displayId}><div><b>{displayId}</b><small>{connection.deviceId} · {connection.role}</small></div><span className={`gateway-state ${connection.status}`}>{connection.status}</span><small className="connection-message">{connection.lastMessage}</small></div>;
    })}</div>
    <div className="console-controls"><label>Vehicle speed <span><input type="number" min="0" max="300" value={speedInput} onChange={(event) => setSpeedInput(event.target.value)} /> km/h</span></label><button onClick={() => { const speed = Number(speedInput); if (Number.isFinite(speed) && speed >= 0 && speed <= 300) onSpeed(speed); }}>Send vehicle.telemetry.report</button><button aria-pressed={clusterMotionPaused} onClick={() => onClusterMotionPaused(!clusterMotionPaused)}>{clusterMotionPaused ? 'Resume' : 'Pause'} Cluster motion</button><label>Simulated driver cognitive load</label><button onClick={() => onLoad('low')}>Report low load</button><button onClick={() => onLoad('normal')}>Report normal load</button><button onClick={() => onLoad('high')}>Report high load</button><button onClick={() => onLoad('critical')}>Report critical load</button><label>Simulated network condition</label><button aria-pressed={connectivity.mode === 'online' && connectivity.source === 'simulated'} onClick={() => onConnectivity('online')}>Set network online</button><button aria-pressed={connectivity.mode === 'degraded' && connectivity.source === 'simulated'} onClick={() => onConnectivity('degraded')}>Set network degraded</button><button aria-pressed={connectivity.mode === 'offline' && connectivity.source === 'simulated'} onClick={() => onConnectivity('offline')}>Set network offline</button></div>
    <div className="console-feedback"><span>Connection: {status}{status === 'connected' ? ' · registered · welcome received' : ''}</span><span>Last gateway message: {lastMessage}</span></div>
  </section>;
}

function App() {
  const [clusterMotionPaused, setClusterMotionPaused] = useState(false);
  const { state: gateway, sendCommand, sendTaskCommand, taskReceipt, voice, startVoice, stopVoice, discovery, searchPlaces, previewRoute, recommendation, requestJourneyRecommendation, submitJourneyRecommendation } = useAuraCommand();
  const centerConnection = gateway.connections['center-main'];
  const passengerConnection = gateway.connections['front-passenger-main'];
  const clusterConnection = gateway.connections['cluster-main'];
  const rearConnection = gateway.connections['rear-tablet'];
  const windowConnection = gateway.connections['window-tablet'];
  const clusterPresentation = resolvePresentation({ role: 'cluster', ...(gateway.load ? { load: gateway.load } : {}), activeSafetyWarning: gateway.activeSafetyWarning !== null });
  const centerPresentation = resolvePresentation({ role: 'center', ...(gateway.load ? { load: gateway.load } : {}), activeSafetyWarning: gateway.activeSafetyWarning !== null });
  const passengerProposal = [...gateway.proposals].reverse().find((item) => (item.kind === 'ADD_TRIP_STOP' || item.payload?.discoveryMode === 'route_preview') && item.targetRole === 'center');
  const rearProposal = [...gateway.proposals].reverse().find((item) => item.kind === 'ADD_TRIP_STOP' && item.payload?.origin === 'rear_simulator' && item.targetRole === 'center');
  const voiceActive = voice.status !== 'IDLE' && voice.status !== 'ERROR';
  const setConnectivity = (mode: 'online' | 'degraded' | 'offline') => sendCommand('center-main', { type: 'connectivity.mode.report', payload: { mode, evidence: 'CONTROL_CONSOLE_SIMULATION' } });

  return <main className="simulator-shell">
    <header className="simulator-header"><div className="brand-lockup"><span className="aura-mark">{BRAND.productName.slice(0, 1).toUpperCase()}</span><div><strong>{BRAND.productName}</strong><span>Multi-display simulator</span></div></div><div className="session-status"><span className="simulation-tag">Illustrative simulation</span><PresenceBadge presence={gateway.presence}/><button className="listen-button" onClick={() => { if (voiceActive) stopVoice(); else void startVoice(); }} aria-pressed={voiceActive}><Icon name="mic" size={16}/>{voiceActive ? 'Stop listening' : voice.status === 'ERROR' ? 'Try voice again' : 'Listen'}</button></div></header>
    {(voice.error || voice.inputTranscript || voice.outputTranscript) && <div className={`voice-feedback ${voice.error ? 'voice-error' : ''}`} aria-live="polite">
      {voice.error && <span>{voice.error}</span>}
      {voice.inputTranscript && <span><b>You:</b> {voice.inputTranscript}</span>}
      {voice.outputTranscript && <span><b>{BRAND.assistantName}:</b> {voice.outputTranscript}</span>}
    </div>}
    <div className="vehicle-layout">
      <div className="driver-zone"><ScreenHeading title="Driver display" details="Cluster" gatewayStatus={clusterConnection.status} presence={gateway.presence}/><ClusterDisplay speedKph={gateway.speedKph} warning={gateway.activeSafetyWarning} density={clusterPresentation.informationDensity} motionPaused={clusterMotionPaused}/><ScreenHeading title="Journey & control" details="Center" gatewayStatus={centerConnection.status} presence={gateway.presence}/><CenterDisplay proposals={gateway.proposals} journeyStops={gateway.journeyStops} connection={centerConnection} warning={gateway.activeSafetyWarning} presentation={centerPresentation} recommendation={recommendation} tasks={gateway.activeTasks} taskReceipt={taskReceipt} onTaskCommand={sendTaskCommand} onRecommendationRequest={requestJourneyRecommendation} onRecommendationSubmit={(proposal) => { submitJourneyRecommendation(proposal); }} onConsent={(proposalId, decision) => sendCommand('center-main', { type: 'action.consent', payload: { proposalId, decision } })}/></div>
      <div className="passenger-zone"><ScreenHeading title="Passenger discovery" details="Front passenger" gatewayStatus={passengerConnection.status} presence={gateway.presence}/><PassengerDisplay discovery={discovery} searchPlaces={searchPlaces} previewRoute={previewRoute} proposal={passengerProposal} connection={passengerConnection} connectivity={gateway.connectivity} onProposal={(place, route, originLabel) => {
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
      }}/></div>
      <div className="rear-zone"><ScreenHeading title="Rear cabin" details="Rear display" gatewayStatus={rearConnection.status} presence={gateway.presence}/><RearDisplay proposal={rearProposal} onRestStopProposal={() => sendCommand('rear-tablet', { type: 'action.propose', payload: { proposal: { proposalId: crypto.randomUUID(), kind: 'ADD_TRIP_STOP', summary: 'Example rest stop · driver approval required', targetRole: 'center', priority: 'secondary', requiresConsent: true, payload: { placeId: 'simulated-rest-stop', label: 'SIMULATED REST STOP', origin: 'rear_simulator', source: 'simulated', freshness: 'unknown' } } } })}/></div>
      <div className="window-zone"><ScreenHeading title="Ambient window" details="Window" gatewayStatus={windowConnection.status} presence={gateway.presence} windowExamples/><WindowDisplay connectivity={gateway.connectivity} presence={gateway.presence}/></div>
    </div>
    <ControlConsole speedKph={gateway.speedKph} load={gateway.load} connectivity={gateway.connectivity} connections={gateway.connections} status={centerConnection.status} lastMessage={centerConnection.lastMessage} onSpeed={(speed) => sendCommand('center-main', { type: 'vehicle.telemetry.report', payload: { vehicle: { speedKph: speed } } })} onLoad={(level) => sendCommand('center-main', { type: 'driver.cognitive_load.report', payload: { level, timestamp: Date.now(), confidence: 1 } })} onConnectivity={setConnectivity} clusterMotionPaused={clusterMotionPaused} onClusterMotionPaused={setClusterMotionPaused}/>
    <AssistanceTimingPanel />
    <footer className="simulator-footer"><span>Scenario&nbsp; <b>Munich → Stuttgart</b></span><span>Illustrative route values · shared vehicle telemetry updates when the gateway is connected</span></footer>
  </main>;
}

export default App;
