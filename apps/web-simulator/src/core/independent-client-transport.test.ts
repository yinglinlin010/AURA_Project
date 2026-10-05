import assert from 'node:assert/strict';
import test from 'node:test';
import type { DisplayRegistration } from '../../../../contracts/protocol/src/types.js';
import { MAX_PENDING_GATEWAY_EVENTS } from './gateway-order.js';
import { createIndependentClientTransport, type TransportEvent, type TransportListener, type TransportSocket } from './independent-client-transport.js';

class FakeSocket implements TransportSocket {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  listeners = new Map<string, Set<TransportListener>>();
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.emit('close'); }
  addEventListener(type: string, listener: TransportListener) {
    const bucket = this.listeners.get(type) ?? new Set(); bucket.add(listener); this.listeners.set(type, bucket);
  }
  removeEventListener(type: string, listener: TransportListener) { this.listeners.get(type)?.delete(listener); }
  emit(type: string, event: TransportEvent = {}) { [...(this.listeners.get(type) ?? [])].forEach((listener) => listener(event)); }
  open() { this.readyState = 1; this.emit('open'); }
  message(data: unknown) { this.emit('message', { data: JSON.stringify(data) }); }
}
const roles = ['cluster', 'center', 'front_passenger', 'rear', 'interactive_window'];
const registration = (role = 'cluster'): DisplayRegistration => ({ displayId: `display-${role}`, deviceId: `device-${role}`, role, enabled: true, protocolVersion: 1 });
const welcome = (role = 'cluster', sessionId = 'session-a') => ({ kind: 'welcome', protocolVersion: 1, sessionId, sequence: 10, displayId: `display-${role}`, role });
const snapshot = (role = 'cluster', sessionId = 'session-a', sequence = 10) => ({ kind: 'snapshot', snapshot: {
  protocolVersion: 1, sessionId, sequence, displayId: `display-${role}`, stateRevision: 1, generatedAt: 1,
  presence: { state: 'IDLE', revision: 0 }, state: { activeTasks: role === 'center' ? [{ goal: 'CENTER_PRIVATE' }] : [{ status: 'running' }] },
} });
const event = (sequence: number, sessionId = 'session-a') => ({ kind: 'event', event: { sessionId, sequence, type: 'vehicle.state.updated', payload: { vehicle: { speedKph: sequence } } } });
function setup(role = 'cluster', timeoutMs = 1000) {
  const sockets: FakeSocket[] = [];
  const events: number[] = [];
  const client = createIndependentClientTransport({ registration: registration(role), timeoutMs,
    socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
    onEvent: (message) => events.push(message.sequence),
  });
  client.connect(); const socket = sockets[0]!; socket.open();
  return { client, socket, sockets, events };
}
function ready(role = 'cluster') {
  const fixture = setup(role); fixture.socket.message(welcome(role)); fixture.socket.message(snapshot(role)); return fixture;
}

test('five clients preserve same-sequence role projections and own separate cursors', () => {
  const clients = roles.map(ready);
  try {
    assert.equal(new Set(clients.map((item) => item.socket)).size, 5);
    clients.forEach(({ client, socket }, index) => {
      assert.equal(client.getState().status, 'ready');
      assert.equal(socket.sent[0]!.displayId, `display-${roles[index]}`);
      assert.equal(JSON.stringify(client.getState().snapshot).includes('CENTER_PRIVATE'), roles[index] === 'center');
    });
    clients[0]!.socket.message(event(12));
    assert.equal(clients[0]!.client.getState().pendingCount, 1);
    assert.equal(clients[1]!.client.getState().pendingCount, 0);
    clients[1]!.socket.message(event(11));
    assert.equal(clients[1]!.client.getState().sequence, 11);
    assert.equal(clients[0]!.client.getState().sequence, 10);
    const copy = clients[1]!.client.getState(); copy.snapshot!.state.activeTasks.length = 0;
    assert.equal(clients[1]!.client.getState().snapshot!.state.activeTasks.length, 1);
  } finally { clients.forEach(({ client }) => client.disconnect()); }
});

