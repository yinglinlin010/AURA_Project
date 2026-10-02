export interface GatewayDomainEvent {
  sessionId: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
}

export interface GatewayOrderCursor {
  sessionId: string | null;
  sequence: number | null;
  pendingEvents: Map<number, GatewayDomainEvent>;
}

interface GatewayWelcome {
  kind: 'welcome';
  sessionId: string;
  sequence: number;
}

export interface GatewaySequenceResult {
  cursor: GatewayOrderCursor;
  accepted: boolean;
  /** Contiguous domain events to apply, in sequence order. */
  events: GatewayDomainEvent[];
  /** True while buffered events still reveal a sequence gap. */
  gap: boolean;
  overflow: boolean;
  snapshot: boolean;
}

export const MAX_PENDING_GATEWAY_EVENTS = 256;

export function createGatewayOrderCursor(): GatewayOrderCursor {
  return { sessionId: null, sequence: null, pendingEvents: new Map() };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isSequence = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/** A welcome establishes the active runtime session and clears all old ordering state. */
export function establishGatewaySession(
  cursor: GatewayOrderCursor,
  candidate: unknown,
): GatewayOrderCursor | null {
  if (!isRecord(candidate) || candidate.kind !== 'welcome' ||
      typeof candidate.sessionId !== 'string' || candidate.sessionId.length === 0 ||
      !isSequence(candidate.sequence)) return null;

  const welcome = candidate as unknown as GatewayWelcome;
  if (welcome.sessionId === cursor.sessionId) return cursor;
  return { sessionId: welcome.sessionId, sequence: null, pendingEvents: new Map() };
}

const reject = (cursor: GatewayOrderCursor): GatewaySequenceResult => ({
  cursor, accepted: false, events: [], gap: cursor.pendingEvents.size > 0, overflow: false, snapshot: false,
});

function drain(cursor: GatewayOrderCursor): GatewayDomainEvent[] {
  const events: GatewayDomainEvent[] = [];
  while (cursor.sequence !== null) {
    const nextSequence = cursor.sequence + 1;
    const next = cursor.pendingEvents.get(nextSequence);
    if (!next) break;
    cursor.pendingEvents.delete(nextSequence);
    cursor.sequence = nextSequence;
    events.push(next);
  }
  return events;
}

/** Buffer out-of-order domain events, returning only the next contiguous batch. */
export function acceptGatewayEvent(cursor: GatewayOrderCursor, candidate: unknown): GatewaySequenceResult {
  if (!isRecord(candidate) || typeof candidate.sessionId !== 'string' || candidate.sessionId.length === 0 ||
      !isSequence(candidate.sequence) || typeof candidate.type !== 'string' || candidate.type.length === 0 ||
      !isRecord(candidate.payload) || cursor.sessionId === null || candidate.sessionId !== cursor.sessionId) return reject(cursor);
  if (cursor.sequence !== null && candidate.sequence <= cursor.sequence) return reject(cursor);
  if (cursor.pendingEvents.has(candidate.sequence)) return reject(cursor);
  const event = candidate as unknown as GatewayDomainEvent;
  if (cursor.pendingEvents.size >= MAX_PENDING_GATEWAY_EVENTS) {
    cursor.pendingEvents.clear();
    return { cursor, accepted: false, events: [], gap: true, overflow: true, snapshot: false };
  }
  cursor.pendingEvents.set(event.sequence, event);
  const events = drain(cursor);
  return { cursor, accepted: true, events, gap: cursor.pendingEvents.size > 0, overflow: false, snapshot: false };
}

/** Replace state from an advancing snapshot, discard covered events, then drain later contiguous events. */
export function acceptGatewaySnapshot(cursor: GatewayOrderCursor, candidate: unknown): GatewaySequenceResult {
  if (!isRecord(candidate) || typeof candidate.sessionId !== 'string' || candidate.sessionId.length === 0 ||
      !isSequence(candidate.sequence) || !isRecord(candidate.state) || cursor.sessionId === null ||
      candidate.sessionId !== cursor.sessionId || (cursor.sequence !== null && candidate.sequence <= cursor.sequence)) return reject(cursor);
  cursor.sequence = candidate.sequence;
  for (const sequence of cursor.pendingEvents.keys()) {
    if (sequence <= candidate.sequence) cursor.pendingEvents.delete(sequence);
  }
  const events = drain(cursor);
  return { cursor, accepted: true, events, gap: cursor.pendingEvents.size > 0, overflow: false, snapshot: true };
}
