import { useEffect, useState, type ReactNode } from 'react';
import passengerReference from '../../../AURA_UI_UX_Handoff/images/03_passenger_display_final.jpg';
import windowReference from '../../../AURA_UI_UX_Handoff/images/05_interactive_window_final.jpg';
import { resolveBrand } from '../../../packages/core-domain/src/brand';
import { resolvePresentation } from '../../../packages/core-domain/src/presentation-resolver';
import type { PresenceSnapshot } from '../../../contracts/protocol/src/types';
import { DISPLAY_REGISTRATIONS, useAuraCommand, type DiscoveryState, type GatewayState, type JourneyRecommendationState, type RecommendationProposal, type SharedProposal, type SharedSafetyWarning, type SharedStop, type TransientPlace } from './core/useAuraCommand';
import './App.css';

const BRAND = resolveBrand({
  productName: import.meta.env.VITE_AURA_PRODUCT_NAME,
  assistantName: import.meta.env.VITE_AURA_ASSISTANT_NAME,
  wakeWord: import.meta.env.VITE_AURA_WAKE_WORD,
});

type IconName = 'play' | 'pause' | 'back' | 'next' | 'phone' | 'seat' | 'display' | 'settings' | 'pin' | 'route' | 'sun' | 'cloud' | 'mic' | 'check' | 'close' | 'signal';

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    play: <path d="m7 4 13 8-13 8z" fill="currentColor" stroke="none" />,
    pause: <><path d="M8 5v14" /><path d="M16 5v14" /></>,
    back: <><path d="m15 5-7 7 7 7" /><path d="M9 12h11" /></>,
    next: <><path d="m9 5 7 7-7 7" /><path d="M4 12h11" /></>,
    phone: <path d="M7 3h3l2 5-2 2a15 15 0 0 0 4 4l2-2 5 2v3c0 1-1 2-2 2C10 18 5 13 4 5c0-1 1-2 3-2Z" />,
    seat: <><path d="M7 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" /><path d="M6 9v4l-2 5h11l-2-5-1-4H6Z" /><path d="M14 11h4l2 7h-6" /></>,
    display: <><rect x="3" y="4" width="18" height="13" rx="1" /><path d="M8 21h8M12 17v4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.2 1.8-1.8 1.8-1.8-1.2-.1-.1-1.7.7-.4 2.1h-2.6l-.4-2.1-1.7-.7-.1.1-1.8 1.2-1.8-1.8 1.2-1.8.1-.1-.7-1.7L5 13v-2.6l2.1-.4.7-1.7-.1-.1-1.2-1.8 1.8-1.8 1.8 1.2.1.1 1.7-.7.4-2.1h2.6l.4 2.1 1.7.7.1-.1 1.8-1.2 1.8 1.8-1.2 1.8-.1.1.7 1.7 2.1.4V13l-2.1.4-.7 1.6Z" transform="translate(-1 -1) scale(.95)" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    route: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h3a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    cloud: <path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7Z" />,
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

