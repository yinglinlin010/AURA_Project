import { useCallback, useEffect, useRef, useState } from 'react';
import { CANONICAL_PRESENCE_STATES, type ActiveTask, type ConnectivityMode, type PresenceSnapshot, type SignalSource, type TaskLifecycleCommand } from '../../../../contracts/protocol/src/types';
import { acceptGatewayEvent, acceptGatewaySnapshot, createGatewayOrderCursor, establishGatewaySession, type GatewayDomainEvent } from './gateway-order';
import { reconnectDelayMs } from './reconnect-policy';

const PROTOCOL_VERSION = 1 as const;
const GATEWAY_URL = import.meta.env.VITE_AURA_WS_URL ?? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname || 'localhost'}:${import.meta.env.VITE_AURA_WS_PORT ?? '8080'}/ws`;
export const DISPLAY_REGISTRATIONS = [
  { displayId: 'cluster-main', deviceId: 'main-computer', role: 'cluster' },
  { displayId: 'center-main', deviceId: 'main-computer', role: 'center' },
  { displayId: 'front-passenger-main', deviceId: 'main-computer', role: 'front_passenger' },
  { displayId: 'rear-tablet', deviceId: 'rear-tablet-device', role: 'rear' },
  { displayId: 'window-tablet', deviceId: 'rear-tablet-device', role: 'interactive_window' },
] as const;
export type DisplayId = (typeof DISPLAY_REGISTRATIONS)[number]['displayId'];
type DisplayRole = (typeof DISPLAY_REGISTRATIONS)[number]['role'];
type LoadLevel = 'low' | 'normal' | 'high' | 'critical' | null;
type GatewayStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
type GatewayMessage = Record<string, any>;
export type VoiceStatus = 'IDLE' | 'REQUESTING_PERMISSION' | 'CONNECTING' | 'LISTENING' | 'TRANSCRIBING' | 'THINKING' | 'SPEAKING' | 'STOPPING' | 'ERROR';
export interface VoiceState { status: VoiceStatus; inputTranscript: string; outputTranscript: string; error: string | null; }
interface VoiceResources { stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode; worklet: AudioWorkletNode; mute: GainNode; }
export interface SharedProposal {
  proposalId: string;
  kind: string;
  summary: string;
  targetRole: string;
  status: string;
  requiresConsent: boolean;
  consentGranted?: boolean;
  lastReasonCode?: string;
  lastOutcome?: string;
  lastPolicyReason?: string;
  payload?: Record<string, unknown>;
}
export interface SharedStop { stopId: string; sourceProposalId: string; label: string; addedAt: number; }
export interface TransientPlace {
  provider: 'mapbox-search-box'; placeId: string; displayName: string; formattedAddress?: string;
  location?: { latitude: number; longitude: number }; types: string[]; attribution: string;
  source: 'api'; observedAt: number; freshness: 'fresh'; use: 'temporary';
}
export interface DiscoverySearchState {
  status: 'idle' | 'loading' | 'available' | 'unavailable' | 'error';
  requestId: string | null; results: TransientPlace[]; observedAt: number | null; errorCode: string | null;
}
export interface DiscoveryRouteState {
  status: 'idle' | 'loading' | 'available' | 'unavailable' | 'error';
  requestId: string | null;
  routes: Array<{ distanceMeters: number; durationSeconds: number; observedAt: number }>;
  provider: string | null; source: 'api' | 'unknown' | null; observedAt: number | null;
  freshness: 'fresh' | 'unknown' | null; attribution: string | null; attributionUrl: string | null;
  errorCode: string | null;
}
export interface DiscoveryState {
  origin: DiscoverySearchState; destination: DiscoverySearchState; route: DiscoveryRouteState;
}
export interface SharedSafetyWarning { warningId: string; signalId: string; signalType: string; severity: 'critical'; source: 'sensor' | 'simulated' | 'api' | 'derived' | 'cache'; freshness: 'fresh' | 'cached' | 'stale' | 'unknown'; activatedAt: number; }
export interface DisplayConnection { status: GatewayStatus; sessionId: string | null; deviceId: string; role: DisplayRole; lastMessage: string; }
export interface RecommendationProposal { proposalId: string; kind: string; summary: string; targetRole: string; priority: string; requiresConsent: boolean; payload: Record<string, unknown>; }
export interface RecommendationEvidenceSummary { criterion: string; source: string; sourceLabel: string; observedAt: number; freshness: string; }
export interface RecommendationOptionSummary { placeId: string; label: string; rationale: string[]; evidence: RecommendationEvidenceSummary[]; }
export interface RecommendationSummary { score: number; simulated: boolean; evidenceCoverage: number; rationale: string[]; evidence: RecommendationEvidenceSummary[]; wholeJourneyContext: RecommendationEvidenceSummary[]; alternatives: RecommendationOptionSummary[]; }
export type JourneyRecommendationState =
  | { status: 'idle'; requestId: null; requestText: '' }
  | { status: 'pending'; requestId: string; requestText: string }
  | { status: 'proposal'; requestId: string; requestText: string; proposal: RecommendationProposal; recommendation: RecommendationSummary; submissionError?: string }
  | { status: 'submitted'; requestId: string; requestText: string; proposal: RecommendationProposal; recommendation: RecommendationSummary; commandId: string }
  | { status: 'abstained'; requestId: string; requestText: string; reasonCode: string }
  | { status: 'error'; requestId: string | null; requestText: string; errorCode: string; message: string };
export interface GatewayState {
  speedKph: number;
  load: LoadLevel;
  connectivity: { mode: ConnectivityMode; source: SignalSource };
  proposals: SharedProposal[];
  journeyStops: SharedStop[];
  activeSafetyWarning: SharedSafetyWarning | null;
  activeTasks: ActiveTask[];
  presence: PresenceSnapshot | null;
  connections: Record<DisplayId, DisplayConnection>;
}

const initialConnections = Object.fromEntries(DISPLAY_REGISTRATIONS.map(({ displayId, deviceId, role }) => [displayId, {
  status: 'connecting' as const, sessionId: null, deviceId, role, lastMessage: 'Connecting to gateway',
}])) as Record<DisplayId, DisplayConnection>;
const initialState: GatewayState = {
  speedKph: 94,
  load: null,
  connectivity: { mode: 'degraded', source: 'derived' },
  proposals: [],
  journeyStops: [],
  activeSafetyWarning: null,
  activeTasks: [],
  presence: null,
  connections: initialConnections,
};
const emptySearch = (): DiscoverySearchState => ({ status: 'idle', requestId: null, results: [], observedAt: null, errorCode: null });
const emptyRoute = (): DiscoveryRouteState => ({ status: 'idle', requestId: null, routes: [], provider: null, source: null, observedAt: null, freshness: null, attribution: null, attributionUrl: null, errorCode: null });
const traceId = () => `web-simulator:${crypto.randomUUID()}`;
const emptyRecommendation = (): JourneyRecommendationState => ({ status: 'idle', requestId: null, requestText: '' });
const updateProposal = (proposals: SharedProposal[], next: SharedProposal) => {
  const index = proposals.findIndex((proposal) => proposal.proposalId === next.proposalId);
  return index < 0 ? [...proposals, next] : proposals.map((proposal, i) => i === index ? { ...proposal, ...next } : proposal);
};
const isPresenceSnapshot = (value: unknown): value is PresenceSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const presence = value as Partial<PresenceSnapshot>;
  return typeof presence.state === 'string' && CANONICAL_PRESENCE_STATES.includes(presence.state as PresenceSnapshot['state']) && Number.isSafeInteger(presence.revision) && (presence.revision as number) >= 0;
};
const latestPresence = (current: PresenceSnapshot | null, candidate: unknown): PresenceSnapshot | null => {
  if (!isPresenceSnapshot(candidate) || (current && candidate.revision <= current.revision)) return current;
  return candidate;
};

export function useAuraCommand() {
  const socketsRef = useRef<Partial<Record<DisplayId, WebSocket>>>({});
  const gatewayOrderRef = useRef(createGatewayOrderCursor());
  const centerTaskSequenceRef = useRef<number | null>(null);
  const pendingTaskCommandRef = useRef<string | null>(null);
  const stateRef = useRef<GatewayState>(initialState);
  const voiceResourcesRef = useRef<VoiceResources | null>(null);
  const pendingAudioContextRef = useRef<AudioContext | null>(null);
  const playbackSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const voiceAttemptRef = useRef(0);
  const voiceTraceRef = useRef<string | null>(null);
  const recommendationRequestRef = useRef<{ requestId: string; traceId: string } | null>(null);
  const recommendationTextRef = useRef('');
  const recommendationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recommendationStateRef = useRef<JourneyRecommendationState>(emptyRecommendation());
  const voiceStatusRef = useRef<VoiceStatus>('IDLE');
  const audioOutputActiveRef = useRef(false);
  const outputSampleRateRef = useRef(24000);
  const playbackCursorRef = useRef(0);
  const [voice, setVoice] = useState<VoiceState>({ status: 'IDLE', inputTranscript: '', outputTranscript: '', error: null });
  const [state, setState] = useState<GatewayState>(initialState);
  const [discovery, setDiscovery] = useState<DiscoveryState>({ origin: emptySearch(), destination: emptySearch(), route: emptyRoute() });
  const [recommendation, setRecommendation] = useState<JourneyRecommendationState>(emptyRecommendation);
  const [taskReceipt, setTaskReceipt] = useState<{ commandId: string; status: string; reasonCode?: string } | null>(null);
  stateRef.current = state;
  recommendationStateRef.current = recommendation;
  voiceStatusRef.current = voice.status;

  const updateVoice = useCallback((changes: Partial<VoiceState>) => {
    if (changes.status) voiceStatusRef.current = changes.status;
    setVoice((current) => {
      const next = { ...current, ...changes };
      voiceStatusRef.current = next.status;
      return next;
    });
  }, []);

  const releaseCapture = useCallback(() => {
    const resources = voiceResourcesRef.current;
    if (!resources) {
      const pendingContext = pendingAudioContextRef.current;
      pendingAudioContextRef.current = null;
      if (pendingContext && pendingContext.state !== 'closed') void pendingContext.close().catch(() => undefined);
      return;
    }
    voiceResourcesRef.current = null;
    pendingAudioContextRef.current = null;
    resources.worklet.port.onmessage = null;
    resources.worklet.port.close();
    resources.source.disconnect();
    resources.worklet.disconnect();
    resources.mute.disconnect();
    resources.stream.getTracks().forEach((track) => track.stop());
    void resources.context.close().catch(() => undefined);
  }, []);

  const playPcm = useCallback((data: ArrayBuffer) => {
    const context = voiceResourcesRef.current?.context;
    if (!context || context.state === 'closed' || data.byteLength < 2) return;
    try {
      const sampleCount = Math.floor(data.byteLength / 2);
      const samples = new Float32Array(sampleCount);
      const view = new DataView(data);
      for (let i = 0; i < sampleCount; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
      const sampleRate = Math.min(96000, Math.max(8000, outputSampleRateRef.current));
      const buffer = context.createBuffer(1, sampleCount, sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const startAt = Math.max(context.currentTime + 0.01, playbackCursorRef.current);
      source.start(startAt);
      playbackCursorRef.current = startAt + buffer.duration;
      playbackSourcesRef.current.add(source);
      source.onended = () => {
        playbackSourcesRef.current.delete(source);
        source.disconnect();
      };
    } catch {
      updateVoice({ error: 'The browser could not play the audio returned by the voice provider.' });
    }
  }, [updateVoice]);

  useEffect(() => {
    const sockets: WebSocket[] = [];
    const retryTimers = new Map<DisplayId, ReturnType<typeof setTimeout>>();
    const failedAttempts = new Map<DisplayId, number>();
    const seenSessions = new Set<string>();
    const reconnecting = new Set<DisplayId>();
    let resyncRequested = false;
    let mounted = true;
    // Retries are isolated per display socket; a successful open restarts that socket's backoff.
    const scheduleReconnect = (registration: (typeof DISPLAY_REGISTRATIONS)[number]) => {
      if (!mounted || retryTimers.has(registration.displayId)) return;
      const attempt = failedAttempts.get(registration.displayId) ?? 0;
      failedAttempts.set(registration.displayId, attempt + 1);
      const timer = setTimeout(() => {
        retryTimers.delete(registration.displayId);
        if (mounted) connect(registration);
      }, reconnectDelayMs(attempt));
      retryTimers.set(registration.displayId, timer);
    };
    const connect = (registration: (typeof DISPLAY_REGISTRATIONS)[number]) => {
      if (!mounted) return;
      try {
        const socket = new WebSocket(GATEWAY_URL);
        let socketSessionId: string | null = null;
        let reconnected = false;
        if (registration.displayId === 'center-main') socket.binaryType = 'arraybuffer';
        sockets.push(socket);
        socketsRef.current[registration.displayId] = socket;
        const setConnection = (changes: Partial<DisplayConnection>) => {
          if (!mounted || socketsRef.current[registration.displayId] !== socket) return;
          setState((current) => ({ ...current,
            connections: { ...current.connections, [registration.displayId]: { ...current.connections[registration.displayId], ...changes } },
          }));
        };
        const sendResync = () => {
          const cursor = gatewayOrderRef.current;
          if (!mounted || resyncRequested || socket.readyState !== WebSocket.OPEN || socketSessionId === null ||
              socketSessionId !== cursor.sessionId || cursor.sequence === null) return;
          socket.send(JSON.stringify({ kind: 'resync', protocolVersion: PROTOCOL_VERSION, sessionId: cursor.sessionId,
            traceId: traceId(), afterSequence: cursor.sequence }));
          resyncRequested = true;
        };
        const applyDomainEvent = (event: GatewayDomainEvent) => {
          const payload = event.payload as any;
          if (event.type === 'vehicle.state.updated') setState((current) => ({ ...current, speedKph: payload.vehicle?.speedKph ?? current.speedKph }));
          else if (event.type === 'driver.load.updated') setState((current) => ({ ...current, load: payload.level ?? current.load }));
          else if (event.type === 'connectivity.state.changed') setState((current) => ({ ...current, connectivity: { mode: payload.mode ?? current.connectivity.mode, source: payload.source ?? current.connectivity.source } }));
          else if (event.type === 'proposal.created') {
            if (payload.proposal) setState((current) => ({ ...current, proposals: updateProposal(current.proposals, payload.proposal) }));
          } else if (event.type === 'proposal.status.changed') {
            const { proposalId, status, reasonCode } = payload;
            setState((current) => ({ ...current, proposals: current.proposals.map((proposal) => proposal.proposalId === proposalId ? { ...proposal, status, lastReasonCode: reasonCode } : proposal) }));
          } else if (event.type === 'proposal.consent.recorded') {
            const { proposalId, decision } = payload;
            setState((current) => ({ ...current, proposals: current.proposals.map((proposal) => proposal.proposalId === proposalId ? { ...proposal, consentGranted: decision === 'approve' } : proposal) }));
          } else if (event.type === 'proposal.policy.decided') {
            const decision = payload.decision;
            if (decision) setState((current) => ({ ...current, proposals: current.proposals.map((proposal) => proposal.proposalId === decision.proposalId ? { ...proposal, lastOutcome: decision.outcome, lastPolicyReason: decision.reasonCode } : proposal) }));
          } else if (event.type === 'journey.stop.added') {
            const stop = payload.stop;
            if (stop) setState((current) => ({ ...current, journeyStops: current.journeyStops.some((item) => item.stopId === stop.stopId) ? current.journeyStops : [...current.journeyStops, stop] }));
          } else if (event.type === 'safety.override.activated') {
            if (payload.warning) setState((current) => ({ ...current, activeSafetyWarning: payload.warning }));
          } else if (event.type === 'safety.warning.cleared') {
            const { warningId } = payload;
            setState((current) => current.activeSafetyWarning?.warningId === warningId ? { ...current, activeSafetyWarning: null } : current);
          }
        };
        const applyCenterTaskEvent = (event: GatewayDomainEvent) => {
          if (registration.displayId !== 'center-main' || event.sessionId !== gatewayOrderRef.current.sessionId ||
              (centerTaskSequenceRef.current !== null && event.sequence <= centerTaskSequenceRef.current)) return;
          centerTaskSequenceRef.current = event.sequence;
          const payload = event.payload as { task?: ActiveTask; taskId?: string; reasonCode?: string };
          if ((event.type === 'task.registered' || event.type === 'task.updated') && payload.task) {
            setState((current) => ({ ...current, activeTasks: current.activeTasks.some((task) => task.taskId === payload.task?.taskId)
              ? current.activeTasks.map((task) => task.taskId === payload.task?.taskId ? payload.task! : task)
              : [...current.activeTasks, payload.task!] }));
          } else if (payload.taskId) {
            setState((current) => ({ ...current, activeTasks: current.activeTasks.map((task) => task.taskId !== payload.taskId ? task
              : event.type === 'task.resumed' ? { ...task, status: 'running', pauseReason: undefined, interruptionReason: undefined }
              : event.type === 'task.interrupted' ? { ...task, status: 'interrupted', interruptionReason: payload.reasonCode }
              : event.type === 'task.cancelled' ? { ...task, status: 'cancelled', interruptionReason: payload.reasonCode }
              : event.type === 'task.completed' ? { ...task, status: 'completed' } : task) }));
          }
        };
        socket.addEventListener('open', () => {
          if (!mounted || socketsRef.current[registration.displayId] !== socket) return;
          reconnected = reconnecting.delete(registration.displayId);
          if (reconnected) {
            gatewayOrderRef.current.pendingEvents.clear();
            resyncRequested = false;
          }
          socket.send(JSON.stringify({ kind: 'register', protocolVersion: PROTOCOL_VERSION, displayId: registration.displayId, deviceId: registration.deviceId, traceId: traceId() }));
          setConnection({ status: 'connecting', sessionId: null, lastMessage: 'Registration sent' });
        });
        socket.addEventListener('message', (message) => {
          if (!mounted || socketsRef.current[registration.displayId] !== socket) return;
          if (registration.displayId === 'center-main' && message.data instanceof ArrayBuffer) {
            if (audioOutputActiveRef.current) playPcm(message.data);
            return;
          }
          let data: GatewayMessage;
          try {
            if (message.data instanceof Blob && registration.displayId === 'center-main') {
              void message.data.arrayBuffer().then((buffer) => { if (audioOutputActiveRef.current) playPcm(buffer); }).catch(() => updateVoice({ error: 'Could not read audio from the gateway.' }));
              return;
            }
            data = JSON.parse(String(message.data)) as GatewayMessage;
          }
          catch { setConnection({ lastMessage: 'Received invalid gateway JSON' }); return; }
          if (data.kind === 'welcome') {
            const nextCursor = data.protocolVersion === PROTOCOL_VERSION && data.displayId === registration.displayId && data.role === registration.role
              ? establishGatewaySession(gatewayOrderRef.current, data)
              : null;
            if (!nextCursor) {
              setConnection({ sessionId: null, status: 'error', lastMessage: 'Gateway welcome did not match this display registration' });
            } else {
              // Reset exponential backoff only after registration is accepted,
              // not merely after the transport socket opens.
              failedAttempts.set(registration.displayId, 0);
              if (nextCursor.sessionId !== null && nextCursor.sessionId !== gatewayOrderRef.current.sessionId) {
                if (seenSessions.has(nextCursor.sessionId)) return;
                seenSessions.add(nextCursor.sessionId);
                gatewayOrderRef.current = nextCursor;
                centerTaskSequenceRef.current = null;
                pendingTaskCommandRef.current = null;
                setTaskReceipt(null);
                resyncRequested = false;
                setState((current) => ({ ...current, speedKph: initialState.speedKph, load: initialState.load,
                  connectivity: initialState.connectivity, proposals: [], journeyStops: [], activeSafetyWarning: null, activeTasks: [], presence: null }));
              } else gatewayOrderRef.current = nextCursor;
              socketSessionId = nextCursor.sessionId;
              setConnection({ sessionId: data.sessionId, status: 'connected', lastMessage: `Registered as ${data.displayId} / ${data.role}` });
              if (reconnected) sendResync();
              if (isPresenceSnapshot(data.presence)) setState((current) => ({ ...current, presence: latestPresence(current.presence, data.presence) }));
            }
          } else if (data.kind === 'snapshot') {
            const snapshot = data.snapshot;
            const shared = snapshot?.state;
            if (registration.displayId === 'center-main' && snapshot?.sessionId === gatewayOrderRef.current.sessionId &&
                Number.isSafeInteger(snapshot.sequence) && Array.isArray(shared?.activeTasks) &&
                (centerTaskSequenceRef.current === null || snapshot.sequence >= centerTaskSequenceRef.current)) {
              centerTaskSequenceRef.current = snapshot.sequence;
              setState((current) => ({ ...current, activeTasks: shared.activeTasks }));
            }
            const result = acceptGatewaySnapshot(gatewayOrderRef.current, snapshot);
            if (result.accepted) gatewayOrderRef.current = result.cursor;
            setState((current) => ({
              ...current,
              presence: result.accepted ? latestPresence(current.presence, snapshot?.presence) : current.presence,
              ...(result.accepted && shared ? {
                speedKph: shared.vehicle?.speedKph ?? current.speedKph,
                load: shared.driver?.currentLoad ?? current.load,
                connectivity: shared.connectivity ? { mode: shared.connectivity.mode, source: shared.connectivity.source } : current.connectivity,
                proposals: Array.isArray(shared.activeProposals) ? shared.activeProposals : current.proposals,
                journeyStops: Array.isArray(shared.journey?.stops) ? shared.journey.stops : current.journeyStops,
                activeSafetyWarning: shared.activeSafetyWarning ?? null,
              } : {}),
              connections: { ...current.connections, [registration.displayId]: { ...current.connections[registration.displayId], lastMessage: 'Shared state snapshot received' } },
            }));
            if (result.accepted) {
              if (registration.displayId === 'center-main') result.events.forEach(applyCenterTaskEvent);
              result.events.forEach(applyDomainEvent);
              resyncRequested = false;
              if (result.gap) sendResync();
            }
          } else if (data.kind === 'presence.state.changed') {
            if (socketSessionId === null || socketSessionId !== gatewayOrderRef.current.sessionId) return;
            setState((current) => ({ ...current, presence: latestPresence(current.presence, data.presence) }));
          } else if (data.kind === 'event') {
            const event = data.event;
            if (event?.type?.startsWith('task.')) applyCenterTaskEvent(event);
            const result = acceptGatewayEvent(gatewayOrderRef.current, event);
            if (result.overflow) {
              // The bounded pending queue was discarded; request an authoritative
              // replay/snapshot now instead of silently keeping a partial state.
              sendResync();
              return;
            }
            if (!result.accepted) return;
            gatewayOrderRef.current = result.cursor;
            if (registration.displayId === 'center-main') result.events.forEach(applyCenterTaskEvent);
            result.events.forEach(applyDomainEvent);
            if (!result.gap) resyncRequested = false;
            else sendResync();
          } else if (data.kind === 'places.search.results' && registration.displayId === 'front-passenger-main') {
            const slot = data.slot === 'origin' ? 'origin' : 'destination';
            setDiscovery((current) => data.requestId !== current[slot].requestId ? current : ({ ...current, [slot]: {
              ...current[slot],
              status: data.status, results: Array.isArray(data.results) ? data.results : [],
              observedAt: typeof data.observedAt === 'number' ? data.observedAt : null,
              errorCode: typeof data.errorCode === 'string' ? data.errorCode : null,
            }, route: emptyRoute() }));
          } else if (data.kind === 'journey.route.preview.results' && registration.displayId === 'front-passenger-main') {
            setDiscovery((current) => data.requestId !== current.route.requestId ? current : ({ ...current, route: {
              ...current.route,
              status: data.status, routes: Array.isArray(data.routes) ? data.routes : [],
              provider: typeof data.provider === 'string' ? data.provider : null,
              source: data.source === 'api' || data.source === 'unknown' ? data.source : null,
              observedAt: typeof data.observedAt === 'number' ? data.observedAt : null,
              freshness: data.freshness === 'fresh' || data.freshness === 'unknown' ? data.freshness : null,
              attribution: typeof data.attribution === 'string' ? data.attribution : null,
              attributionUrl: typeof data.attributionUrl === 'string' ? data.attributionUrl : null,
              errorCode: typeof data.errorCode === 'string' ? data.errorCode : null,
            } }));
          } else if (data.kind === 'journey.recommendation.result' && registration.displayId === 'center-main') {
            if (data.requestId !== recommendationRequestRef.current?.requestId) return;
            recommendationRequestRef.current = null;
            if (recommendationTimeoutRef.current) clearTimeout(recommendationTimeoutRef.current);
            recommendationTimeoutRef.current = null;
            if (data.status === 'abstained' && typeof data.reasonCode === 'string') {
              setRecommendation({ status: 'abstained', requestId: data.requestId, requestText: recommendationTextRef.current, reasonCode: data.reasonCode });
            } else if (data.status === 'proposal' && data.centerProposal &&
              typeof data.centerProposal.proposalId === 'string' && data.centerProposal.kind === 'ADD_TRIP_STOP' &&
              data.centerProposal.targetRole === 'center' && data.centerProposal.requiresConsent === true &&
              typeof data.centerProposal.summary === 'string' && data.centerProposal.payload && typeof data.centerProposal.payload === 'object' &&
              data.recommendation && typeof data.recommendation === 'object' && Array.isArray(data.recommendation.rationale) &&
              Array.isArray(data.recommendation.evidence) && Array.isArray(data.recommendation.wholeJourneyContext) && Array.isArray(data.recommendation.alternatives)) {
              setRecommendation({ status: 'proposal', requestId: data.requestId, requestText: recommendationTextRef.current, proposal: data.centerProposal, recommendation: data.recommendation });
            } else {
              setRecommendation({ status: 'error', requestId: data.requestId, requestText: recommendationTextRef.current, errorCode: 'INVALID_RECOMMENDATION_RESULT', message: 'The Gateway returned a recommendation response that does not include a consent-required Center proposal.' });
            }
          } else if (data.kind === 'voice.status' && registration.displayId === 'center-main') {
            updateVoice({ status: data.state, error: data.state === 'IDLE' ? null : undefined });
            if (data.state === 'IDLE') {
              audioOutputActiveRef.current = false;
              releaseCapture();
              voiceTraceRef.current = null;
            }
          } else if (data.kind === 'voice.transcript' && registration.displayId === 'center-main') {
            updateVoice(data.direction === 'input'
              ? { inputTranscript: data.text, error: null }
              : { outputTranscript: data.text, error: null });
          } else if (data.kind === 'voice.audio' && registration.displayId === 'center-main') {
            if (data.phase === 'start') {
              const match = /rate=(\d+)/i.exec(String(data.mimeType));
              outputSampleRateRef.current = match ? Number(match[1]) : 24000;
              audioOutputActiveRef.current = true;
            } else {
              audioOutputActiveRef.current = false;
            }
          } else if (data.kind === 'ack') {
            const receipt = data.receipt;
            if (registration.displayId === 'center-main' && receipt?.commandId === pendingTaskCommandRef.current) {
              pendingTaskCommandRef.current = null;
              setTaskReceipt({ commandId: receipt.commandId, status: receipt.status, ...(receipt.reasonCode ? { reasonCode: receipt.reasonCode } : {}) });
            }
            setConnection({ lastMessage: `Command ${receipt?.status ?? 'acknowledged'}${receipt?.reasonCode ? ` · ${receipt.reasonCode}` : ''}` });
            const pendingRecommendation = recommendationStateRef.current;
            if (registration.displayId === 'center-main' && receipt?.status === 'REJECTED' && pendingRecommendation.status === 'submitted' && receipt.commandId === pendingRecommendation.commandId) {
              setRecommendation({ status: 'proposal', requestId: pendingRecommendation.requestId, requestText: pendingRecommendation.requestText, proposal: pendingRecommendation.proposal, recommendation: pendingRecommendation.recommendation, submissionError: receipt.reasonCode ?? 'ACTION_PROPOSAL_REJECTED' });
            }
          } else if (data.kind === 'error') {
            setConnection({ ...(data.code === 'DISPLAY_REGISTRATION_REJECTED' ? { status: 'error' as const } : {}), lastMessage: `${data.code}: ${data.message}` });
            // Discovery requests that fail gateway-side validation or role
            // authorization do not receive a typed discovery result. Clear
            // their loading state so the passenger sees the real gateway code
            // instead of a spinner that can never complete.
            if (registration.displayId === 'front-passenger-main') setDiscovery((current) => ({
              ...current,
              origin: current.origin.status === 'loading' ? { ...current.origin, status: 'error', errorCode: data.code ?? 'PASSENGER_GATEWAY_ERROR' } : current.origin,
              destination: current.destination.status === 'loading' ? { ...current.destination, status: 'error', errorCode: data.code ?? 'PASSENGER_GATEWAY_ERROR' } : current.destination,
              route: current.route.status === 'loading' ? { ...current.route, status: 'error', errorCode: data.code ?? 'PASSENGER_GATEWAY_ERROR' } : current.route,
            }));
            const pendingRequest = recommendationRequestRef.current;
            if (registration.displayId === 'center-main' && pendingRequest !== null && pendingRequest.traceId === data.traceId) {
              recommendationRequestRef.current = null;
              if (recommendationTimeoutRef.current) clearTimeout(recommendationTimeoutRef.current);
              recommendationTimeoutRef.current = null;
              setRecommendation({ status: 'error', requestId: pendingRequest.requestId, requestText: recommendationTextRef.current, errorCode: data.code ?? 'JOURNEY_RECOMMENDATION_ERROR', message: data.message ?? 'The Gateway could not process this request.' });
            }
            if (registration.displayId === 'center-main' && (voiceTraceRef.current || voiceStatusRef.current === 'CONNECTING')) {
              audioOutputActiveRef.current = false;
              releaseCapture();
              voiceTraceRef.current = null;
              updateVoice({ status: 'ERROR', error: `${data.code}: ${data.message}` });
            }
          }
        });
        socket.addEventListener('error', () => {
          if (!mounted || socketsRef.current[registration.displayId] !== socket) return;
          reconnecting.add(registration.displayId);
          resyncRequested = false;
          setConnection({ status: 'error', lastMessage: 'Gateway connection error' });
          if (registration.displayId === 'front-passenger-main') setDiscovery({ origin: emptySearch(), destination: emptySearch(), route: emptyRoute() });
          scheduleReconnect(registration);
        });
        socket.addEventListener('close', () => {
          if (!mounted || socketsRef.current[registration.displayId] !== socket) return;
          reconnecting.add(registration.displayId);
          resyncRequested = false;
          setConnection({ status: 'disconnected', sessionId: null, lastMessage: 'Gateway connection closed' });
          if (registration.displayId === 'center-main' && pendingTaskCommandRef.current) {
            setTaskReceipt({ commandId: pendingTaskCommandRef.current, status: 'UNKNOWN', reasonCode: 'CONNECTION_LOST_CHECK_TASK_STATE' });
            pendingTaskCommandRef.current = null;
          }
          if (registration.displayId === 'front-passenger-main') setDiscovery({ origin: emptySearch(), destination: emptySearch(), route: emptyRoute() });
          if (registration.displayId === 'center-main' && recommendationRequestRef.current) {
            const pendingRequest = recommendationRequestRef.current;
            recommendationRequestRef.current = null;
            if (recommendationTimeoutRef.current) clearTimeout(recommendationTimeoutRef.current);
            recommendationTimeoutRef.current = null;
            setRecommendation({ status: 'error', requestId: pendingRequest.requestId, requestText: recommendationTextRef.current, errorCode: 'CENTER_GATEWAY_DISCONNECTED', message: 'The Center Gateway disconnected before the recommendation returned.' });
          }
          if (registration.displayId === 'center-main' && voiceStatusRef.current !== 'IDLE') {
            audioOutputActiveRef.current = false;
            releaseCapture();
            voiceTraceRef.current = null;
            updateVoice({ status: 'ERROR', error: 'Gateway connection closed during the voice session.' });
          }
          scheduleReconnect(registration);
        });
      } catch {
        setState((current) => ({ ...current, connections: { ...current.connections, [registration.displayId]: { ...current.connections[registration.displayId], status: 'error', lastMessage: 'Could not open gateway connection' } } }));
        scheduleReconnect(registration);
      }
    };
    for (const registration of DISPLAY_REGISTRATIONS) connect(registration);
    return () => { mounted = false; retryTimers.forEach(clearTimeout); retryTimers.clear(); releaseCapture(); if (recommendationTimeoutRef.current) clearTimeout(recommendationTimeoutRef.current); recommendationTimeoutRef.current = null; recommendationRequestRef.current = null; sockets.forEach((socket) => socket.close()); socketsRef.current = {}; };
  }, [playPcm, releaseCapture, updateVoice]);

  const startVoice = useCallback(async () => {
    if (voiceStatusRef.current !== 'IDLE' && voiceStatusRef.current !== 'ERROR') return false;
    const attempt = ++voiceAttemptRef.current;
    playbackCursorRef.current = 0;
    const connection = stateRef.current.connections['center-main'];
    const socket = socketsRef.current['center-main'];
    if (!socket || socket.readyState !== WebSocket.OPEN || !connection.sessionId) {
      updateVoice({ status: 'ERROR', error: `Center gateway is ${connection.status}; connect before using the microphone.` });
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof window.AudioWorkletNode === 'undefined' || typeof window.AudioContext === 'undefined') {
      updateVoice({ status: 'ERROR', error: 'Microphone capture requires a secure browser context with getUserMedia, AudioContext, and AudioWorklet support.' });
      return false;
    }

    updateVoice({ status: 'REQUESTING_PERMISSION', error: null, inputTranscript: '', outputTranscript: '' });
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    try {
      context = new AudioContext();
      pendingAudioContextRef.current = context;
      // Permission may be canceled while the AudioContext is being closed; keep
      // an early resume rejection from becoming an unhandled promise.
      const contextReady = context.resume().catch(() => undefined);
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (attempt !== voiceAttemptRef.current) { stream.getTracks().forEach((track) => track.stop()); releaseCapture(); return false; }
      if (!context.audioWorklet) throw new Error('AudioWorklet is unavailable in this browser.');
      const sourceText = `class AuraPcm16Processor extends AudioWorkletProcessor {
        constructor() { super(); this.phase = 0; this.sum = 0; this.count = 0; this.samples = []; }
        process(inputs) {
          const channel = inputs[0] && inputs[0][0];
          if (!channel) return true;
          for (let i = 0; i < channel.length; i++) {
            this.sum += channel[i]; this.count++; this.phase += 16000;
            if (this.phase >= sampleRate) {
              const sample = this.sum / this.count;
              this.samples.push(Math.max(-1, Math.min(1, sample)));
              this.phase -= sampleRate; this.sum = 0; this.count = 0;
            }
          }
          while (this.samples.length >= 1024) {
            const batch = this.samples.splice(0, 1024); const pcm = new Int16Array(batch.length);
            for (let i = 0; i < batch.length; i++) pcm[i] = batch[i] < 0 ? batch[i] * 32768 : batch[i] * 32767;
            this.port.postMessage(pcm.buffer, [pcm.buffer]);
          }
          return true;
        }
      }
      registerProcessor('aura-pcm16-processor', AuraPcm16Processor);`;
      const moduleUrl = URL.createObjectURL(new Blob([sourceText], { type: 'text/javascript' }));
      try { await context.audioWorklet.addModule(moduleUrl); }
      finally { URL.revokeObjectURL(moduleUrl); }
      if (attempt !== voiceAttemptRef.current) throw new DOMException('Voice start cancelled.', 'AbortError');
      await contextReady;
      await context.resume();
      if (attempt !== voiceAttemptRef.current) throw new DOMException('Voice start cancelled.', 'AbortError');
      if (socket.readyState !== WebSocket.OPEN) throw new Error('Gateway connection closed before voice could start.');
      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, 'aura-pcm16-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(worklet);
      worklet.connect(mute);
      mute.connect(context.destination);
      voiceResourcesRef.current = { stream, context, source, worklet, mute };
      pendingAudioContextRef.current = null;
      worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (voiceStatusRef.current !== 'LISTENING' || socket.readyState !== WebSocket.OPEN) return;
        try { socket.send(event.data); }
        catch {
          updateVoice({ status: 'ERROR', error: 'Audio could not be sent to the voice gateway.' });
          releaseCapture();
        }
      };
      const traceId = `web-simulator:voice:${crypto.randomUUID()}`;
      voiceTraceRef.current = traceId;
      updateVoice({ status: 'CONNECTING', error: null });
      socket.send(JSON.stringify({ kind: 'voice.start', protocolVersion: PROTOCOL_VERSION, traceId, encoding: 'pcm_s16le', sampleRateHz: 16000, channels: 1 }));
      return true;
    } catch (error) {
      const resourcesWereInstalled = voiceResourcesRef.current?.context === context;
      if (resourcesWereInstalled) releaseCapture();
      else {
        stream?.getTracks().forEach((track) => track.stop());
        releaseCapture();
        if (context && context.state !== 'closed') void context.close().catch(() => undefined);
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        updateVoice({ status: 'IDLE', error: null });
        return false;
      }
      const detail = error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow microphone access and try again.'
        : error instanceof Error && error.name === 'NotFoundError'
          ? 'No microphone was found.'
          : error instanceof Error ? error.message : 'Microphone capture could not start.';
      const traceId = voiceTraceRef.current;
      const activeSocket = socketsRef.current['center-main'];
      if (traceId && activeSocket?.readyState === WebSocket.OPEN) {
        try { activeSocket.send(JSON.stringify({ kind: 'voice.stop', protocolVersion: PROTOCOL_VERSION, traceId })); } catch { /* socket is closing */ }
      }
      voiceTraceRef.current = null;
      audioOutputActiveRef.current = false;
      updateVoice({ status: 'ERROR', error: detail });
      return false;
    }
  }, [releaseCapture, updateVoice]);

  const stopVoice = useCallback(() => {
    const wasRequestingPermission = voiceStatusRef.current === 'REQUESTING_PERMISSION';
    if (wasRequestingPermission) {
      voiceAttemptRef.current++;
      updateVoice({ status: 'IDLE', error: null });
    }
    const socket = socketsRef.current['center-main'];
    const traceId = voiceTraceRef.current;
    const wasActive = wasRequestingPermission || (voiceStatusRef.current !== 'IDLE' && voiceStatusRef.current !== 'ERROR');
    if (wasActive && socket?.readyState === WebSocket.OPEN && traceId) {
      socket.send(JSON.stringify({ kind: 'voice.stop', protocolVersion: PROTOCOL_VERSION, traceId }));
      updateVoice({ status: 'STOPPING' });
    } else if (wasActive && !wasRequestingPermission) {
      updateVoice({ status: 'ERROR', error: 'Gateway connection was lost before voice.stop could be sent.' });
    }
    playbackSourcesRef.current.forEach((source) => { try { source.stop(); } catch { /* already ended */ } });
    playbackSourcesRef.current.clear();
    playbackCursorRef.current = 0;
    audioOutputActiveRef.current = false;
    releaseCapture();
    return wasActive;
  }, [releaseCapture, updateVoice]);

  const sendCommand = useCallback((displayId: DisplayId, command: { type: string; payload: Record<string, unknown> }, onSent?: (commandId: string) => void) => {
    const socket = socketsRef.current[displayId];
    const sessionId = state.connections[displayId].sessionId;
    if (!socket || socket.readyState !== WebSocket.OPEN || !sessionId) {
      setState((current) => ({ ...current, connections: { ...current.connections, [displayId]: { ...current.connections[displayId], lastMessage: `Cannot send ${command.type}: ${current.connections[displayId].lastMessage}` } } }));
      return false;
    }
    const id = crypto.randomUUID();
    onSent?.(id);
    socket.send(JSON.stringify({
      kind: 'command',
      envelope: {
        protocolVersion: PROTOCOL_VERSION,
        kind: 'command',
        messageId: id,
        commandId: id,
        sessionId,
        traceId: traceId(),
        sentAt: Date.now(),
        sender: { deviceId: state.connections[displayId].deviceId, displayId },
        command,
      },
    }));
    setState((current) => ({ ...current, connections: { ...current.connections, [displayId]: { ...current.connections[displayId], lastMessage: `Sent ${command.type}; awaiting gateway receipt` } } }));
    return true;
  }, [state.connections]);

  const sendTaskCommand = useCallback((command: TaskLifecycleCommand) => {
    const connection = state.connections['center-main'];
    const socket = socketsRef.current['center-main'];
    if (!socket || socket.readyState !== WebSocket.OPEN || !connection.sessionId || pendingTaskCommandRef.current) return false;
    const commandId = crypto.randomUUID();
    pendingTaskCommandRef.current = commandId;
    setTaskReceipt({ commandId, status: 'PENDING' });
    socket.send(JSON.stringify({
      kind: 'task.command', protocolVersion: PROTOCOL_VERSION, commandId,
      sessionId: connection.sessionId, traceId: traceId(), sentAt: Date.now(),
      sender: { deviceId: connection.deviceId, displayId: 'center-main' }, command,
    }));
    return true;
  }, [state.connections]);

  const sendDiscovery = useCallback((message: Record<string, unknown>) => {
    const displayId: DisplayId = 'front-passenger-main';
    const socket = socketsRef.current[displayId];
    if (!socket || socket.readyState !== WebSocket.OPEN || !stateRef.current.connections[displayId].sessionId) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const searchPlaces = useCallback((slot: 'origin' | 'destination', query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setDiscovery((current) => ({ ...current, [slot]: { ...emptySearch(), status: 'error', errorCode: 'PLACE_QUERY_REQUIRED' }, route: emptyRoute() }));
      return false;
    }
    const requestId = crypto.randomUUID();
    setDiscovery((current) => ({ ...current, [slot]: { ...emptySearch(), requestId, status: 'loading' }, route: emptyRoute() }));
    const sent = sendDiscovery({ kind: 'places.search', protocolVersion: PROTOCOL_VERSION, requestId, traceId: traceId(), slot, query: trimmed });
    if (!sent) setDiscovery((current) => ({ ...current, [slot]: { ...emptySearch(), status: 'unavailable', errorCode: 'PASSENGER_GATEWAY_UNAVAILABLE' } }));
    return sent;
  }, [sendDiscovery]);

  const previewRoute = useCallback((origin: TransientPlace, destination: TransientPlace) => {
    if (!origin.location || !destination.location) return false;
    const requestId = crypto.randomUUID();
    setDiscovery((current) => ({ ...current, route: { ...emptyRoute(), requestId, status: 'loading' } }));
    const sent = sendDiscovery({
      kind: 'journey.route.preview', protocolVersion: PROTOCOL_VERSION, requestId, traceId: traceId(),
      origin: origin.location, destination: destination.location,
    });
    if (!sent) setDiscovery((current) => ({ ...current, route: { ...emptyRoute(), status: 'unavailable', errorCode: 'PASSENGER_GATEWAY_UNAVAILABLE' } }));
    return sent;
  }, [sendDiscovery]);

  const requestJourneyRecommendation = useCallback((requestText: string) => {
    const trimmed = requestText.trim();
    if (!trimmed || trimmed.length > 1000) {
      setRecommendation({ status: 'error', requestId: null, requestText: trimmed.slice(0, 1000), errorCode: 'REQUEST_TEXT_INVALID', message: trimmed ? 'Keep the request to 1,000 characters or fewer.' : 'Enter a natural-language journey request first.' });
      return false;
    }
    const displayId: DisplayId = 'center-main';
    const socket = socketsRef.current[displayId];
    const connection = stateRef.current.connections[displayId];
    if (!socket || socket.readyState !== WebSocket.OPEN || !connection.sessionId) {
      setRecommendation({ status: 'error', requestId: null, requestText: trimmed, errorCode: 'CENTER_GATEWAY_UNAVAILABLE', message: `Center Gateway is ${connection.status}; connect before requesting a recommendation.` });
      return false;
    }
    if (recommendationTimeoutRef.current) clearTimeout(recommendationTimeoutRef.current);
    const requestId = crypto.randomUUID();
    const requestTraceId = traceId();
    recommendationRequestRef.current = { requestId, traceId: requestTraceId };
    recommendationTextRef.current = trimmed;
    setRecommendation({ status: 'pending', requestId, requestText: trimmed });
    try {
      socket.send(JSON.stringify({ kind: 'journey.recommendation.request', protocolVersion: PROTOCOL_VERSION, requestId, traceId: requestTraceId, requestText: trimmed }));
    } catch (error) {
      recommendationRequestRef.current = null;
      setRecommendation({ status: 'error', requestId, requestText: trimmed, errorCode: 'RECOMMENDATION_SEND_FAILED', message: error instanceof Error ? error.message : 'The request could not be sent to the Center Gateway.' });
      return false;
    }
    recommendationTimeoutRef.current = setTimeout(() => {
      if (recommendationRequestRef.current?.requestId !== requestId) return;
      recommendationRequestRef.current = null;
      recommendationTimeoutRef.current = null;
      setRecommendation({ status: 'error', requestId, requestText: trimmed, errorCode: 'RECOMMENDATION_TIMEOUT', message: 'No recommendation result arrived within 30 seconds. You can try again.' });
    }, 30_000);
    return true;
  }, []);

  const submitJourneyRecommendation = useCallback((proposal: RecommendationProposal) => {
    if (recommendation.status !== 'proposal' || recommendation.proposal.proposalId !== proposal.proposalId) return false;
    let commandId = '';
    const sent = sendCommand('center-main', { type: 'action.propose', payload: { proposal } }, (id) => { commandId = id; });
    if (sent) setRecommendation({ status: 'submitted', requestId: recommendation.requestId, requestText: recommendation.requestText, proposal, recommendation: recommendation.recommendation, commandId });
    return sent;
  }, [recommendation, sendCommand]);

  return { state, sendCommand, sendTaskCommand, taskReceipt, voice, startVoice, stopVoice, discovery, searchPlaces, previewRoute, recommendation, requestJourneyRecommendation, submitJourneyRecommendation };
}
