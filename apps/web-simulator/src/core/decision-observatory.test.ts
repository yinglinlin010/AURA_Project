import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionObservatory } from './decision-observatory.js';
import { uiText } from './ui-copy.js';
import type { GatewayState } from './useAuraCommand.js';
const state = (extra: Partial<GatewayState> = {}) => ({ proposals: [], rearExperience: { mode: 'normal', liveJourney: 'presented', source: 'scenario-fixture' }, ...extra } as GatewayState);
test('No event evidence means no fabricated decision', () => {
  assert.equal(decisionObservatory(state()), null);
  assert.equal(decisionObservatory(state({ proposals: [{ proposalId: 'p', kind: 'ADD_TRIP_STOP', summary: 'Donghu', targetRole: 'center', status: 'deferred', requiresConsent: true, payload: { competitionScenario: 'premium-journey' } }] })), null);
});
test('Uses actual decision outcome, actor and trace; newer local event takes precedence', () => {
  const s = state({ proposals: [{ proposalId: 'p', kind: 'ADD_TRIP_STOP', summary: 'Donghu', targetRole: 'center', requestedByRole: 'interactive_window', status: 'deferred', requiresConsent: true, payload: { competitionScenario: 'premium-journey' }, lastDecision: { decidedAt: 10, outcome: 'DEFER', reasonCode: 'DRIVER_COGNITIVE_LOAD_HIGH', traceId: 'journey-trace' } }] });
  assert.equal(decisionObservatory(s)?.actor, 'interactive_window');
  assert.equal(decisionObservatory(s)?.decision, 'DEFER');
  assert.equal(decisionObservatory(s)?.traceId, 'journey-trace');
  s.rearDecision = { decidedAt: 20, actor: 'rear', mode: 'quiet', decision: 'EXECUTE', traceId: 'quiet-trace', reasonCode: 'LOCAL_REAR_QUIET_MODE' };
  assert.equal(decisionObservatory(s)?.traceId, 'quiet-trace');
  assert.equal(decisionObservatory(s)?.resource, '後座個人區域');
});
test('Display localization preserves original protocol values and opaque evidence IDs', () => {
  const original = { label: 'Donghu', status: 'deferred', traceId: 'trace-Donghu-ASK', reason: 'DRIVER_COGNITIVE_LOAD_HIGH' };
  assert.equal(uiText(original.label), '東湖');
  assert.equal(uiText(original.status), '已延後');
  assert.equal(uiText(original.reason), original.reason);
  assert.equal(uiText(original.traceId), original.traceId);
  assert.equal(uiText('constructor'), 'constructor');
  assert.equal(uiText('Timed out waiting for shared state: ADD TO JOURNEY · PACT DEFER'), '等待共享狀態逾時：加入行程 · PACT 延後');
  assert.equal(original.label, 'Donghu');
  assert.equal(uiText('Donghu · +12 min'), '東湖 · +12 分鐘');
});
