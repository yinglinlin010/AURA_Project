import assert from 'node:assert/strict';
import test from 'node:test';
import type { GatewayState, SharedProposal } from './useAuraCommand.js';
import { manualJourneyStep } from './manual-journey.js';
const proposal = (status: string, outcome: string): SharedProposal => ({ proposalId: 'p', kind: 'ADD_TRIP_STOP', targetRole: 'center', status, summary: 'Donghu', requiresConsent: true, payload: { competitionScenario: 'premium-journey' }, lastDecision: { decidedAt: 1, outcome, traceId: 'core-trace', reasonCode: 'core-reason' } });
function state(): GatewayState {
  return { journeyPoint: { scenario: 'premium-journey', pointId: 'fixture-donghu', label: 'Donghu', category: 'Scenic Experience', description: 'Scenic lakeside stop', etaImpactMinutes: 12, revision: 'point' }, speedKph: 40, load: 'normal', connectivity: { mode: 'online', source: 'simulated' }, rearExperience: { mode: 'normal', liveJourney: 'presented', source: 'scenario-fixture' }, proposals: [], journeyStops: [], activeSafetyWarning: null, activeTasks: [], presence: null, connections: { 'center-main': { status: 'connected' }, 'rear-tablet': { status: 'connected' } } as GatewayState['connections'] };
}
test('Manual guide follows actual Core states and never invents consent or a stop', () => {
  const s=state();assert.equal(manualJourneyStep(s).observed,'reset');s.load='high';assert.equal(manualJourneyStep(s).observed,'high');
  s.proposals=[proposal('deferred','DEFER')];assert.equal(manualJourneyStep(s).observed,'request');
  s.proposals=[proposal('awaiting_consent','ASK')];assert.equal(manualJourneyStep(s).observed,null); // HIGH still suppresses consent.
  s.load='normal';assert.equal(manualJourneyStep(s).observed,'normal');assert.match(manualJourneyStep(s).instruction,/中控/);assert.equal(s.journeyStops.length,0);
  s.proposals=[proposal('declined','ASK')];assert.equal(manualJourneyStep(s).observed,'keep-route');assert.equal(s.journeyStops.length,0);
});
test('Manual guide retains HELD until an actual resume state is received', () => {
  const s=state();s.proposals=[proposal('completed','EXECUTE')];s.journeyStops=[{ stopId:'s',placeId:'fixture-donghu',label:'Donghu',addedAt:1,sourceProposalId:'p' }];
  assert.equal(manualJourneyStep(s).observed,'accept');s.connectivity.mode='offline';s.rearExperience.liveJourney='unavailable';assert.equal(manualJourneyStep(s).observed,'offline');
  s.rearExperience.mode='quiet';assert.equal(manualJourneyStep(s).observed,'quiet');s.connectivity.mode='online';s.rearExperience.liveJourney='available_but_held';assert.equal(manualJourneyStep(s,{offlineSeen:true,quietSeen:true}).observed,'restore');assert.equal(manualJourneyStep(s,{offlineSeen:true,quietSeen:true}).step,8);
  assert.equal(manualJourneyStep(s).observed,'quiet'); // HELD alone is not evidence of cloud recovery.
  s.rearExperience.mode='normal';s.rearExperience.liveJourney='presented';s.rearExperience.reasonCode='REAR_RESUME_REQUESTED';assert.equal(manualJourneyStep(s,{offlineSeen:true,quietSeen:true}).observed,'resume');
  assert.notEqual(manualJourneyStep(s).step,9);
});
test('Disconnected or incomplete state produces guidance, no successful observation', () => {
  const s=state();s.connections['center-main'].status='disconnected';assert.equal(manualJourneyStep(s).observed,null);
  s.connections['center-main'].status='connected';s.journeyPoint=null;assert.equal(manualJourneyStep(s).observed,null);
});
