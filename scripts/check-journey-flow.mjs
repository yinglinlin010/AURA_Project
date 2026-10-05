#!/usr/bin/env node
// SIMULATED, headless Gateway checks. Never connect to an existing host or provider.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--report')) {
  console.error('Usage: node scripts/check-journey-flow.mjs [--report /tmp/report.json]');
  process.exit(2);
}
const reportPath = args.length ? resolve(args[1]) : null;
// Reports may not overwrite project files, including preserved user artifacts.
if (reportPath && (reportPath === root || reportPath.startsWith(`${root}/`))) {
  console.error('REPORT_MUST_BE_OUTSIDE_WORKSPACE');
  process.exit(2);
}
const report = { source: 'simulated', scope: 'isolated headless Gateway; no visual acceptance',
  routePreviewFixture: 'SIMULATED provider-shaped payload; source=api is required by the existing contract, not live provider evidence',
  startedAt: new Date().toISOString(), checks: [] };
let temporary;
try {
  temporary = await mkdtemp(join(tmpdir(), 'aura-journey-flow-'));
  await writeFile(join(temporary, 'package.json'), '{"type":"module"}\n');
  await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
  // Compile only the owned harness dependencies; no shared dist or dist-test writes.
  const config = join(temporary, 'tsconfig.json');
  await writeFile(config, JSON.stringify({ extends: join(root, 'tsconfig.json'),
    compilerOptions: { outDir: join(temporary, 'compiled'), declaration: false, sourceMap: false, incremental: false },
    include: [join(root, 'apps/core-host/src/hmi-gateway.ts'),
      join(root, 'packages/core-runtime/src/journey-recommendation-fixture.ts')] }));
  const compiler = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config],
    { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(compiler.status, 0, `isolated compilation failed: ${compiler.error ?? ''}\n${compiler.stdout}${compiler.stderr}`);
  const loadModule = (file) => import(pathToFileURL(join(temporary, 'compiled', file)).href);
  const { CoreRuntime } = await loadModule('packages/core-runtime/src/core-runtime.js');
  const { HmiGateway } = await loadModule('apps/core-host/src/hmi-gateway.js');
  const { SimulatedJourneyRecommendationEvidenceSource } = await loadModule('packages/core-runtime/src/journey-recommendation-fixture.js');
  const WebSocket = createRequire(join(root, 'package.json'))('ws');
  process.chdir(root); // The existing fixture resolves from the project, without provider access.
  const registry = { version: 1, displays: ['center', 'front_passenger', 'rear'].map((role) => ({
    displayId: `${role}-journey-check`, deviceId: `${role}-device`, role, protocolVersion: 1, enabled: true,
  })) };
  let serial = 0;
  const nextId = () => `journey-check-${++serial}`;
  const fixture = new SimulatedJourneyRecommendationEvidenceSource();

  async function connect(address, registration) {
    const socket = new WebSocket(address);
    const queue = [];
    const pending = new Set();
    let failure;
    function fail(error) {
      failure = error;
      for (const waiter of [...pending]) waiter.reject(error);
    }
    socket.on('error', fail);
    socket.on('close', () => fail(new Error('GATEWAY_SOCKET_CLOSED')));
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        const waiter = [...pending].find((item) => item.predicate(message));
        if (waiter) waiter.resolve(message);
        else queue.push(message);
      } catch (error) { fail(error); }
    });
    function wait(predicate) {
      const index = queue.findIndex(predicate);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      if (failure) return Promise.reject(failure);
      return new Promise((resolveWait, rejectWait) => {
        const cleanup = () => { clearTimeout(timer); pending.delete(waiter); };
        const waiter = { predicate, resolve: (value) => { cleanup(); resolveWait(value); },
          reject: (error) => { cleanup(); rejectWait(error); } };
        const timer = setTimeout(() => waiter.reject(new Error(`GATEWAY_MESSAGE_TIMEOUT; queued kinds/codes: ${queue.map((m) => `${m.kind}:${m.code ?? ''}`).join(',')}`)), 3000);
        pending.add(waiter);
      });
    }
    try {
      await new Promise((resolveOpen, rejectOpen) => {
        const timer = setTimeout(() => { socket.terminate(); rejectOpen(new Error('GATEWAY_OPEN_TIMEOUT')); }, 3000);
        socket.once('open', () => { clearTimeout(timer); resolveOpen(); });
        socket.once('error', (error) => { clearTimeout(timer); rejectOpen(error); });
      });
      socket.send(JSON.stringify({ kind: 'register', protocolVersion: 1, displayId: registration.displayId, deviceId: registration.deviceId, traceId: nextId() }));
      const welcome = await wait((message) => message.kind === 'welcome');
      assert.equal(welcome.role, registration.role);
      await wait((message) => message.kind === 'snapshot');
      return { socket, registration, wait };
    } catch (error) { socket.terminate(); throw error; }
  }

  async function withGateway(source, run) {
    const runtime = new CoreRuntime({ registry });
    const gateway = new HmiGateway({ runtime, registry, host: '127.0.0.1', port: 0,
      ...(source ? { journeyRecommendations: source } : {}) });
    const clients = {};
    await gateway.start();
    try {
      const address = gateway.address();
      assert.ok(address && new URL(address).hostname === '127.0.0.1');
      for (const registration of registry.displays) clients[registration.role] = await connect(address, registration);
      async function command(role, command, id = nextId()) {
        const client = clients[role];
        const envelope = { protocolVersion: 1, kind: 'command', messageId: `message-${id}`, commandId: id,
          sessionId: runtime.sessionId, traceId: id, sentAt: Date.now(),
          sender: { displayId: client.registration.displayId, deviceId: client.registration.deviceId }, command };
        const response = client.wait((message) => message.kind === 'ack' && message.receipt?.commandId === id);
        client.socket.send(JSON.stringify({ kind: 'command', envelope }));
        return (await response).receipt;
      }
      const consent = (proposalId, decision, role = 'center', id) =>
        command(role, { type: 'action.consent', payload: { proposalId, decision } }, id);
      const setLoad = async (level) => {
        const receipt = await command('center', { type: 'driver.cognitive_load.report',
          payload: { level, timestamp: Date.now(), confidence: 1 } });
        assert.equal(receipt.status, 'RECEIVED');
      };
      const stops = () => structuredClone(runtime.getState().journey.stops);
      const proposal = (id) => runtime.getState().activeProposals.find((item) => item.proposalId === id);
      async function recommend(text, role = 'center') {
        const requestId = nextId();
        const client = clients[role];
        const response = client.wait((message) =>
          (message.kind === 'journey.recommendation.result' && message.requestId === requestId) ||
          (message.kind === 'error' && message.traceId === requestId));
        client.socket.send(JSON.stringify({ kind: 'journey.recommendation.request', protocolVersion: 1,
          requestId, traceId: requestId, requestText: text }));
        return response;
      }
      async function sharedStops() {
        for (const client of Object.values(clients)) {
          const response = client.wait((message) => message.kind === 'snapshot');
          client.socket.send(JSON.stringify({ kind: 'resync', protocolVersion: 1, sessionId: runtime.sessionId, traceId: nextId() }));
          assert.deepEqual((await response).snapshot.state.journey.stops, stops());
        }
      }
      await run({ runtime, command, consent, setLoad, stops, proposal, recommend, sharedStops });
    } finally {
      for (const client of Object.values(clients)) client.socket.terminate();
      await gateway.close();
    }
  }
  const stopRequest = () => ({ proposalId: nextId(), kind: 'ADD_TRIP_STOP', summary: 'SIMULATED rest stop',
    targetRole: 'center', priority: 'secondary', requiresConsent: true,
    payload: { placeId: 'simulated-rest-stop', label: 'SIMULATED REST STOP', origin: 'rear_simulator', source: 'simulated', freshness: 'unknown' } });
  async function check(name, run) {
    const start = Date.now();
    try { await run(); report.checks.push({ name, status: 'passed', durationMs: Date.now() - start }); }
    catch (error) { report.checks.push({ name, status: 'failed', error: error.stack ?? String(error) }); throw error; }
  }
  await check('Passenger route-preview approve/decline leave Journey unchanged', () => withGateway(null, async (h) => {
    await h.setLoad('normal');
    for (const decision of ['approve', 'decline']) {
      const before = h.stops();
      const request = { proposalId: nextId(), kind: 'SHOW_INFORMATION', summary: 'SIMULATED Passenger route preview',
        targetRole: 'center', priority: 'secondary', requiresConsent: true,
        payload: { discoveryMode: 'route_preview', placeLabel: 'SIMULATED destination', source: 'api',
          placeProvider: 'mapbox-search-box', placeObservedAt: Date.now(), placeFreshness: 'fresh',
          placeAttribution: 'SIMULATED contract fixture; no provider request',
          provider: 'mapbox-directions-v5', freshness: 'fresh', observedAt: Date.now(),
          attribution: 'SIMULATED contract fixture; no provider request', attributionUrl: 'https://example.invalid/simulated-fixture',
          routeDistanceMeters: 1200, routeDurationSeconds: 300 } };
      assert.equal((await h.command('front_passenger', { type: 'action.propose', payload: { proposal: request } })).status, 'RECEIVED');
      assert.equal(h.proposal(request.proposalId).status, 'awaiting_consent');
      assert.deepEqual(h.stops(), before);
      assert.equal((await h.consent(request.proposalId, decision)).status, 'RECEIVED');
      assert.equal(h.proposal(request.proposalId).status, decision === 'approve' ? 'completed' : 'declined');
      assert.deepEqual(h.stops(), before);
      await h.sharedStops();
    }
  }));
  await check('Rear proposal, role rejection, Center approval exactly once, decline no-op', () => withGateway(null, async (h) => {
    await h.setLoad('normal');
    const request = stopRequest();
    assert.equal((await h.command('rear', { type: 'action.propose', payload: { proposal: request } })).status, 'RECEIVED');
    assert.deepEqual(h.stops(), []);
    for (const role of ['front_passenger', 'rear']) for (const decision of ['approve', 'decline']) {
      const before = structuredClone(h.runtime.getState());
      const receipt = await h.consent(request.proposalId, decision, role);
      assert.equal(receipt.status, 'REJECTED');
      assert.equal(receipt.reasonCode, 'JOURNEY_CONSENT_REQUIRES_CENTER');
      assert.deepEqual(h.runtime.getState(), before);
    }
    const id = nextId();
    assert.equal((await h.consent(request.proposalId, 'approve', 'center', id)).reasonCode, 'JOURNEY_STOP_ADDED');
    assert.equal((await h.consent(request.proposalId, 'approve', 'center', id)).replayed, true);
    assert.equal(h.stops().length, 1);
    const rejected = stopRequest();
    const before = h.stops();
    await h.command('rear', { type: 'action.propose', payload: { proposal: rejected } });
    assert.equal((await h.consent(rejected.proposalId, 'decline')).reasonCode, 'TARGET_ROLE_DECLINED');
    assert.equal(h.proposal(rejected.proposalId).status, 'declined');
    assert.deepEqual(h.stops(), before);
    await h.sharedStops();
  }));
  for (const initial of ['high', 'unknown']) await check(`${initial} load defers and release requires fresh consent`, () => withGateway(null, async (h) => {
    if (initial !== 'unknown') await h.setLoad(initial);
    const request = stopRequest();
    const receipt = await h.command('rear', { type: 'action.propose', payload: { proposal: request } });
    assert.equal(receipt.reasonCode, initial === 'high' ? 'DRIVER_COGNITIVE_LOAD_HIGH' : 'DRIVER_LOAD_UNAVAILABLE');
    assert.equal(h.proposal(request.proposalId).status, 'deferred');
    assert.deepEqual(h.stops(), []);
    await h.setLoad('low');
    assert.equal(h.proposal(request.proposalId).status, 'awaiting_consent');
    assert.equal(h.proposal(request.proposalId).consentGranted, false);
    assert.deepEqual(h.stops(), []);
    // Raise load after release: a driver approval must not become a reusable authorization.
    await h.setLoad('high');
    await h.consent(request.proposalId, 'approve');
    assert.equal(h.proposal(request.proposalId).status, 'deferred');
    assert.equal(h.proposal(request.proposalId).consentGranted, false);
    await h.setLoad('normal');
    assert.equal(h.proposal(request.proposalId).status, 'awaiting_consent');
    assert.deepEqual(h.stops(), []);
    assert.equal((await h.consent(request.proposalId, 'approve')).reasonCode, 'JOURNEY_STOP_ADDED');
    assert.equal(h.stops().length, 1);
    await h.sharedStops();
  }));
  // Deliberately balanced simulated candidates force the useful-clarification branch.
  const clarificationSource = { async getEvidence(input) {
    const evidence = await fixture.getEvidence(input);
    if (!evidence) return null;
    evidence.options = evidence.options.map((candidate, index) => {
      const factor = (value) => ({ value, source: 'simulated', sourceLabel: 'journey-check balanced fixture',
        observedAt: input.now ?? Date.now(), freshness: 'fresh' });
      return { placeId: candidate.placeId, label: candidate.label, category: candidate.category,
        identityEvidence: candidate.identityEvidence, poiQuality: factor(4), detourMinutes: factor(10),
        nearbyCharging: factor([]), passengerDropoff: factor({ access: index ? 'street' : 'designated', distanceToEntranceMeters: index ? 450 : 10 }) };
    });
    return evidence;
  } };
  const mainText = 'Find a place convenient for Mom to get out, with charging nearby';
  function assertProvenance(result) {
    assert.equal(result.recommendation.simulated, true);
    assert.ok(result.recommendation.evidence.length);
    for (const item of [...result.recommendation.evidence, ...result.recommendation.wholeJourneyContext]) {
      assert.equal(item.source, 'simulated');
      assert.ok(Number.isFinite(item.observedAt));
      assert.equal(item.freshness, 'fresh');
    }
    assert.equal(result.centerProposal.targetRole, 'center');
    assert.equal(result.centerProposal.requiresConsent, true);
  }
  await check('Main story useful clarification preserves unknown facts; explicit preference returns proposal', () => withGateway(clarificationSource, async (h) => {
    await h.setLoad('normal');
    const before = structuredClone(h.runtime.getState());
    const result = await h.recommend(mainText);
    assert.equal(result.status, 'clarification_required');
    assert.equal(result.clarification.simulated, true);
    for (const fact of ['age', 'disability', 'mobilityNeed', 'dropoffPreference']) assert.equal(result.clarification.facts[fact].status, 'unknown');
    assert.equal('centerProposal' in result, false);
    assert.deepEqual(h.runtime.getState(), before);
    const answered = await h.recommend(`${mainText}; entrance proximity matters`);
    assert.equal(answered.status, 'proposal');
    assertProvenance(answered);
    assert.deepEqual(h.runtime.getState(), before);
    await h.command('center', { type: 'action.propose', payload: { proposal: answered.centerProposal } });
    assert.equal((await h.consent(answered.centerProposal.proposalId, 'decline')).reasonCode, 'TARGET_ROLE_DECLINED');
    assert.deepEqual(h.stops(), []);
  }));
  await check('Unmodified main-story fixture, recommendation role denial and Center commit', () => withGateway(fixture, async (h) => {
    await h.setLoad('normal');
    const before = structuredClone(h.runtime.getState());
    for (const role of ['front_passenger', 'rear']) {
      assert.equal((await h.recommend(mainText, role)).code, 'JOURNEY_RECOMMENDATION_ROLE_NOT_ALLOWED');
      assert.deepEqual(h.runtime.getState(), before);
    }
    const result = await h.recommend(`${mainText}; entrance proximity matters`);
    assert.equal(result.status, 'proposal');
    assertProvenance(result);
    assert.deepEqual(h.runtime.getState(), before);
    const submitId = nextId();
    const command = { type: 'action.propose', payload: { proposal: result.centerProposal } };
    assert.equal((await h.command('center', command, submitId)).status, 'RECEIVED');
    assert.equal((await h.command('center', command, submitId)).replayed, true);
    assert.deepEqual(h.stops(), []);
    assert.equal((await h.consent(result.centerProposal.proposalId, 'approve')).reasonCode, 'JOURNEY_STOP_ADDED');
    assert.deepEqual(h.stops().map((stop) => stop.placeId), [result.centerProposal.payload.placeId]);
    await h.sharedStops();
  }));
  await check('Missing evidence source abstains without changing state', () => withGateway(null, async (h) => {
    const before = structuredClone(h.runtime.getState());
    const result = await h.recommend(mainText);
    assert.equal(result.status, 'abstained');
    assert.equal(result.reasonCode, 'WHOLE_JOURNEY_EVIDENCE_SOURCE_UNAVAILABLE');
    assert.deepEqual(h.runtime.getState(), before);
  }));
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  const output = `${JSON.stringify(report, null, 2)}\n`;
  console.log(output);
  if (reportPath) {
    try { await writeFile(reportPath, output, { flag: 'wx' }); }
    catch (error) { console.error(`REPORT_WRITE_FAILED: ${error.message}`); process.exitCode = 1; }
  }
}
