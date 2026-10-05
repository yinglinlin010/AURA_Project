import test from 'node:test';
import assert from 'node:assert/strict';
import { initialCabin, submit } from '../../core-domain/src/pact/engine.js';
import { restorePreferences, serializePreferences } from '../../core-domain/src/pact/preferences.js';

test('PACT restart restores applied preferences but never restores authority or consent', () => {
  let c = submit(submit(initialCabin(), 'driver', '空調 21'), 'passenger', '空調 25');
  c = submit(c, 'passenger', '改去海邊餐廳');
  const restored = restorePreferences(serializePreferences(c));
  assert.equal(restored.temperatures.driver, 21); assert.equal(restored.temperatures.passenger, 25);
  assert.equal(restored.destination, '花蓮車站'); assert.equal(restored.pending.length, 0);
  assert.equal(restored.history.length, 0);
});
test('PACT corrupt or inconsistent persisted preferences reset safely', () => {
  assert.deepEqual(restorePreferences('{broken'), initialCabin());
  const p = JSON.parse(serializePreferences(initialCabin()));
  p.temperatures.driver = 100;
  assert.deepEqual(restorePreferences(JSON.stringify(p)), initialCabin());
  p.temperatures.driver = 21; p.dualZone = false;
  assert.deepEqual(restorePreferences(JSON.stringify(p)), initialCabin());
});
