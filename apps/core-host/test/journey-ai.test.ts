import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ModelJourneyAnalysis } from '../../../adapters/local/journey-analysis.js';
import { createJourneyAnalysis } from '../src/journey-ai.js';
import { recommendWholeJourney, type JourneyAnalysisInput } from '../../../packages/core-runtime/src/journey-recommender.js';
import { SimulatedJourneyRecommendationEvidenceSource } from '../../../packages/core-runtime/src/journey-recommendation-fixture.js';
import { CoreRuntime } from '../../../packages/core-runtime/src/core-runtime.js';
const input: JourneyAnalysisInput = { requestText: '沿途餐廳', selected: { placeId: 'known-place', label: '示例餐廳', category: 'restaurant' }, rationale: ['5 min detour'], simulated: true, connectivity: 'offline' };
const reply = (placeId = 'known-place') => new Response(JSON.stringify({ done: true, response: JSON.stringify({ placeId, summary: '根據模擬資料，這個地點適合用餐。' }) }), {status: 200});

test('offline hybrid uses localhost only and reports actual model provenance', async () => {
  let calls = 0;
  const provider = new ModelJourneyAnalysis({mode: 'hybrid', apiKey: 'not-used', fetchImpl: async (url, init) => {
    calls++; assert.equal(new URL(String(url)).hostname, '127.0.0.1');
    const body = JSON.parse(String(init?.body)); assert.equal(body.stream, false); assert.equal(body.think, false); assert.equal(body.model, 'qwen3:4b');
    assert.match(body.prompt, /known-place/); return reply();
  }});
  const result = await provider.analyze(input); assert.equal(calls, 1); assert.equal(result.provider, 'ollama'); assert.equal(result.status, 'completed');
});
test('cloud-only offline makes no network call', async () => {
  const provider = new ModelJourneyAnalysis({mode: 'gemini', fetchImpl: async () => {assert.fail('offline cloud call');}});
  const result = await provider.analyze(input); assert.equal(result.status, 'unavailable');
  if(result.status === 'unavailable') assert.equal(result.errorCode, 'JOURNEY_AI_OFFLINE');
});
test('missing cloud key falls back to installed local model', async () => {
  const provider = new ModelJourneyAnalysis({mode: 'hybrid', apiKey: '', fetchImpl: async () => reply()});
  const result = await provider.analyze({...input, connectivity: 'online'}); assert.equal(result.provider, 'ollama'); assert.equal(result.fallbackReason, 'GEMINI_API_KEY_MISSING');
});
test('invented place and malformed model response cannot alter candidate', async () => {
  for (const response of [reply('invented'), new Response(JSON.stringify({done: true, response: 'invalid'})), new Response('denied', {status:503})]) {
    const result = await new ModelJourneyAnalysis({mode:'local', fetchImpl:async()=>response}).analyze(input); assert.equal(result.status,'unavailable');
  }
});
test('local route rejects hosted Ollama and invalid timeout budgets', () => {
  assert.throws(()=>new ModelJourneyAnalysis({mode:'local',ollamaHost:'https://example.com'}),/MUST_BE_LOCAL/);
  assert.throws(()=>new ModelJourneyAnalysis({mode:'hybrid',cloudTimeoutMs:25000,localTimeoutMs:25000}),/TOTAL_TIMEOUT/);
  assert.equal(createJourneyAnalysis({}),undefined);
  assert.throws(()=>createJourneyAnalysis({AURA_JOURNEY_AI:'bad'}),/INVALID/);
});
test('AI explanation preserves deterministic selection, evidence and consent; no facts means no model call', async () => {
  const runtime = new CoreRuntime({registry:JSON.parse(readFileSync('apps/core-host/config/display-registry.json','utf8'))});
  const message={kind:'journey.recommendation.request' as const,protocolVersion:1 as const,requestId:'test',traceId:'test',requestText:'沿途餐廳'};
  const source=new SimulatedJourneyRecommendationEvidenceSource();
  const base=await recommendWholeJourney({state:runtime.getState(),message,source});
  const enhanced=await recommendWholeJourney({state:runtime.getState(),message,source,analysis:{async analyze(value){return {status:'completed',provider:'ollama',model:'fixture-test',summary:`解釋 ${value.selected.label}`,observedAt:Date.now(),durationMs:1};}}});
  assert.equal(base.status,'proposal'); assert.equal(enhanced.status,'proposal');
  if(base.status==='proposal'&&enhanced.status==='proposal') {
    assert.deepEqual(enhanced.centerProposal,base.centerProposal);assert.equal(enhanced.centerProposal.requiresConsent,true);
    assert.equal(enhanced.recommendation.simulated,true);assert.equal(enhanced.recommendation.aiAnalysis?.provider,'ollama');
  }
  await recommendWholeJourney({state:runtime.getState(),message,analysis:{async analyze(){assert.fail('missing evidence must not call model');}}});
  assert.equal(runtime.getState().journey.stops.length,0);
});
test('valid Gemini response keeps cloud provenance; HTTP authentication failure falls back locally', async () => {
  for (const authorized of [true, false]) {
    let cloudCalls=0, localCalls=0;
    const provider=new ModelJourneyAnalysis({mode:'hybrid',apiKey:'test-key',fetchImpl:async (url)=>{
      if(String(url).includes('127.0.0.1')) {localCalls++;return reply();}
      cloudCalls++;
      if(!authorized) return new Response(JSON.stringify({error:{code:401,message:'unauthorized',status:'UNAUTHENTICATED'}}),{status:401,headers:{'content-type':'application/json'}});
      return new Response(JSON.stringify({candidates:[{content:{role:'model',parts:[{text:JSON.stringify({placeId:input.selected.placeId,summary:'根據提供的模擬資料，這個地點符合用餐需求。'})}]},finishReason:'STOP'}]}),{status:200,headers:{'content-type':'application/json'}});
    }});
    const result=await provider.analyze({...input,connectivity:'online'});
    assert.equal(result.status,'completed'); assert.equal(cloudCalls,1);
    assert.equal(result.provider,authorized?'gemini':'ollama');assert.equal(localCalls,authorized?0:1);
    if(!authorized) assert.equal(result.fallbackReason,'GEMINI_AUTH_FAILED');
  }
});
