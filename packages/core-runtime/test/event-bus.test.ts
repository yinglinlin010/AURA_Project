import assert from "node:assert/strict";
import test from "node:test";
import type { AuraDomainEvent, AuraDomainEventDraft, ContextSignal } from "../../../contracts/protocol/src/types.js";
import { EventBus } from "../src/event-bus.js";

function signalEvent(
  sessionId = "session-a",
  eventId = "event-1",
  signalId = "signal-1",
): Extract<AuraDomainEventDraft, { type: "context.signal.received" }> {
  return {
    eventId,
    type: "context.signal.received",
    sessionId,
    traceId: "trace-1",
    commandId: "command-1",
    occurredAt: 100,
    payload: {
      signal: {
        signalId,
        type: "test.signal",
        value: { nested: { value: 1 } },
        source: "simulated",
        timestamp: 100,
      },
    },
  };
}

function readSignal(event: AuraDomainEvent): ContextSignal {
  if (event.type !== "context.signal.received") throw new Error("EXPECTED_SIGNAL_EVENT");
  return event.payload.signal;
}

test("repeated event IDs return the original sequence without republishing", () => {
  const bus = new EventBus({ sessionId: "session-a" });
  const received: number[] = [];
  bus.subscribe((event) => received.push(event.sequence));

  const first = bus.publish(signalEvent());
  const replay = bus.publish(signalEvent());

  assert.equal(first.sequence, 1);
  assert.equal(replay.sequence, 1);
  assert.equal(bus.sequence, 1);
  assert.deepEqual(received, [1]);
});

test("reusing an event ID with different content is rejected", () => {
  const bus = new EventBus({ sessionId: "session-a" });
  bus.publish(signalEvent());

  assert.throws(
    () => bus.publish(signalEvent("session-a", "event-1", "different-signal")),
    { message: "EVENT_ID_REUSED" },
  );
  assert.equal(bus.sequence, 1);
});

test("events are cloned and deeply frozen before publication", () => {
  const bus = new EventBus({ sessionId: "session-a" });
  const draft = signalEvent();
  const published = bus.publish(draft);
  const publishedSignal = readSignal(published);

  (draft.payload.signal.value as { nested: { value: number } }).nested.value = 2;

  assert.equal(
    (publishedSignal.value as { nested: { value: number } }).nested.value,
    1,
  );
  assert.equal(Object.isFrozen(published), true);
  assert.equal(Object.isFrozen(publishedSignal), true);
  assert.equal(Object.isFrozen(publishedSignal.value), true);
});

test("sessions reject foreign events and keep identical IDs isolated", () => {
  const firstSession = new EventBus({ sessionId: "session-a" });
  const secondSession = new EventBus({ sessionId: "session-b" });

  assert.throws(
    () => firstSession.publish(signalEvent("session-b")),
    { message: "EVENT_SESSION_MISMATCH" },
  );
  const firstEvent = firstSession.publish(signalEvent("session-a", "shared-id"));
  const secondEvent = secondSession.publish(signalEvent("session-b", "shared-id"));

  assert.equal(firstEvent.sessionId, "session-a");
  assert.equal(secondEvent.sessionId, "session-b");
  assert.equal(firstSession.sequence, 1);
  assert.equal(secondSession.sequence, 1);
});

test("deduplication survives replay-history eviction", () => {
  const bus = new EventBus({ sessionId: "session-a", historyLimit: 1 });
  const original = signalEvent("session-a", "event-1", "signal-1");

  const first = bus.publish(original);
  bus.publish(signalEvent("session-a", "event-2", "signal-2"));
  const replay = bus.publish(original);

  assert.equal(first.sequence, 1);
  assert.equal(replay.sequence, 1);
  assert.equal(bus.sequence, 2);
  assert.deepEqual(bus.eventsAfter(0).map((event) => event.eventId), ["event-2"]);
});
