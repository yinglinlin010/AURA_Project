#!/usr/bin/env node
// SIMULATED Window -> Center flow; no provider, navigation, device or visual claims.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--report' || !args[1])) {
  console.error('Usage: node scripts/check-dong-hwa-flow.mjs [--report /tmp/new-report.json]'); process.exit(2);
}
const reportPath = args.length ? resolve(args[1]) : null;
if (reportPath && (reportPath === root || reportPath.startsWith(root + sep))) {
  console.error('REPORT_MUST_BE_OUTSIDE_WORKSPACE'); process.exit(2);
}
const report = { source: 'simulated', scope: 'headless loopback Gateway; touch stands in for Window input',
  placeId: 'simulated-dong-hwa-east-lake', origin: 'window_dong_hwa_demo', freshness: 'unknown',
  providerAccess: false, checks: [], cleanup: false, startedAt: new Date().toISOString() };
let temporary;
let reportAllowed = !reportPath;
let interrupted = false;
const interrupt = () => { interrupted = true; };
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
try {
  if (reportPath) {
    const parent = await realpath(dirname(reportPath)); const workspace = await realpath(root);
    assert.ok(parent !== workspace && !parent.startsWith(workspace + sep), 'REPORT_MUST_BE_OUTSIDE_WORKSPACE');
    reportAllowed = true;
  }
  process.chdir(root);
  temporary = await mkdtemp(join(tmpdir(), 'aura-dong-hwa-'));
  await writeFile(join(temporary, 'package.json'), '{"type":"module"}\n');
  await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
  const config = join(temporary, 'tsconfig.json');
  const tests = ['window-proposal-authority', 'center-consent-authority', 'action-gate-load'];
  await writeFile(config, JSON.stringify({ extends: join(root, 'tsconfig.json'),
    compilerOptions: { outDir: join(temporary, 'compiled'), declaration: false, sourceMap: false, incremental: false,
      typeRoots: [join(root, 'node_modules/@types')] },
    include: [join(root, 'apps/core-host/src/hmi-gateway.ts'), ...tests.map(name => join(root, `packages/core-runtime/test/${name}.test.ts`))] }));
  function run(args) {
    assert.ok(!interrupted, 'INTERRUPTED');
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    if (result.status !== 0 && args[0].endsWith('/typescript/bin/tsc')) console.error(result.stdout);
    if (result.status !== 0) console.error(result.stdout.split('\n').filter(line => /not ok|error:|errorType:|TypeError|ReferenceError/.test(line)).join('\n'));
    assert.equal(result.status, 0, 'ISOLATED_CHILD_FAILED');
    return result.stdout;
  }
  run([join(root, 'node_modules/typescript/bin/tsc'), '-p', config]);
  report.unitTests = tests.map(name => {
    const output = run([join(temporary, 'compiled', `packages/core-runtime/test/${name}.test.js`)]);
    const count = Number(output.match(/# tests (\d+)/)?.[1]); const passed = Number(output.match(/# pass (\d+)/)?.[1]);
    assert.ok(count > 0 && passed === count, 'UNIT_TEST_FAILED'); return { name, count, passed };
  });
  const load = file => import(pathToFileURL(join(temporary, 'compiled', file)).href);
  const { CoreRuntime } = await load('packages/core-runtime/src/core-runtime.js');
  const { HmiGateway } = await load('apps/core-host/src/hmi-gateway.js');
  const WebSocket = createRequire(join(root, 'package.json'))('ws');
  const registry = { version: 1, displays: ['cluster','center','front_passenger','rear','interactive_window'].map(role => ({
    displayId: `${role}-dong-hwa`, deviceId: `${role}-device`, role, protocolVersion: 1, enabled: true,
  })) };
  let serial = 0;
  const nextId = () => `dong-hwa-${++serial}`;
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

  async function withGateway(run) {
    const runtime = new CoreRuntime({ registry });
    const gateway = new HmiGateway({ runtime, registry, host: '127.0.0.1', port: 0 });
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
      async function sharedStops() {
        for (const client of Object.values(clients)) {
          const response = client.wait((message) => message.kind === 'snapshot');
          client.socket.send(JSON.stringify({ kind: 'resync', protocolVersion: 1, sessionId: runtime.sessionId, traceId: nextId() }));
          assert.deepEqual((await response).snapshot.state.journey.stops, stops());
        }
      }
      await run({ runtime, command, consent, setLoad, stops, proposal, sharedStops, clients });
    } finally {
      for (const client of Object.values(clients)) client.socket.terminate();
      await gateway.close();
    }
  }

  const stopRequest = () => ({ proposalId: nextId(), kind: 'ADD_TRIP_STOP', summary: 'SIMULATED 東華東湖',
    targetRole: 'center', priority: 'normal', requiresConsent: true,
    payload: { placeId: report.placeId, label: 'SIMULATED 東華東湖', origin: report.origin, source: 'simulated', freshness: 'unknown' } });
  async function check(name, body) {
    assert.ok(!interrupted, 'INTERRUPTED');
    await withGateway(body);
    report.checks.push({ name, status: 'passed' });
  }
  await check('normal: Window pending, Center receives, approves exactly once; five shared snapshots', async h => {
    await h.setLoad('normal');
    const request = stopRequest();
    const delivered = h.clients.center.wait(m => m.kind === 'event' && m.event?.type === 'action.proposed' && m.event.payload?.proposal?.proposalId === request.proposalId);
    assert.equal((await h.command('interactive_window', { type: 'action.propose', payload: { proposal: request } })).status, 'RECEIVED');
    await delivered;
    assert.equal(h.proposal(request.proposalId).status, 'awaiting_consent'); assert.deepEqual(h.stops(), []);
    const id = nextId();
    assert.equal((await h.consent(request.proposalId, 'approve', 'center', id)).reasonCode, 'JOURNEY_STOP_ADDED');
    assert.equal((await h.consent(request.proposalId, 'approve', 'center', id)).replayed, true);
    assert.equal((await h.consent(request.proposalId, 'approve')).status, 'REJECTED');
    assert.deepEqual(h.stops().map(s => s.placeId), [report.placeId]); await h.sharedStops();
  });
  await check('decline is no-op across all five snapshots', async h => {
    await h.setLoad('normal'); const request = stopRequest();
    await h.command('interactive_window', { type: 'action.propose', payload: { proposal: request } });
    assert.equal((await h.consent(request.proposalId, 'decline')).reasonCode, 'TARGET_ROLE_DECLINED');
    assert.equal(h.proposal(request.proposalId).status, 'declined'); assert.deepEqual(h.stops(), []); await h.sharedStops();
  });
  for (const initial of ['high','unknown']) await check(`${initial}: defer then require fresh Center consent`, async h => {
    if(initial === 'high') await h.setLoad('high');
    const request = stopRequest();
    const receipt = await h.command('interactive_window', { type: 'action.propose', payload: { proposal: request } });
    assert.equal(receipt.reasonCode, initial === 'high' ? 'DRIVER_COGNITIVE_LOAD_HIGH' : 'DRIVER_LOAD_UNAVAILABLE');
    assert.equal(h.proposal(request.proposalId).status,'deferred'); assert.deepEqual(h.stops(),[]);
    await h.setLoad('normal'); assert.equal(h.proposal(request.proposalId).status,'awaiting_consent');
    assert.equal(h.proposal(request.proposalId).consentGranted,false);
    await h.setLoad('high'); await h.consent(request.proposalId,'approve');
    assert.equal(h.proposal(request.proposalId).status,'deferred'); assert.equal(h.proposal(request.proposalId).consentGranted,false);
    await h.setLoad('normal'); assert.deepEqual(h.stops(),[]);
    assert.equal((await h.consent(request.proposalId,'approve')).reasonCode,'JOURNEY_STOP_ADDED');
    assert.equal(h.stops().length,1); await h.sharedStops();
  });
  await check('Window cannot consent, spoof telemetry/load/connectivity/safety; Cluster read-only', async h => {
    await h.setLoad('normal'); const request=stopRequest();
    await h.command('interactive_window',{type:'action.propose',payload:{proposal:request}});
    const commands = [
      ...['approve','decline'].map(decision => ({type:'action.consent',payload:{proposalId:request.proposalId,decision}})),
      {type:'vehicle.telemetry.report',payload:{vehicle:{speedKph:99}}},
      {type:'driver.cognitive_load.report',payload:{level:'low',timestamp:Date.now()}},
      {type:'connectivity.mode.report',payload:{mode:'offline',evidence:'simulated'}},
      {type:'action.propose',payload:{proposal:{...stopRequest(),targetRole:'interactive_window'}}},
      {type:'action.propose',payload:{proposal:{...stopRequest(),requiresConsent:false}}},
      {type:'action.propose',payload:{proposal:{...stopRequest(),kind:'WARN'}}},
      {type:'action.propose',payload:{proposal:{...stopRequest(),priority:'urgent'}}},
    ];
    for(const role of ['interactive_window','cluster']) for(const command of commands) {
      const before=structuredClone(h.runtime.getState());
      assert.equal((await h.command(role,command)).status,'REJECTED'); assert.deepEqual(h.runtime.getState(),before);
    }
    const before=structuredClone(h.runtime.getState());
    assert.equal((await h.command('cluster',{type:'action.propose',payload:{proposal:stopRequest()}})).reasonCode,'CLUSTER_READ_ONLY');
    assert.deepEqual(h.runtime.getState(),before); await h.sharedStops();
  });
  await check('Window and Cluster voice messages rejected before provider availability', async h => {
    for(const role of ['interactive_window','cluster']) for(const kind of ['voice.start','voice.text','voice.stop']) {
      const traceId=nextId(); const before=structuredClone(h.runtime.getState());
      const response=h.clients[role].wait(m=>m.kind==='error' && m.traceId===traceId);
      h.clients[role].socket.send(JSON.stringify({kind,protocolVersion:1,traceId,...(kind==='voice.text'?{text:'SIMULATED test'}:{})}));
      assert.equal((await response).code,'VOICE_ROLE_NOT_ALLOWED'); assert.deepEqual(h.runtime.getState(),before);
    }
    await h.sharedStops();
  });
  assert.ok(!interrupted,'INTERRUPTED'); report.status='passed';
} catch(error) {
  report.status='failed'; report.error=/^[A-Z_]+$/.test(error.message??'')?error.message:'CHECK_FAILED'; process.exitCode=1;
} finally {
  if(temporary) {try {await rm(temporary,{recursive:true,force:true}); report.cleanup=true;} catch {report.status='failed';report.error='CLEANUP_FAILED';process.exitCode=1;}}
  process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
  report.finishedAt=new Date().toISOString(); const output=JSON.stringify(report,null,2)+'\n'; console.log(output);
  if(reportPath && reportAllowed) try {await writeFile(reportPath,output,{flag:'wx'});} catch {console.error('REPORT_WRITE_FAILED');process.exitCode=1;}
}