test('welcome validates role, display, protocol, session and sequence; no retry', () => {
  for (const patch of [{ role: 'center' }, { displayId: 'other' }, { protocolVersion: 2 }, { sessionId: '' }, { sequence: -1 }]) {
    const fixture = setup();
    fixture.socket.message({ ...welcome(), ...patch });
    assert.equal(fixture.client.getState().status, 'error');
    assert.equal(fixture.client.getState().sessionId, null);
    assert.equal(fixture.socket.readyState, 3);
    assert.equal(fixture.sockets.length, 1);
    assert.equal(fixture.client.requestResync(), false);
  }
});

test('messages before welcome, malformed JSON and mismatched snapshot identity fail closed', () => {
  for (const kind of ['early', 'json', 'snapshot-version', 'snapshot-display']) {
    const fixture = setup();
    if (kind === 'early') fixture.socket.message(snapshot());
    else if (kind === 'json') fixture.socket.emit('message', { data: '{' });
    else {
      fixture.socket.message(welcome());
      const message = snapshot();
      fixture.socket.message({ ...message, snapshot: { ...message.snapshot,
        ...(kind === 'snapshot-version' ? { protocolVersion: 2 } : { displayId: 'other' }),
      } });
    }
    assert.equal(fixture.client.getState().status, 'error');
    assert.equal(fixture.client.getState().snapshot, null);
  }
});

test('ordered delivery, deduplication and gaps cause one resync per unresolved gap', () => {
  const { client, socket, events } = ready();
  try {
    socket.message(event(12)); socket.message(event(12)); socket.message(event(13));
    assert.equal(socket.sent.filter((item) => item.kind === 'resync').length, 1);
    assert.deepEqual(events, []);
    socket.message(event(11));
    assert.deepEqual(events, [11, 12, 13]);
    socket.message(event(11)); socket.message(event(14, 'foreign-session'));
    assert.deepEqual(events, [11, 12, 13]);
    socket.message(event(15));
    assert.equal(socket.sent.filter((item) => item.kind === 'resync').length, 2);
    socket.message(snapshot('cluster', 'session-a', 15));
    assert.equal(client.getState().pendingCount, 0);
    assert.equal(client.getState().sequence, 15);
  } finally { client.disconnect(); }
});

test('pending overflow is bounded and requests a fresh authoritative resync', () => {
  const { client, socket } = ready();
  try {
    for (let i = 12; i < 12 + MAX_PENDING_GATEWAY_EVENTS; i++) socket.message(event(i));
    assert.equal(client.getState().pendingCount, MAX_PENDING_GATEWAY_EVENTS);
    socket.message(event(12 + MAX_PENDING_GATEWAY_EVENTS));
    assert.equal(client.getState().pendingCount, 0);
    assert.equal(socket.sent.filter((item) => item.kind === 'resync').length, 2);
    assert.equal(client.getState().sequence, 10);
  } finally { client.disconnect(); }
});

test('one client reconnect leaves others intact and ignores old socket callbacks', () => {
  const first = ready(); const second = ready('center');
  try {
    const stale = [...first.socket.listeners.get('message')!][0]!;
    first.socket.message(event(11));
    first.client.disconnect(); first.client.connect();
    const next = first.sockets[1]!; next.open(); next.message(welcome()); next.message(snapshot());
    assert.equal(first.client.getState().status, 'awaiting_snapshot'); // regressing same-session snapshot
    next.message(snapshot('cluster', 'session-a', 11));
    stale({ data: JSON.stringify(event(12)) });
    assert.equal(first.client.getState().sequence, 11);
    assert.equal(second.client.getState().status, 'ready');
    assert.equal(second.client.getState().sequence, 10);
    assert.equal(second.socket.readyState, 1);
    assert.equal(next.sent.filter((message) => message.kind === 'command' || message.kind === 'task.command').length, 0);
  } finally { first.client.disconnect(); second.client.disconnect(); }
});

