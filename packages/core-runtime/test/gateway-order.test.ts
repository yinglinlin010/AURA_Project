import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptGatewayEvent,
  acceptGatewaySnapshot,
  createGatewayOrderCursor,
  establishGatewaySession,
  MAX_PENDING_GATEWAY_EVENTS,
} from "../../../apps/web-simulator/src/core/gateway-order.js";

const welcome = (sessionId: string, sequence = 0) => ({ kind: "welcome", sessionId, sequence });
const snapshot = (sessionId: string, sequence: number) => ({ sessionId, sequence, state: { speedKph: sequence } });
const event = (sessionId: string, sequence: number) => ({
  sessionId, sequence, type: "vehicle.state.updated", payload: { vehicle: { speedKph: sequence } },
});

test("gateway cursor buffers event n+1 until n arrives, then returns both in order", () => {
  let cursor = establishGatewaySession(createGatewayOrderCursor(), welcome("session-a"))!;
  cursor = acceptGatewaySnapshot(cursor, snapshot("session-a", 10)).cursor;
  const ahead = acceptGatewayEvent(cursor, event("session-a", 12));
  assert.deepEqual(ahead.events, []);
  assert.equal(ahead.gap, true);
  const filled = acceptGatewayEvent(cursor, event("session-a", 11));
  assert.deepEqual(filled.events.map((item) => item.sequence), [11, 12]);
  assert.equal(filled.cursor.sequence, 12);
  assert.equal(filled.gap, false);
});

test("duplicate fanout and malformed or wrong-session events are rejected", () => {
  let cursor = establishGatewaySession(createGatewayOrderCursor(), welcome("session-a"))!;
  cursor = acceptGatewaySnapshot(cursor, snapshot("session-a", 4)).cursor;
  const first = acceptGatewayEvent(cursor, event("session-a", 5));
  assert.deepEqual(first.events.map((item) => item.sequence), [5]);
  assert.equal(acceptGatewayEvent(cursor, structuredClone(event("session-a", 5))).accepted, false);
  assert.equal(acceptGatewayEvent(cursor, event("session-b", 6)).accepted, false);
  assert.equal(acceptGatewayEvent(cursor, event("session-a", -1)).accepted, false);
  assert.equal(acceptGatewayEvent(cursor, { ...event("session-a", 6), payload: null }).accepted, false);
  assert.equal(acceptGatewayEvent(cursor, { ...event("session-a", 6), type: "" }).accepted, false);
  assert.equal(cursor.sequence, 5);
});

test("a newer snapshot fallback drops covered buffered events and drains later contiguous events", () => {
  let cursor = establishGatewaySession(createGatewayOrderCursor(), welcome("session-a"))!;
  cursor = acceptGatewaySnapshot(cursor, snapshot("session-a", 5)).cursor;
  acceptGatewayEvent(cursor, event("session-a", 6));
  acceptGatewayEvent(cursor, event("session-a", 8));
  const fallback = acceptGatewaySnapshot(cursor, snapshot("session-a", 7));
  assert.equal(fallback.accepted, true);
  assert.equal(fallback.snapshot, true);
  assert.deepEqual(fallback.events.map((item) => item.sequence), [8]);
  assert.equal(fallback.cursor.sequence, 8);
  assert.equal(fallback.gap, false);
  assert.equal(acceptGatewaySnapshot(cursor, snapshot("session-a", 7)).accepted, false);
});

test("a new runtime session clears buffered events and ordering state", () => {
  let cursor = establishGatewaySession(createGatewayOrderCursor(), welcome("session-a"))!;
  cursor = acceptGatewaySnapshot(cursor, snapshot("session-a", 10)).cursor;
  acceptGatewayEvent(cursor, event("session-a", 12));
  assert.equal(cursor.pendingEvents.size, 1);
  cursor = establishGatewaySession(cursor, welcome("session-b"))!;
  assert.deepEqual({ sessionId: cursor.sessionId, sequence: cursor.sequence, pending: cursor.pendingEvents.size }, {
    sessionId: "session-b", sequence: null, pending: 0,
  });
  assert.equal(acceptGatewayEvent(cursor, event("session-a", 11)).accepted, false);
});

test("overflow discards the bounded gap buffer and signals snapshot recovery", () => {
  let cursor = establishGatewaySession(createGatewayOrderCursor(), welcome("session-a"))!;
  cursor = acceptGatewaySnapshot(cursor, snapshot("session-a", 10)).cursor;
  for (let sequence = 12; sequence < 12 + MAX_PENDING_GATEWAY_EVENTS; sequence++) {
    const buffered = acceptGatewayEvent(cursor, event("session-a", sequence));
    assert.equal(buffered.accepted, true);
    assert.equal(buffered.gap, true);
  }
  assert.equal(cursor.pendingEvents.size, MAX_PENDING_GATEWAY_EVENTS);

  const overflow = acceptGatewayEvent(cursor, event("session-a", 12 + MAX_PENDING_GATEWAY_EVENTS));
  assert.equal(overflow.accepted, false);
  assert.equal(overflow.overflow, true);
  assert.equal(overflow.gap, true);
  assert.equal(cursor.pendingEvents.size, 0);
  assert.equal(cursor.sequence, 10);
});
