import test from 'node:test';
import assert from 'node:assert/strict';
import { attention, confirm, initialCabin, parseIntent, submit, updateContext } from '../../core-domain/src/pact/engine.js';

test('PACT splits conflicting climate preferences by zone, offline too', () => {
  const c = submit(submit({ ...initialCabin(), online: false }, 'driver', '空調 21'), 'passenger', '空調 25');
  assert.equal(c.temperatures.driver, 21); assert.equal(c.temperatures.passenger, 25);
  assert.equal(c.history[0]?.decision, 'EXECUTE');
});
test('PACT defers navigation until safe, then requires actual driver approval', () => {
  let c = updateContext(initialCabin(), { complexity: 100, hmiTasks: 1 });
  assert.equal(attention(c), 80);
  c = submit(c, 'passenger', '改去海邊餐廳');
  assert.equal(c.history[0]?.decision, 'DEFER');
  assert.equal(confirm(c, 1, 'driver', true).destination, '花蓮車站');
  c = updateContext(c, { complexity: 10, hmiTasks: 0 });
  assert.equal(c.pending[0]?.decision, 'ASK');
  assert.equal(confirm(c, 1, 'passenger', true).destination, '花蓮車站');
  assert.equal(confirm(updateContext(c, { complexity: 100 }), 1, 'driver', true).destination, '花蓮車站');
  const approved = confirm(c, 1, 'driver', true);
  assert.equal(approved.destination, '海邊餐廳'); assert.equal(approved.pending.length, 0);
  assert.equal(confirm(approved, 1, 'driver', true).history.length, approved.history.length);
});
test('PACT preserves navigation when driver declines', () => {
  const c = confirm(submit(initialCabin(), 'rear', '導航到台北'), 1, 'driver', false);
  assert.equal(c.destination, '花蓮車站'); assert.equal(c.history[0]?.decision, 'REJECT');
});
test('PACT routes personal content and rejects unauthorized HUD and invalid climate', () => {
  let c = submit(initialCabin(), 'driver', '找餐廳');
  assert.equal(c.history[0]?.target, 'passenger'); assert.equal(c.search, true);
  c = submit(c, 'driver', '播放電影'); assert.equal(c.history[0]?.target, 'rear');
  c = submit(c, 'rear', '修改 HUD'); assert.equal(c.history[0]?.decision, 'REJECT');
  c = submit(c, 'passenger', '空調 -1'); assert.equal(c.temperatures.passenger, 22);
  c = submit(c, 'passenger', '未知指令'); assert.equal(c.history[0]?.decision, 'REJECT');
});
test('PACT shared HVAC needs consent without dual-zone capability', () => {
  let c = submit({ ...initialCabin(), dualZone: false }, 'passenger', '空調 25');
  assert.equal(c.history[0]?.decision, 'ASK'); assert.equal(c.temperatures.driver, 22);
  c = confirm(c, 1, 'driver', true); assert.deepEqual(c.temperatures, { driver: 25, passenger: 25, rear: 25 });
});
test('PACT resumes deferred local task once, without duplicating consent', () => {
  let c = submit(updateContext(initialCabin(), { complexity: 100 }), 'driver', '修改 HUD');
  assert.equal(c.pending.length, 1);
  c = updateContext(c, { complexity: 0 }); assert.equal(c.pending.length, 0);
  const count = c.history.length;
  c = updateContext(c, { online: false }); assert.equal(c.history.length, count);
});

test('PACT capability change reevaluates pending HVAC and HUD affects simulated display', () => {
  let c = submit({ ...initialCabin(), dualZone: false }, 'passenger', '空調 25');
  c = updateContext(c, { dualZone: true });
  assert.equal(c.pending.length, 0); assert.equal(c.temperatures.passenger, 25);
  c = submit(c, 'driver', '修改 HUD'); assert.equal(c.hudCompact, true);
  c = submit(c, 'driver', '修改 HUD'); assert.equal(c.hudCompact, false);
});

test('PACT navigation destinations do not get misclassified as climate or HUD commands', () => {
  assert.deepEqual(parseIntent('導航到空調餐廳'), { kind: 'navigation', destination: '空調餐廳' });
  assert.deepEqual(parseIntent('改去 HUD 展示館'), { kind: 'navigation', destination: 'HUD 展示館' });
  assert.deepEqual(parseIntent('導航到'), { kind: 'unknown' });
});
