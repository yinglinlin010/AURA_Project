import { createHash, randomUUID } from "node:crypto";
import type {
  AuraDomainEvent,
  AuraDomainEventDraft,
} from "../../../contracts/protocol/src/types.js";

export interface EventBusOptions {
  sessionId: string;
  historyLimit?: number;
}

export type EventListener = (event: AuraDomainEvent) => void;

export class EventBus {
  readonly sessionId: string;
  private readonly historyLimit: number;
  private readonly listeners = new Set<EventListener>();
  // Retain compact fingerprints for the session lifetime. Replay history is
  // bounded, but an old event ID must never be applied again after its copy ages out.
  private readonly eventIds = new Map<string, { fingerprint: string; sequence: number }>();
  private readonly history: AuraDomainEvent[] = [];
  private nextSequence = 0;

  constructor(options: EventBusOptions) {
    assertId(options.sessionId, "INVALID_SESSION_ID");
    this.sessionId = options.sessionId;
    const historyLimit = options.historyLimit ?? 5_000;
    if (!Number.isInteger(historyLimit) || historyLimit < 1) {
      throw new Error("INVALID_EVENT_HISTORY_LIMIT");
    }
    this.historyLimit = historyLimit;
  }

  get sequence(): number {
    return this.nextSequence;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(draft: AuraDomainEventDraft): AuraDomainEvent {
    const eventId = draft.eventId ?? randomUUID();
    if (draft.sessionId !== this.sessionId) {
      throw new Error("EVENT_SESSION_MISMATCH");
    }
    assertId(eventId, "INVALID_EVENT_ID");
    assertId(draft.traceId, "INVALID_TRACE_ID");
    if (draft.commandId !== null) assertId(draft.commandId, "INVALID_COMMAND_ID");
    if (!Number.isInteger(draft.occurredAt) || draft.occurredAt < 0) {
      throw new Error("INVALID_EVENT_TIMESTAMP");
    }

    const fingerprint = createHash("sha256")
      .update(stableStringify({ ...draft, eventId }))
      .digest("hex");
    const prior = this.eventIds.get(eventId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error("EVENT_ID_REUSED");
      return deepFreeze(structuredClone({ ...draft, eventId, sequence: prior.sequence })) as AuraDomainEvent;
    }

    const sequence = this.nextSequence + 1;
    const event = deepFreeze(structuredClone({
      ...draft,
      eventId,
      sequence,
      occurredAt: draft.occurredAt,
    })) as AuraDomainEvent;

    this.nextSequence = sequence;
    this.eventIds.set(eventId, { fingerprint, sequence });
    this.history.push(event);
    while (this.history.length > this.historyLimit) {
      this.history.shift();
    }

    for (const listener of this.listeners) listener(event);
    return event;
  }

  eventsAfter(sequence: number): AuraDomainEvent[] {
    return this.history.filter((event) => event.sequence > sequence);
  }
}

function assertId(value: string, reasonCode: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new Error(reasonCode);
  }
}

function stableStringify(value: unknown): string {
  const serialized = JSON.stringify(normalize(value));
  if (serialized === undefined) throw new Error("EVENT_NOT_SERIALIZABLE");
  return serialized;
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalize((value as Record<string, unknown>)[key])]),
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
