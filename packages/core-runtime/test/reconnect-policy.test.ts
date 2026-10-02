import assert from 'node:assert/strict';
import test from 'node:test';
import { reconnectDelayMs } from '../../../apps/web-simulator/src/core/reconnect-policy.js';

test('reconnect delay doubles from 250 ms and caps at 8 seconds', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(reconnectDelayMs), [250, 500, 1_000, 2_000, 4_000, 8_000, 8_000]);
  assert.equal(reconnectDelayMs(100), 8_000);
});

test('reconnect delay rejects invalid attempt numbers', () => {
  assert.throws(() => reconnectDelayMs(-1), RangeError);
  assert.throws(() => reconnectDelayMs(Number.NaN), RangeError);
});
