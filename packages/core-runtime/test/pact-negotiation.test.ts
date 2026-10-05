import test from 'node:test';
import assert from 'node:assert/strict';
import { cabinTasks, cancelRequest, confirm, initialCabin, offerCompromise, respondCompromise, submit, updateContext } from '../../core-domain/src/pact/engine.js';

const negotiation = () => submit(submit({ ...initialCabin(), dualZone: false }, 'driver', '空調 21'), 'passenger', '空調 25');

test('new intent supersedes only the same requester and resource, invalidating old consent', () => {
  let c = submit(submit(initialCabin(), 'passenger', '改去餐廳 A'), 'rear', '改去餐廳 B');
  c = submit(c, 'passenger', '改去餐廳 C');
  assert.deepEqual(c.pending.map(p => p.request.id), [2, 3]);
  assert.equal(cabinTasks(c).find(t => t.id === 1)?.status, 'SUPERSEDED');
  assert.equal(confirm(c, 1, 'driver', true), c);
  assert.equal(confirm(c, 3, 'driver', true).destination, '餐廳 C');
});
test('invalid replacement does not discard a valid pending request', () => {
  const c = submit(submit({ ...initialCabin(), dualZone: false }, 'passenger', '空調 25'), 'passenger', '空調 99');
  assert.equal(c.pending.length, 1); assert.equal(c.pending[0]?.request.id, 1);
});
test('only requester or driver can withdraw and old consent cannot revive cancelled work', () => {
  const c = submit(initialCabin(), 'rear', '改去餐廳 A');
  assert.equal(cancelRequest(c, 1, 'passenger'), c);
  const cancelled = cancelRequest(c, 1, 'rear');
  assert.equal(cancelled.pending.length, 0);
  assert.equal(cabinTasks(cancelled)[0]?.status, 'CANCELLED');
  assert.equal(confirm(cancelled, 1, 'driver', true), cancelled);
  assert.equal(cancelRequest(c, 1, 'driver').pending.length, 0);
});
test('single-zone compromise requires driver offer and actual requester acceptance', () => {
  const c = negotiation();
  assert.equal(offerCompromise(c, 2, 'passenger'), c);
  const offered = offerCompromise(c, 2, 'driver');
  assert.equal(offered.pending[0]?.compromise?.temperature, 23);
  assert.deepEqual(offered.temperatures, { driver: 21, passenger: 21, rear: 21 });
  assert.equal(respondCompromise(offered, 2, 'rear', true), offered);
  assert.equal(confirm(offered, 2, 'driver', true), offered);
  const agreed = respondCompromise(offered, 2, 'passenger', true);
  assert.deepEqual(agreed.temperatures, { driver: 23, passenger: 23, rear: 23 });
  assert.equal(agreed.pending.length, 0);
  assert.equal(respondCompromise(agreed, 2, 'passenger', true), agreed);
});
test('declining a compromise preserves the original request for driver arbitration', () => {
  const c = respondCompromise(offerCompromise(negotiation(), 2, 'driver'), 2, 'passenger', false);
  assert.equal(c.pending[0]?.compromise, undefined);
  assert.equal(c.pending[0]?.target, 'driver');
  assert.equal(c.temperatures.driver, 21);
  assert.equal(confirm(c, 2, 'driver', true).temperatures.driver, 25);
});
test('accepted compromise defers in high load and applies exactly once after recovery', () => {
  let c = offerCompromise(negotiation(), 2, 'driver');
  c = updateContext(c, { complexity: 100 });
  c = respondCompromise(c, 2, 'passenger', true);
  assert.equal(c.pending[0]?.decision, 'DEFER'); assert.equal(c.temperatures.driver, 21);
  c = updateContext(c, { complexity: 10 });
  assert.equal(c.temperatures.driver, 23); assert.equal(c.pending.length, 0);
  const count = c.history.length;
  c = updateContext(c, { online: false }); assert.equal(c.history.length, count);
});
test('changing shared state invalidates an old compromise instead of overwriting it', () => {
  let c = offerCompromise(negotiation(), 2, 'driver');
  c = submit(c, 'driver', '空調 20');
  c = respondCompromise(c, 2, 'passenger', true);
  assert.equal(c.temperatures.driver, 20); assert.equal(c.pending.length, 0);
  assert.equal(cabinTasks(c).find(t => t.id === 2)?.status, 'SUPERSEDED');
});
test('gaining zone capability fulfills original personal preference without using old compromise', () => {
  const c = updateContext(offerCompromise(negotiation(), 2, 'driver'), { dualZone: true });
  assert.equal(c.pending.length, 0);
  assert.equal(c.temperatures.passenger, 25); assert.equal(c.temperatures.driver, 21);
});
test('cancelled agreed compromise stays cancelled on safe recovery', () => {
  let c = updateContext(offerCompromise(negotiation(), 2, 'driver'), { complexity: 100 });
  c = respondCompromise(c, 2, 'passenger', true);
  c = cancelRequest(c, 2, 'passenger');
  c = updateContext(c, { complexity: 10 });
  assert.equal(c.temperatures.driver, 21); assert.equal(c.pending.length, 0);
});
test('pending tasks remain visible after bounded history evicts their first event', () => {
  let c = submit(initialCabin(), 'passenger', '改去餐廳 A');
  for (let i = 0; i < 45; i++) c = submit(c, 'driver', '切換 HUD');
  assert.equal(c.history.length, 40);
  assert.equal(cabinTasks(c).find(t => t.id === 1)?.status, 'PENDING');
});

test('restoring the old temperature cannot revive an obsolete compromise authorization', () => {
  let c = offerCompromise(negotiation(), 2, 'driver');
  c = submit(submit(c, 'driver', '空調 20'), 'driver', '空調 21');
  c = respondCompromise(c, 2, 'passenger', true);
  assert.equal(c.temperatures.driver, 21);
  assert.equal(cabinTasks(c).find(t => t.id === 2)?.status, 'SUPERSEDED');
});
