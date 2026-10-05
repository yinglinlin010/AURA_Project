import {
  PROTOCOL_VERSION, type DisplayRegistration, type RegisterMessage,
  type ResyncMessage, type StateSnapshot, type WelcomeMessage,
} from '../../../../contracts/protocol/src/types.js';
import {
  acceptGatewayEvent, acceptGatewaySnapshot, createGatewayOrderCursor,
  establishGatewaySession, type GatewayDomainEvent,
} from './gateway-order.js';

export interface TransportEvent { data?: unknown }
export type TransportListener = (event: TransportEvent) => void;
/** Native WebSocket or a small adapter; the transport never owns a global socket. */
export interface TransportSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: TransportListener): void;
  removeEventListener(type: 'open' | 'message' | 'error' | 'close', listener: TransportListener): void;
}
export interface IndependentClientState {
  status: 'idle' | 'connecting' | 'awaiting_welcome' | 'awaiting_snapshot' | 'ready' | 'disconnected' | 'error';
  sessionId: string | null;
  sequence: number | null;
  pendingCount: number;
  error: string | null;
  /** Last authoritative role-projected snapshot, not a locally reduced event state. */
  snapshot: StateSnapshot | null;
}
export interface IndependentClientOptions {
  registration: DisplayRegistration;
  socketFactory: () => TransportSocket;
  timeoutMs?: number;
  onState?: (state: IndependentClientState) => void;
  onEvent?: (event: GatewayDomainEvent) => void;
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const sequence = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Read-only single-role transport: only register/resync, explicit reconnect, no command replay. */
export function createIndependentClientTransport(options: IndependentClientOptions) {
  const registration = structuredClone(options.registration);
  const timeoutMs = options.timeoutMs ?? 3_000;
  if (!registration.enabled || registration.protocolVersion !== PROTOCOL_VERSION ||
      !registration.displayId || !registration.deviceId || !registration.role) throw new Error('INVALID_REGISTRATION');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new Error('INVALID_TIMEOUT');
  let cursor = createGatewayOrderCursor();
  let state: IndependentClientState = { status: 'idle', sessionId: null, sequence: null, pendingCount: 0, error: null, snapshot: null };
  let socket: TransportSocket | null = null;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let listeners: Array<[Parameters<TransportSocket['addEventListener']>[0], TransportListener]> = [];
  let resyncPending = false;
  let welcomeSequence = 0;
  let previousSession: string | null = null;
  let previousSequence: number | null = null;
  const retiredSessions = new Set<string>();
  const getState = () => structuredClone(state);
  const publish = (changes: Partial<IndependentClientState> = {}) => {
    state = { ...state, ...changes, sessionId: cursor.sessionId, sequence: cursor.sequence, pendingCount: cursor.pendingEvents.size };
    options.onState?.(getState());
  };
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const release = () => {
    generation++;
    clearTimer();
    const old = socket;
    socket = null;
    if (old) {
      for (const [type, listener] of listeners) old.removeEventListener(type, listener);
      listeners = [];
      old.close();
    }
  };
  const remember = () => {
    if (cursor.sessionId !== null) {
      if (previousSession !== cursor.sessionId || cursor.sequence !== null) {
        previousSession = cursor.sessionId;
        previousSequence = cursor.sequence;
      }
    }
  };
  const fail = (error: string) => {
    remember(); release(); cursor = createGatewayOrderCursor(); resyncPending = false;
    publish({ status: 'error', error, snapshot: null });
  };
  const armTimeout = () => {
    clearTimer();
    timer = setTimeout(() => fail('HANDSHAKE_TIMEOUT'), timeoutMs);
  };
  const sendResync = (force = false) => {
    if (!socket || socket.readyState !== 1 || cursor.sessionId === null || (resyncPending && !force)) return false;
    const message: ResyncMessage = {
      kind: 'resync', protocolVersion: PROTOCOL_VERSION, sessionId: cursor.sessionId,
      traceId: `independent-client:${crypto.randomUUID()}`,
      ...(cursor.sequence === null ? {} : { afterSequence: cursor.sequence }),
    };
    try { socket.send(JSON.stringify(message)); resyncPending = true; return true; }
    catch { fail('RESYNC_SEND_FAILED'); return false; }
  };
  const receive = (raw: unknown) => {
    if (typeof raw !== 'string') { fail('NON_JSON_MESSAGE'); return; }
    let message: unknown;
    try { message = JSON.parse(raw); } catch { fail('INVALID_JSON'); return; }
    if (!record(message)) { fail('INVALID_MESSAGE'); return; }
    if ('protocolVersion' in message && message.protocolVersion !== PROTOCOL_VERSION) { fail('PROTOCOL_MISMATCH'); return; }
    if (message.kind === 'welcome') {
      if (state.status !== 'awaiting_welcome' || message.protocolVersion !== PROTOCOL_VERSION ||
          message.displayId !== registration.displayId || message.role !== registration.role ||
          !sequence(message.sequence) || typeof message.sessionId !== 'string' || retiredSessions.has(message.sessionId)) {
        fail('UNTRUSTED_WELCOME'); return;
      }
      const next = establishGatewaySession(cursor, message as unknown as WelcomeMessage);
      if (!next) { fail('UNTRUSTED_WELCOME'); return; }
      if (previousSession && previousSession !== next.sessionId) retiredSessions.add(previousSession);
      cursor = next;
      welcomeSequence = message.sequence;
      publish({ status: 'awaiting_snapshot' }); armTimeout();
      return;
    }
    if (cursor.sessionId === null) { fail('MESSAGE_BEFORE_WELCOME'); return; }
    if (message.kind === 'snapshot') {
      const snapshot = message.snapshot;
      if (!record(snapshot) || snapshot.protocolVersion !== PROTOCOL_VERSION ||
          (snapshot.displayId !== undefined && snapshot.displayId !== registration.displayId)) {
        fail('INVALID_SNAPSHOT_IDENTITY'); return;
      }
      if (snapshot.sessionId !== cursor.sessionId) return;
      if (!sequence(snapshot.sequence) || snapshot.sequence < welcomeSequence ||
          (previousSession === cursor.sessionId && previousSequence !== null && snapshot.sequence < previousSequence)) return;
      const result = acceptGatewaySnapshot(cursor, snapshot);
      if (!result.accepted) return;
      cursor = result.cursor; resyncPending = false; clearTimer(); remember();
      publish({ status: 'ready', snapshot: structuredClone(snapshot) as unknown as StateSnapshot });
      result.events.forEach((event) => options.onEvent?.(structuredClone(event)));
      if (result.gap) sendResync();
    } else if (message.kind === 'event') {
      const result = acceptGatewayEvent(cursor, message.event);
      if (!result.accepted && !result.overflow) return;
      cursor = result.cursor;
      if (!result.gap) resyncPending = false;
      remember(); publish();
      result.events.forEach((event) => options.onEvent?.(structuredClone(event)));
      if (result.gap) sendResync(result.overflow);
    } else if (message.kind === 'error') fail('GATEWAY_ERROR');
    // Presence/ack/voice/provider messages have no authority to mutate this snapshot.
  };
  const disconnect = () => {
    remember(); release(); cursor = createGatewayOrderCursor(); resyncPending = false;
    publish({ status: 'disconnected', error: null, snapshot: null });
  };
  const connect = () => {
    if (socket) throw new Error('CLIENT_ALREADY_CONNECTED');
    cursor = createGatewayOrderCursor(); resyncPending = false;
    publish({ status: 'connecting', error: null, snapshot: null });
    const activeGeneration = ++generation;
    try { socket = options.socketFactory(); }
    catch { fail('SOCKET_FACTORY_FAILED'); return; }
    const activeSocket = socket;
    const listen = (type: Parameters<TransportSocket['addEventListener']>[0], callback: TransportListener) => {
      const listener: TransportListener = (event) => {
        if (generation === activeGeneration && socket === activeSocket) callback(event);
      };
      listeners.push([type, listener]); activeSocket.addEventListener(type, listener);
    };
    listen('open', () => {
      const message: RegisterMessage = {
        kind: 'register', protocolVersion: PROTOCOL_VERSION, displayId: registration.displayId,
        deviceId: registration.deviceId, traceId: `independent-client:${crypto.randomUUID()}`,
      };
      publish({ status: 'awaiting_welcome' });
      try { activeSocket.send(JSON.stringify(message)); } catch { fail('REGISTER_SEND_FAILED'); }
    });
    listen('message', (event) => receive(event.data));
    listen('error', () => fail('SOCKET_ERROR'));
    listen('close', disconnect);
    armTimeout();
  };
  return { connect, disconnect, getState, requestResync: () => sendResync() };
}