test('new session replaces old state; retired sessions and duplicate welcome are rejected', () => {
  const fixture = ready();
  fixture.client.disconnect(); fixture.client.connect();
  const next = fixture.sockets[1]!; next.open(); next.message(welcome('cluster', 'session-b')); next.message(snapshot('cluster', 'session-b'));
  next.message(event(11, 'session-a')); assert.equal(fixture.client.getState().sequence, 10);
  fixture.client.disconnect(); fixture.client.connect();
  const retired = fixture.sockets[2]!; retired.open(); retired.message(welcome());
  assert.equal(fixture.client.getState().status, 'error');
  const other = ready(); other.socket.message(welcome());
  assert.equal(other.client.getState().status, 'error');
});

test('cleanup removes listeners, cancels handshake timeout and cannot send resync', async () => {
  const fixture = setup('cluster', 20);
  fixture.client.disconnect();
  fixture.socket.message(welcome());
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(fixture.client.getState().status, 'disconnected');
  assert.equal(fixture.client.requestResync(), false);
  assert.equal([...fixture.socket.listeners.values()].every((bucket) => bucket.size === 0), true);
});

test('bounded timeout fails missing welcome or missing snapshot', async () => {
  for (const hasWelcome of [false, true]) {
    const fixture = setup('cluster', 15);
    if (hasWelcome) fixture.socket.message(welcome());
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(fixture.client.getState().error, 'HANDSHAKE_TIMEOUT');
    assert.equal(fixture.client.getState().snapshot, null);
  }
});

test('invalid registration, timeout and double connection are rejected', () => {
  for (const options of [{ registration: { ...registration(), enabled: false } }, { timeoutMs: 0 }]) {
    assert.throws(() => createIndependentClientTransport({ registration: registration(), socketFactory: () => new FakeSocket(), ...options }));
  }
  const fixture = ready();
  assert.throws(() => fixture.client.connect(), /CLIENT_ALREADY_CONNECTED/);
  fixture.client.disconnect();
});

test('disconnecting during same-session handshake preserves the prior sequence floor', () => {
  const fixture = ready();
  try {
    fixture.socket.message(event(11));
    fixture.client.disconnect(); fixture.client.connect();
    const halfway = fixture.sockets[1]!; halfway.open(); halfway.message(welcome());
    fixture.client.disconnect(); fixture.client.connect();
    const next = fixture.sockets[2]!; next.open(); next.message(welcome()); next.message(snapshot());
    assert.equal(fixture.client.getState().status, 'awaiting_snapshot');
    next.message(snapshot('cluster', 'session-a', 11));
    assert.equal(fixture.client.getState().status, 'ready');
    assert.equal(fixture.client.getState().sequence, 11);
  } finally { fixture.client.disconnect(); }
});

test('events arriving before snapshot remain buffered until an authoritative baseline', () => {
  const fixture = setup();
  try {
    fixture.socket.message(welcome()); fixture.socket.message(event(11));
    assert.deepEqual(fixture.events, []);
    assert.equal(fixture.client.getState().status, 'awaiting_snapshot');
    assert.equal(fixture.client.getState().pendingCount, 1);
    assert.equal('afterSequence' in fixture.socket.sent[1]!, false);
    fixture.socket.message(snapshot());
    assert.deepEqual(fixture.events, [11]);
    assert.equal(fixture.client.getState().sequence, 11);
  } finally { fixture.client.disconnect(); }
});

test('factory and send errors fail closed without reconnect or command replay', () => {
  const factoryFailure = createIndependentClientTransport({ registration: registration(), socketFactory: () => { throw new Error('fake'); } });
  factoryFailure.connect();
  assert.equal(factoryFailure.getState().error, 'SOCKET_FACTORY_FAILED');
  const fixture = setup();
  fixture.socket.message(welcome()); fixture.socket.message(snapshot());
  fixture.socket.send = () => { throw new Error('fake'); };
  assert.equal(fixture.client.requestResync(), false);
  assert.equal(fixture.client.getState().error, 'RESYNC_SEND_FAILED');
  assert.equal(fixture.sockets.length, 1);
});
