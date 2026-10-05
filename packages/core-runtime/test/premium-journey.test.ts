import assert from 'node:assert/strict';
import test from 'node:test';
import { default as Ajv } from 'ajv';
import { readFileSync } from 'node:fs';
import type { AuraCommand, DisplayRegistry } from '../../../contracts/protocol/src/types.js';
import { CoreRuntime } from '../src/core-runtime.js';
import { ScenarioRunner, loadScenarioFile } from '../../../adapters/simulator/src/scenario.js';
const registry = JSON.parse(readFileSync('apps/core-host/config/display-registry.json', 'utf8')) as DisplayRegistry;
let serial = 0;
function send(runtime: CoreRuntime, displayId: string, command: AuraCommand) {
  const display = registry.displays.find(d => d.displayId === displayId)!;
  const id = `premium-${++serial}`;
  return runtime.submitCommand({ protocolVersion: 1, kind: 'command', messageId: id, commandId: id, sessionId: runtime.sessionId, traceId: id, sentAt: Date.now(), sender: { displayId, deviceId: display.deviceId }, command });
}
test('competition flow repeats three times on one resettable runtime; reconnect holds rear presentation until explicit resume', async () => {
  const runtime = new CoreRuntime({ registry, allowDemoReset: true });
  const schema = JSON.parse(readFileSync('contracts/protocol/schemas/protocol.schema.json', 'utf8'));
  const ajv = new Ajv.default({ strict: false, allErrors: true });
  ajv.addSchema(schema);
  const validateEvent = ajv.getSchema(`${schema.$id}#/definitions/eventEnvelope`)!;
  const validateState = ajv.getSchema(`${schema.$id}#/definitions/sharedState`)!;
  const validateWire = runtime.eventBus.subscribe(event => {
    assert.ok(validateEvent(event), JSON.stringify(validateEvent.errors));
    assert.ok(validateState(runtime.getState()), JSON.stringify(validateState.errors));
  });
  const scenario = loadScenarioFile('scenarios/competition-premium-journey.yaml');
  for (let run = 0; run < 3; run++) {
    assert.equal(send(runtime, 'center-main', { type: 'demo.reset', payload: {} }).status, 'RECEIVED');
    const before = runtime.getState().revision;
    let observedHold = false;
    const decisions: string[] = [];
    let lowLoadSeen = false;
    const unsubscribe = runtime.eventBus.subscribe(event => {
      if (event.type === 'driver.load.updated' && event.payload.level === 'normal' && decisions.length) lowLoadSeen = true;
      if (event.type === 'proposal.policy.decided') {
        decisions.push(event.payload.decision.outcome);
        if (event.payload.decision.outcome === 'ASK') assert.ok(lowLoadSeen, 'No ASK before load recovery');
        if (event.payload.decision.outcome !== 'EXECUTE') assert.equal(runtime.getState().journey.stops.length, 0);
      }
      if (event.type === 'connectivity.state.changed' && event.payload.evidence.endsWith('cloud-restored')) {
        observedHold = true;
        assert.equal(runtime.getState().rearExperience.mode, 'quiet');
        assert.equal(runtime.getState().rearExperience.liveJourney, 'available_but_held');
        assert.equal(runtime.getState().journey.stops.length, 1);
      }
    });
    // Distinct replay IDs prevent old command/signal deduplication across recording takes.
    const take = { ...scenario, id: `${scenario.id}-take-${run}` };
    const result = await new ScenarioRunner({ runtime, registry, timeScale: 0 }).run(take);
    unsubscribe();
    assert.ok(observedHold);
    assert.deepEqual(decisions, ['DEFER', 'ASK', 'EXECUTE']);
    assert.ok(result.expectationResults.length > 0);
    assert.ok(result.expectationResults.every(check => check.passed), JSON.stringify(result.expectationResults));
    assert.ok(runtime.getState().revision > before);
    assert.equal(runtime.getState().rearExperience.liveJourney, 'presented');
  }
  validateWire();
});
test('rear mode authority and reset authorization cannot bypass shared journey consent', () => {
  const runtime = new CoreRuntime({ registry });
  const before = runtime.getState();
  for (const id of ['center-main', 'front-passenger-main', 'window-tablet', 'cluster-main']) {
    assert.equal(send(runtime, id, { type: 'rear.mode.set', payload: { mode: 'quiet' } }).status, 'REJECTED');
    assert.deepEqual(runtime.getState(), before);
  }
  assert.equal(send(runtime, 'center-main', { type: 'demo.reset', payload: {} }).reasonCode, 'DEMO_RESET_DISABLED');
  assert.equal(send(runtime, 'rear-tablet', { type: 'rear.mode.set', payload: { mode: 'quiet' } }).reasonCode, 'LOCAL_REAR_QUIET_MODE');
  assert.equal(runtime.getState().rearExperience.liveJourney, 'unavailable');
  assert.equal(send(runtime, 'rear-tablet', { type: 'rear.mode.set', payload: { mode: 'normal' } }).status, 'RECEIVED');
  assert.equal(runtime.getState().rearExperience.liveJourney, 'unavailable');
});
test('demo reset cannot clear a persisted runtime', () => {
  const runtime = new CoreRuntime({ registry, allowDemoReset: true, persistJourney: () => undefined });
  assert.equal(send(runtime, 'center-main', { type: 'demo.reset', payload: {} }).status, 'REJECTED');
});

test('NORMAL request yields to HIGH, invalidates consent, then asks again at NORMAL', () => {
  const runtime = new CoreRuntime({ registry, allowDemoReset: true });
  const load = (level: 'normal' | 'high') => send(runtime, 'center-main', { type: 'driver.cognitive_load.report', payload: { level, confidence: .95, timestamp: Date.now() } });
  load('normal');
  send(runtime, 'window-tablet', { type: 'action.propose', payload: { proposal: { proposalId: 'normal-high-donghu', kind: 'ADD_TRIP_STOP', summary: 'Donghu', targetRole: 'center', priority: 'secondary', requiresConsent: true, payload: { placeId: 'fixture-donghu', label: 'Donghu', competitionScenario: 'premium-journey' } } } });
  assert.equal(runtime.getState().activeProposals[0]?.status, 'awaiting_consent');
  load('high');
  assert.equal(runtime.getState().activeProposals[0]?.status, 'deferred');
  send(runtime, 'center-main', { type: 'action.consent', payload: { proposalId: 'normal-high-donghu', decision: 'approve' } });
  assert.equal(runtime.getState().journey.stops.length, 0);
  load('normal');
  assert.equal(runtime.getState().activeProposals[0]?.status, 'awaiting_consent');
  send(runtime, 'center-main', { type: 'action.consent', payload: { proposalId: 'normal-high-donghu', decision: 'approve' } });
  assert.equal(runtime.getState().journey.stops.length, 1);
  send(runtime, 'center-main', { type: 'demo.reset', payload: {} });
  assert.equal(runtime.getState().journey.stops.length, 0);
  assert.equal(runtime.getState().activeProposals.length, 0);
});