function Cluster({ speedKph, warning, presentation }: { speedKph: number; warning: SharedSafetyWarning | null; presentation: ReturnType<typeof resolvePresentation> }) {
  const densityClass = presentation.informationDensity === 'reduced' ? 'load-reduced' : presentation.informationDensity === 'safety_only' ? 'load-critical' : '';
  return <section className={`device cluster-device ${densityClass} ${warning ? 'safety-active' : ''}`} aria-label="Cluster display preview">
    <div className="cluster-head"><span>14:38&nbsp;&nbsp; 21°C</span><span className="drive-mode">DRIVE</span><span className="indicator-lights"><i>◉</i><b>●</b></span></div>
    {warning && <div className="cluster-safety-warning" role="alert" aria-live="assertive"><b>CRITICAL SAFETY WARNING</b><span>Immediate safety condition · {warning.source === 'simulated' ? 'SIMULATED' : warning.source.toUpperCase()}</span></div>}
    <div className="cluster-main">
      <aside className="trip-readout"><p><span>Trip</span><b>24.8 km</b></p><p><span>Avg</span><b>16.1 kWh/100km</b></p><p><span>Time</span><b>0:42h</b></p><p><span>Range</span><b>412 km</b></p></aside>
      <div className="rpm-gauge"><div className="gauge-arc"/><div className="gauge-ticks">1&nbsp;&nbsp;&nbsp; 2&nbsp;&nbsp;&nbsp; 3&nbsp;&nbsp;&nbsp; 4&nbsp;&nbsp;&nbsp; 5&nbsp;&nbsp;&nbsp; 6&nbsp;&nbsp;&nbsp; 7</div><span className="gauge-label">RPM</span><strong>4200</strong></div>
      <div className="speed-readout"><strong>{Math.round(speedKph)}</strong><span>km/h</span><div className="road-markers"><i/><b/><em/></div><div className="car-silhouette"><i/><b/><em/></div></div>
      <div className="power-gauge"><div className="power-arc"/><span className="gauge-label">Power</span><strong>68%</strong></div>
      <aside className="vehicle-readout"><div className="car-top"><i/><b/><em/></div><span>Tire Pressure</span><b>2.4 / 2.5 bar</b><span>Temp: 19°C</span></aside>
    </div>
  </section>;
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

function CenterDisplay({ proposals, journeyStops, connection, warning, presentation, recommendation, onConsent, onRecommendationRequest, onRecommendationSubmit }: { proposals: SharedProposal[]; journeyStops: SharedStop[]; connection: { status: string; lastMessage: string }; warning: SharedSafetyWarning | null; presentation: ReturnType<typeof resolvePresentation>; recommendation: JourneyRecommendationState; onConsent: (proposalId: string, decision: 'approve' | 'decline') => void; onRecommendationRequest: (text: string) => boolean; onRecommendationSubmit: (proposal: RecommendationProposal) => void }) {
  const stopProposals = proposals.filter((item) => item.kind === 'ADD_TRIP_STOP' && item.targetRole === 'center');
  const guidanceProposals = proposals.filter((item) => item.kind === 'SHOW_GUIDANCE' && item.targetRole === 'center');
  const routePreviewProposals = proposals.filter((item) => item.kind === 'SHOW_INFORMATION' && item.targetRole === 'center' && item.payload?.discoveryMode === 'route_preview');
  const centerProposals = [...stopProposals, ...guidanceProposals, ...routePreviewProposals];
  const hasDeferredProposal = centerProposals.some((item) => item.status === 'deferred');
  const proposalDetailsVisible = presentation.load !== undefined && !presentation.deferNonCritical && !presentation.suppressNonSafetyContent;
  const [recommendationText, setRecommendationText] = useState('');
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
        {journeyStops.map((stop) => <div className="journey-stop done" key={stop.stopId}><time>Added</time><i/><div><b>{stop.label}</b><span>Confirmed by HMI Gateway</span></div></div>)}
        <div className="journey-stop destination"><time>19:30</time><i/><div><b>Stuttgart</b><span>Destination · 98 km</span></div></div>
      </div>
    </aside>
    <div className="center-main"><StatusBar />
      {warning && <div className="center-safety-warning" role="alert" aria-live="assertive"><span>CRITICAL SAFETY WARNING</span><b>Immediate safety condition detected</b><small>{warning.source === 'simulated' ? 'SIMULATED' : warning.source.toUpperCase()} · {warning.freshness.toUpperCase()} signal · active since {new Date(warning.activatedAt).toLocaleTimeString()}</small></div>}
      <div className="route-summary"><div><Icon name="route"/><b>98 km</b><span>to destination</span></div><div><Icon name="settings"/><b>64 min</b><span>ETA 19:32</span></div><div><Icon name="next"/><b>Currently</b><span>on A–8</span></div><small className="route-source-label">SIMULATED ROUTE VALUES</small></div>
      <div className="map-wrap"><RouteMap /><span className="map-source-label">SIMULATED ROUTE</span><span className="map-label munich-label">MUNICH</span><span className="map-label stuttgart-label">STUTTGART</span><span className="road-label">A–8</span>
        <div className="recommendation-tools">
          {!recommendationUnavailable && <form className="recommendation-form" onSubmit={(event) => { event.preventDefault(); if (onRecommendationRequest(recommendationText)) setRecommendationText(''); }}>
            <label className="sr-only" htmlFor="journey-recommendation-request">Ask for a whole-journey recommendation</label>
            <input id="journey-recommendation-request" value={recommendationText} maxLength={1000} disabled={recommendationBusy} onChange={(event) => setRecommendationText(event.target.value)} placeholder="Ask about this journey… e.g. a quick dinner stop" />
            <button type="submit" disabled={recommendationBusy || !recommendationText.trim()}>Recommend</button>
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
      <div className="center-actions"><button><b>Navigate</b><span>Route options</span></button><button><b>Radio</b><span>FM 98.4</span></button><button><b>Climate</b><span>22°C Auto</span></button><button><b>Phone</b><span>Connected</span></button></div>
    </div>
  </section>;
}

const samplePlaces = [
  { name: 'The Flame', style: 'Modern grill', rating: '4.9', distance: '0.4 mi' },
  { name: 'Aurora', style: 'Italian', rating: '4.7', distance: '1.2 mi' },
  { name: 'Terra', style: 'Plant-forward', rating: '4.6', distance: '1.8 mi' },
];

function PassengerDisplay({ onProposal, proposal, connection, discovery, searchPlaces, previewRoute }: {
  onProposal: (place: TransientPlace, route: DiscoveryState['route']['routes'][number], originLabel: string) => void;
  proposal?: SharedProposal;
  connection: { status: string; lastMessage: string };
  discovery: DiscoveryState;
  searchPlaces: (slot: 'origin' | 'destination', query: string) => boolean;
  previewRoute: (origin: TransientPlace, destination: TransientPlace) => boolean;
}) {
  const [originQuery, setOriginQuery] = useState('');
  const [placeQuery, setPlaceQuery] = useState('');
  const [origin, setOrigin] = useState<TransientPlace | null>(null);
  const [destination, setDestination] = useState<TransientPlace | null>(null);
  const [previewSelection, setPreviewSelection] = useState('');
  const [filter, setFilter] = useState('All');
  const [searchedOriginQuery, setSearchedOriginQuery] = useState('');
  const [searchedDestinationQuery, setSearchedDestinationQuery] = useState('');
  const filters = ['All', 'Fine dining', 'Bistros', 'Cafés'];
  const filterQuery = filter === 'All' ? '' : filter === 'Cafés' ? 'cafe' : filter === 'Bistros' ? 'bistro' : 'fine dining restaurant';
  const destinationQuery = [placeQuery.trim(), filterQuery].filter(Boolean).join(' ');
  const originSearchCurrent = Boolean(originQuery.trim()) && searchedOriginQuery === originQuery.trim();
  const destinationSearchCurrent = Boolean(destinationQuery) && searchedDestinationQuery === destinationQuery;
  const originResults = originSearchCurrent ? discovery.origin.results : [];
  const destinationResults = destinationSearchCurrent ? discovery.destination.results : [];
  const currentSelection = origin && destination ? `${origin.placeId}:${destination.placeId}` : '';
  const routeMatchesSelection = Boolean(currentSelection && previewSelection === currentSelection);
  const selectedRoute = routeMatchesSelection ? discovery.route.routes[0] : undefined;
  const illustrativeRows = samplePlaces.map((place, index) => <article key={place.name} className={`place-row place-art-${index + 1}`}><span className="dish-art" aria-hidden="true"><i/><b/><em/></span><span className="place-copy"><b>{place.name}</b><small>{place.style}</small><span>{place.rating} ★ <i>·</i> {place.distance} · SIMULATED</span></span></article>);
  const canPropose = routeMatchesSelection && discovery.route.status === 'available' && discovery.route.freshness === 'fresh' && Boolean(selectedRoute);
  const proposalPending = Boolean(proposal && !['declined', 'rejected', 'completed'].includes(proposal.status));
  const searchStatus = (slot: 'origin' | 'destination') => {
    const result = discovery[slot];
    if (result.status === 'loading') return 'Searching Mapbox…';
    if (result.status === 'unavailable') return 'Place search unavailable. Check provider configuration.';
    if (result.status === 'error') return `Search failed: ${result.errorCode ?? 'provider error'}`;
    if (result.status === 'available' && result.results.length === 0) return 'No places returned by provider.';
    return '';
  };
  const formatObserved = (value: number) => new Date(value).toLocaleTimeString();
  const routeButtonLabel = discovery.route.status === 'loading' && routeMatchesSelection ? 'Calculating…'
    : canPropose ? 'Propose route review' : 'Preview route';
  const handleRouteAction = () => {
    if (canPropose && destination && selectedRoute) {
      onProposal(destination, selectedRoute, origin?.displayName ?? '');
      return;
    }
    if (origin?.location && destination?.location) {
      setPreviewSelection(`${origin.placeId}:${destination.placeId}`);
      previewRoute(origin, destination);
    }
  };

  useEffect(() => {
    if (connection.status === 'error' || connection.status === 'disconnected') {
      setOrigin(null);
      setDestination(null);
      setPreviewSelection('');
      setSearchedOriginQuery('');
      setSearchedDestinationQuery('');
    }
  }, [connection.status]);

  return <section className="device passenger-device" aria-label="Front passenger display preview">
    <aside className="discovery-sidebar"><h2>Dining<br/>Guide</h2><h3>Local flavor</h3><p>Search a route origin and dining stop. Vehicle position is not inferred.</p>
      <label className="discovery-field">Route origin<input value={originQuery} maxLength={256} onChange={(event) => { setOriginQuery(event.target.value); setOrigin(null); setSearchedOriginQuery(''); setPreviewSelection(''); }} placeholder="Search a starting place" /></label>
      <button className="discovery-search-button" onClick={() => { setOrigin(null); setSearchedOriginQuery(originQuery.trim()); setPreviewSelection(''); searchPlaces('origin', originQuery); }} disabled={connection.status !== 'connected' || !originQuery.trim() || discovery.origin.status === 'loading'}>Search origin</button>
      {originResults.length > 0 && <label className="origin-choice">Choose route origin<select aria-label="Choose route origin" value={origin?.placeId ?? ''} onChange={(event) => { setOrigin(originResults.find((place) => place.placeId === event.target.value) ?? null); setPreviewSelection(''); }}><option value="">Select a search result</option>{originResults.map((place) => <option key={place.placeId} value={place.placeId}>{place.displayName} · API · {place.freshness.toUpperCase()}</option>)}</select></label>}
      {origin && <small className="origin-provenance">{origin.source.toUpperCase()} · {origin.freshness.toUpperCase()} · {formatObserved(origin.observedAt)} · {origin.attribution}</small>}
      {originSearchCurrent && searchStatus('origin') && <p className="discovery-message" role="status">{searchStatus('origin')}</p>}
      <div className="side-rule"/><h3>Filter &amp; search</h3>
      <label className="discovery-field">Dining place<input value={placeQuery} maxLength={232} onChange={(event) => { setPlaceQuery(event.target.value); setDestination(null); setSearchedDestinationQuery(''); setPreviewSelection(''); }} placeholder="Restaurant or destination" /></label>
      <div className="filters" aria-label="Dining search refinement">{filters.map((item) => <button type="button" key={item} className={filter === item ? 'filter selected' : 'filter'} aria-pressed={filter === item} onClick={() => { setFilter(item); if (item !== 'All') setPlaceQuery((current) => current.slice(0, 232)); setDestination(null); setSearchedDestinationQuery(''); setPreviewSelection(''); }}>{item}</button>)}</div>
      <button className="discovery-search-button" onClick={() => { setDestination(null); setSearchedDestinationQuery(destinationQuery); setPreviewSelection(''); searchPlaces('destination', destinationQuery); }} disabled={connection.status !== 'connected' || !placeQuery.trim() || discovery.destination.status === 'loading'}>Search places</button>
    </aside>
    <div className="discovery-main"><div className="discovery-top"><span>Along your route · Dining · Gateway {connection.status}</span><StatusBar time="16:03"/></div>
      <div className="featured-place"><div className="feature-art"><img src={passengerReference} alt="Illustrative restaurant preview"/><span className="illustrative-photo-tag">Illustrative photo</span><div className="feature-caption"><span>{destination ? `${destination.provider} · API result` : 'Illustrative example'}</span><b>{destination?.displayName ?? 'Aquamarine'}</b><small>{destination?.formattedAddress ?? 'Mediterranean · example content'}</small></div></div>
        <div className="feature-details"><div><span>{selectedRoute && discovery.route.status === 'available' ? `${(selectedRoute.distanceMeters / 1000).toFixed(1)} km · ${(selectedRoute.durationSeconds / 60).toFixed(0)} min · ${discovery.route.freshness?.toUpperCase()} · observed ${formatObserved(selectedRoute.observedAt)}` : origin && destination && (!origin.location || !destination.location) ? 'Selected result has no route coordinates. Choose another place.' : origin && destination ? `From ${origin.displayName} · ${discovery.route.errorCode ?? 'route preview not yet requested'}` : 'Choose a route origin and a place to preview distance and time.'}</span><b>{origin && destination ? `${origin.displayName} → ${destination.displayName}` : 'Route preview'}</b></div><button type="button" onClick={handleRouteAction} disabled={connection.status !== 'connected' || !origin?.location || !destination?.location || (!canPropose && discovery.route.status === 'loading') || (canPropose && proposalPending)}>{routeButtonLabel}</button></div>
        {routeMatchesSelection && (discovery.route.status === 'error' || discovery.route.status === 'unavailable') && <p className="discovery-message route-error" role="status">{discovery.route.status === 'unavailable' ? `Route provider unavailable: ${discovery.route.errorCode ?? 'not configured'}.` : `Route preview failed: ${discovery.route.errorCode ?? 'provider error'}.`}</p>}
        {selectedRoute && discovery.route.status === 'available' && <small className="route-provenance">{discovery.route.provider} · {discovery.route.source?.toUpperCase()} · {discovery.route.freshness?.toUpperCase()} · {discovery.route.attribution} · <a href={discovery.route.attributionUrl ?? undefined} target="_blank" rel="noreferrer">Attribution</a> · review only, journey unchanged</small>}
        {proposal && <p className="passenger-proposal-status">Center proposal: {proposalStateLabel(proposal)}</p>}
      </div>
      <div className="place-heading"><h3>{destinationResults.length > 0 ? 'Near the next stop' : 'Curated spots'}</h3><span>{destinationResults.length > 0 ? `Mapbox · ${destinationResults.length} results · temporary use` : !destinationSearchCurrent ? 'Illustrative examples' : 'Search status below'}</span></div>
      <div className="place-list">
        {destinationResults.length > 0 ? destinationResults.slice(0, 3).map((place, index) => <button type="button" key={place.placeId} className={`place-row place-art-${index + 1} ${destination?.placeId === place.placeId ? 'active' : ''}`} aria-pressed={destination?.placeId === place.placeId} onClick={() => { setDestination(place); setPreviewSelection(''); }}><span className="dish-art" aria-hidden="true"><i/><b/><em/></span><span className="place-copy"><b>{place.displayName}</b><small>{place.formattedAddress ?? (place.types.join(' · ') || 'Address unavailable')}</small><span>{place.provider} · {place.source.toUpperCase()} · {place.freshness.toUpperCase()} · {formatObserved(place.observedAt)}</span><small>{place.attribution} · temporary use</small></span></button>)
          : !destinationSearchCurrent ? illustrativeRows
            : discovery.destination.status === 'loading' ? <div className="place-empty" role="status">Searching places from the selected provider…</div>
              : discovery.destination.status === 'unavailable' || discovery.destination.status === 'error' ? <div className="place-empty" role="status">{searchStatus('destination')} Check the query or provider configuration and try again.</div>
                : discovery.destination.status === 'available' ? <div className="place-empty" role="status">No places matched this search. Try a broader phrase or another cuisine.</div>
                : illustrativeRows}
      </div>
      {connection.status !== 'connected' && <p className="discovery-message passenger-connection-state" role="status">Passenger gateway {connection.status}: {connection.lastMessage}</p>}
    </div>
  </section>;
}

function RearDisplay() {
  const [temperature, setTemperature] = useState(21.5);
  const [playing, setPlaying] = useState(false);
  const [talking, setTalking] = useState(false);
  const [settings, setSettings] = useState(false);
  return <section className="device rear-device" aria-label="Rear display preview">
    <div className="rear-tile media-tile"><h3>Media player</h3><div className="media-controls"><button aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}><Icon name={playing ? 'pause' : 'play'} size={23}/></button><button aria-label="Previous track"><Icon name="back" size={25}/></button><button aria-label="Next track"><Icon name="next" size={25}/></button></div><p>Music &amp; audio</p><span className="track-name">{playing ? 'Now Playing' : 'Ready to play'} · The Midnight Echo</span><div className="track-progress"><i className={playing ? 'playing' : ''}/></div></div>
    <div className="rear-tile climate-tile"><h3>Climate control</h3><span className="tile-label">Zone temp</span><div className="temperature"><button aria-label="Lower temperature" onClick={() => setTemperature(Math.max(16, temperature - 0.5))}><Icon name="back"/></button><strong>{temperature.toFixed(1)}°C</strong><button aria-label="Raise temperature" onClick={() => setTemperature(Math.min(28, temperature + 0.5))}><Icon name="next"/></button></div><div className="climate-footer"><span>Fan speed: 3</span><span>Auto</span><button className="sync-button">Sync</button></div></div>
    <div className="rear-tile communication-tile"><h3>Rear seat comm.</h3><div className="comm-row"><Icon name="phone" size={26}/><div><b>Driver call</b><span>{talking ? 'Calling…' : 'Ready'}</span></div><button onClick={() => setTalking(!talking)}>{talking ? 'End' : 'Talk'}</button></div><div className="comm-row"><Icon name="seat" size={26}/><div><b>Intercom</b><span>Cabin audio</span></div></div></div>
    <div className="rear-tile settings-tile"><h3>System settings</h3>{settings ? <div className="settings-options"><button onClick={() => setSettings(false)}>Display &amp; audio</button><button onClick={() => setSettings(false)}>Configuration</button><span>Brightness&nbsp; · &nbsp;70%</span></div> : <><button className="setting-row" onClick={() => setSettings(true)}><Icon name="display" size={25}/><span><b>Display &amp; audio</b><small>Current settings</small></span></button><button className="setting-row" onClick={() => setSettings(true)}><Icon name="settings" size={25}/><span><b>Configuration</b><small>Current settings</small></span></button></>}</div>
  </section>;
}

function WindowDisplay() {
  return <section className="device window-device" aria-label="Interactive window preview">
    <div className="window-scene"><div className="window-photo"><img src={windowReference} alt="Illustrative outside view with simulated time, weather, route, and connectivity details in a thin lower-edge strip"/></div></div>
  </section>;
}

function ControlConsole({ speedKph, load, connectivity, connections, status, lastMessage, onSpeed, onLoad, onConnectivity }: { speedKph: number; load: 'low' | 'normal' | 'high' | 'critical' | null; connectivity: GatewayState['connectivity']; connections: GatewayState['connections']; status: string; lastMessage: string; onSpeed: (speed: number) => void; onLoad: (level: 'low' | 'normal' | 'high' | 'critical') => void; onConnectivity: (mode: 'online' | 'degraded' | 'offline') => void }) {
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
    <div className="console-controls"><label>Vehicle speed <span><input type="number" min="0" max="300" value={speedInput} onChange={(event) => setSpeedInput(event.target.value)} /> km/h</span></label><button onClick={() => { const speed = Number(speedInput); if (Number.isFinite(speed) && speed >= 0 && speed <= 300) onSpeed(speed); }}>Send vehicle.telemetry.report</button><label>Simulated driver cognitive load</label><button onClick={() => onLoad('low')}>Report low load</button><button onClick={() => onLoad('normal')}>Report normal load</button><button onClick={() => onLoad('high')}>Report high load</button><button onClick={() => onLoad('critical')}>Report critical load</button><label>Simulated network condition</label><button aria-pressed={connectivity.mode === 'online' && connectivity.source === 'simulated'} onClick={() => onConnectivity('online')}>Set network online</button><button aria-pressed={connectivity.mode === 'degraded' && connectivity.source === 'simulated'} onClick={() => onConnectivity('degraded')}>Set network degraded</button><button aria-pressed={connectivity.mode === 'offline' && connectivity.source === 'simulated'} onClick={() => onConnectivity('offline')}>Set network offline</button></div>
    <div className="console-feedback"><span>Connection: {status}{status === 'connected' ? ' · registered · welcome received' : ''}</span><span>Last gateway message: {lastMessage}</span></div>
  </section>;
}

function App() {
  const { state: gateway, sendCommand, voice, startVoice, stopVoice, discovery, searchPlaces, previewRoute, recommendation, requestJourneyRecommendation, submitJourneyRecommendation } = useAuraCommand();
  const centerConnection = gateway.connections['center-main'];
  const passengerConnection = gateway.connections['front-passenger-main'];
  const clusterConnection = gateway.connections['cluster-main'];
  const rearConnection = gateway.connections['rear-tablet'];
  const windowConnection = gateway.connections['window-tablet'];
  const clusterPresentation = resolvePresentation({ role: 'cluster', ...(gateway.load ? { load: gateway.load } : {}), activeSafetyWarning: gateway.activeSafetyWarning !== null });
  const centerPresentation = resolvePresentation({ role: 'center', ...(gateway.load ? { load: gateway.load } : {}), activeSafetyWarning: gateway.activeSafetyWarning !== null });
  const passengerProposal = [...gateway.proposals].reverse().find((item) => (item.kind === 'ADD_TRIP_STOP' || item.payload?.discoveryMode === 'route_preview') && item.targetRole === 'center');
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
      <div className="driver-zone"><ScreenHeading title="Driver display" details="Cluster" gatewayStatus={clusterConnection.status} presence={gateway.presence}/><Cluster speedKph={gateway.speedKph} warning={gateway.activeSafetyWarning} presentation={clusterPresentation}/><ScreenHeading title="Journey & control" details="Center" gatewayStatus={centerConnection.status} presence={gateway.presence}/><CenterDisplay proposals={gateway.proposals} journeyStops={gateway.journeyStops} connection={centerConnection} warning={gateway.activeSafetyWarning} presentation={centerPresentation} recommendation={recommendation} onRecommendationRequest={requestJourneyRecommendation} onRecommendationSubmit={(proposal) => { submitJourneyRecommendation(proposal); }} onConsent={(proposalId, decision) => sendCommand('center-main', { type: 'action.consent', payload: { proposalId, decision } })}/></div>
      <div className="passenger-zone"><ScreenHeading title="Passenger discovery" details="Front passenger" gatewayStatus={passengerConnection.status} presence={gateway.presence}/><PassengerDisplay discovery={discovery} searchPlaces={searchPlaces} previewRoute={previewRoute} proposal={passengerProposal} connection={passengerConnection} onProposal={(place, route, originLabel) => {
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
      <div className="rear-zone"><ScreenHeading title="Rear cabin" details="Rear display" gatewayStatus={rearConnection.status} presence={gateway.presence}/><RearDisplay/></div>
      <div className="window-zone"><ScreenHeading title="Ambient window" details="Window" gatewayStatus={windowConnection.status} presence={gateway.presence} windowExamples/><WindowDisplay/></div>
    </div>
    <ControlConsole speedKph={gateway.speedKph} load={gateway.load} connectivity={gateway.connectivity} connections={gateway.connections} status={centerConnection.status} lastMessage={centerConnection.lastMessage} onSpeed={(speed) => sendCommand('center-main', { type: 'vehicle.telemetry.report', payload: { vehicle: { speedKph: speed } } })} onLoad={(level) => sendCommand('center-main', { type: 'driver.cognitive_load.report', payload: { level, timestamp: Date.now(), confidence: 1 } })} onConnectivity={setConnectivity}/>
    <footer className="simulator-footer"><span>Scenario&nbsp; <b>Munich → Stuttgart</b></span><span>Illustrative route values · shared vehicle telemetry updates when the gateway is connected</span></footer>
  </main>;
}

export default App;
