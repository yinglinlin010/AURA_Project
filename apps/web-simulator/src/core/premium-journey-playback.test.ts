import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playPremiumJourney, type PlaybackSnapshot, type PlaybackAction } from './premium-journey-playback.js';
function harness() {
  const s: PlaybackSnapshot = { ready: true, reset: false, proposal: undefined, decision: undefined, added: false, load: 'normal', cloud: 'online', rearMode: 'normal', intelligence: 'presented' };
  const commands: PlaybackAction[] = [];
  const observed: PlaybackAction[] = [];
  function apply(action: PlaybackAction) {
    if (action === 'reset') Object.assign(s, { reset: true, proposal: undefined, decision: undefined, added: false, load: 'normal', cloud: 'online', rearMode: 'normal', intelligence: 'presented' });
    if (action === 'request') Object.assign(s, s.load === 'high' ? { proposal: 'deferred', decision: 'DEFER' } : { proposal: 'awaiting_consent', decision: 'ASK' });
    if (action === 'high') s.load = 'high';
    if (action === 'normal') Object.assign(s, { load: 'normal', proposal: 'awaiting_consent', decision: 'ASK' });
    if (action === 'accept') Object.assign(s, { added: true, proposal: 'completed' });
    if (action === 'offline') Object.assign(s, { cloud: 'offline', intelligence: 'unavailable' });
    if (action === 'quiet') s.rearMode = 'quiet';
    if (action === 'restore') Object.assign(s, { cloud: 'online', intelligence: 'available_but_held' });
    if (action === 'resume') Object.assign(s, { rearMode: 'normal', intelligence: 'presented' });
  }
  const options = { read: () => s, execute: (a: PlaybackAction) => { commands.push(a); apply(a); return true; }, signal: new AbortController().signal, film: true, onStep: () => {}, onObserved: (a: PlaybackAction) => observed.push(a), holdMs: 0, timeoutMs: 50 };
  return { s, commands, observed, apply, options };
}
test('Film drives all nine observed states including HELD before RESUME, repeatable three times', async () => {
  const h = harness();
  for (let n = 0; n < 3; n++) await playPremiumJourney(h.options);
  assert.equal(h.observed.length, 27);
  assert.deepEqual(h.commands.slice(0, 9), ['reset','high','request','normal','accept','offline','quiet','restore','resume']);
});
test('Manual never scripts ACCEPT or RESUME; human action releases each gate', async () => {
  const h = harness(); const gates: string[] = [];
  await playPremiumJourney({ ...h.options, film: false, waitForManual: a => { gates.push(a); assert.equal(h.s.added, a === 'resume'); h.apply(a); } });
  assert.deepEqual(gates, ['accept','resume']);
  assert.equal(h.commands.includes('accept'), false); assert.equal(h.commands.includes('resume'), false);
});
test('Manual consent wait is cancellable and does not add a stop', async () => {
  const h = harness(); const c = new AbortController();
  await assert.rejects(playPremiumJourney({ ...h.options, signal: c.signal, film: false, waitForManual: () => c.abort() }), /stopped/);
  assert.equal(h.s.added, false); assert.equal(h.commands.includes('accept'), false);
});
test('A rejected command stops the run without later commands', async () => {
  const h = harness();
  await assert.rejects(playPremiumJourney({ ...h.options, execute: () => false }), /not sent/);
  assert.equal(h.observed.length, 0);
});
test('Missing observed state times out rather than blindly advancing', async () => {
  const h = harness();
  await assert.rejects(playPremiumJourney({ ...h.options, execute: () => true }), /Timed out/);
});
test('Gateway loss stops playback rather than claiming completion', async () => {
  const h = harness(); h.s.ready = false;
  await assert.rejects(playPremiumJourney(h.options), /disconnected/);
});
test('Unexpected journey mutation before consent fails closed', async () => {
  const h = harness();
  await assert.rejects(playPremiumJourney({ ...h.options, execute: a => { h.apply(a); if (a === 'request') h.s.added = true; return true; } }), /before driver consent/);
});

test('Request waits for observed HIGH acknowledgement; initial decision is DEFER', async () => {
  const h = harness(); const states: Array<{ action: PlaybackAction; load: string | null; decision: string | undefined }> = [];
  await playPremiumJourney({ ...h.options, timeoutMs: 300, execute: a => {
    h.commands.push(a);
    if (a === 'high') { setTimeout(() => h.apply(a), 20); return true; }
    if (a === 'request') assert.equal(h.s.load, 'high');
    h.apply(a); return true;
  }, onObserved: a => states.push({ action: a, load: h.s.load, decision: h.s.decision }) });
  assert.deepEqual(states.slice(0, 3).map(s => s.action), ['reset', 'high', 'request']);
  assert.equal(states[1].decision, undefined);
  assert.equal(states[2].decision, 'DEFER');
});
test('Unexpected ASK during HIGH request fails closed before NORMAL or ACCEPT', async () => {
  const h = harness();
  await assert.rejects(playPremiumJourney({ ...h.options, execute: a => {
    h.commands.push(a); h.apply(a);
    if (a === 'request') Object.assign(h.s, { proposal: 'awaiting_consent', decision: 'ASK' });
    return true;
  } }), /Timed out/);
  assert.equal(h.commands.includes('normal'), false);
  assert.equal(h.commands.includes('accept'), false);
  assert.equal(h.s.added, false);
});
