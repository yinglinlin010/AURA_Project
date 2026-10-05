#!/usr/bin/env node
// Isolated simulator transport evidence; no provider, existing Gateway or UI access.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--report' || !args[1])) {
  console.error('Usage: node scripts/check-independent-clients.mjs [--report /tmp/new-report.json]');
  process.exit(2);
}
const reportPath = args.length ? resolve(args[1]) : null;
if (reportPath && (reportPath === root || reportPath.startsWith(root + sep))) {
  console.error('REPORT_MUST_BE_OUTSIDE_WORKSPACE');
  process.exit(2);
}
const report = { source: 'simulated', scope: 'five independent Node processes; not physical devices or browser UI',
  providerAccess: false, startedAt: new Date().toISOString(), transportTests: null, clients: [], cleanup: false };
const children = new Map();
let temporary;
let gateway;
let interrupted = false;
let reportAllowed = !reportPath;
const interrupt = () => {
  interrupted = true;
  for (const child of children.keys()) child.kill('SIGTERM');
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

function run(commandArgs, timeoutMs = 15_000) {
  if (interrupted) return Promise.reject(new Error('INTERRUPTED'));
  const child = spawn(process.execPath, commandArgs, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const completion = new Promise((resolveRun, rejectRun) => {
    let stdout = '';
    let stderr = '';
    let failure;
    let size = 0;
    const terminate = (code) => { failure = new Error(code); child.kill('SIGKILL'); };
    const timer = setTimeout(() => terminate('CHILD_TIMEOUT'), timeoutMs);
    const capture = (target) => (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) { terminate('CHILD_OUTPUT_LIMIT'); return; }
      if (target === 'stdout') stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.on('data', capture('stdout'));
    child.stderr.on('data', capture('stderr'));
    child.once('error', () => { failure = new Error('CHILD_SPAWN_FAILED'); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      children.delete(child);
      if (failure) rejectRun(failure);
      else if (code !== 0 || signal || interrupted) rejectRun(new Error(interrupted ? 'INTERRUPTED' : 'CHILD_FAILED'));
      else resolveRun({ pid: child.pid, stdout, stderr });
    });
  });
  children.set(child, completion);
  return completion;
}

try {
  process.chdir(root); // Gateway schema/registry fixtures resolve from the repository.
  if (reportPath) {
    const parent = await realpath(dirname(reportPath));
    const workspace = await realpath(root);
    assert.ok(parent !== workspace && !parent.startsWith(workspace + sep), 'REPORT_MUST_BE_OUTSIDE_WORKSPACE');
    reportAllowed = true;
  }
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  report.repository = { revision: revision.status === 0 ? revision.stdout.trim() : null,
    workingTreeClean: status.status === 0 && !status.stdout.trim() };
  temporary = await mkdtemp(join(tmpdir(), 'aura-independent-clients-'));
  await writeFile(join(temporary, 'package.json'), '{"type":"module"}\n');
  await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
  const config = join(temporary, 'tsconfig.json');
  await writeFile(config, JSON.stringify({ extends: join(root, 'tsconfig.json'),
    compilerOptions: { outDir: join(temporary, 'compiled'), declaration: false, sourceMap: false,
      incremental: false, typeRoots: [join(root, 'node_modules/@types')] },
    include: [join(root, 'apps/web-simulator/src/core/independent-client-transport.test.ts'),
      join(root, 'apps/web-simulator/tools/independent-client-smoke.ts'),
      join(root, 'apps/core-host/src/hmi-gateway.ts')] }));
  await run([join(root, 'node_modules/typescript/bin/tsc'), '-p', config], 60_000);
  const compiled = (path) => join(temporary, 'compiled', path);
  // node:test also runs when imported directly, avoiding an extra runner child.
  const tests = await run([compiled('apps/web-simulator/src/core/independent-client-transport.test.js')]);
  const count = Number(tests.stdout.match(/# tests (\d+)/)?.[1]);
  const passed = Number(tests.stdout.match(/# pass (\d+)/)?.[1]);
  assert.equal(count, 13, 'TRANSPORT_TEST_COUNT');
  assert.equal(passed, count, 'TRANSPORT_TEST_FAILURE');
  report.transportTests = { count, passed };
  const load = (path) => import(pathToFileURL(compiled(path)).href);
  const { CoreRuntime } = await load('packages/core-runtime/src/core-runtime.js');
  const { HmiGateway } = await load('apps/core-host/src/hmi-gateway.js');
  const registry = JSON.parse(await readFile(join(root, 'apps/core-host/config/display-registry.json'), 'utf8'));
  const registrations = registry.displays.filter((display) => display.enabled);
  assert.deepEqual(registrations.map((display) => display.role).sort(),
    ['cluster', 'center', 'front_passenger', 'rear', 'interactive_window'].sort(), 'FIVE_ROLES_REQUIRED');
  const runtime = new CoreRuntime({ registry });
  gateway = new HmiGateway({ runtime, registry, host: '127.0.0.1', port: 0 });
  await gateway.start();
  assert.ok(gateway.address()?.startsWith('ws://127.0.0.1:'), 'LOOPBACK_GATEWAY_REQUIRED');
  const results = await Promise.allSettled(registrations.map(async (display) => {
    const result = await run([compiled('apps/web-simulator/tools/independent-client-smoke.js'),
      '--url', gateway.address(), '--display-id', display.displayId, '--reconnect-once']);
    const messages = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
    const ready = messages.filter((message) => message.status === 'ready');
    assert.equal(ready.length, 2, 'TWO_READY_SNAPSHOTS_REQUIRED');
    for (const message of messages) {
      assert.equal(message.simulatorOnly, true, 'SIMULATOR_METADATA_REQUIRED');
      assert.equal(message.displayId, display.displayId, 'DISPLAY_ID_MISMATCH');
      assert.ok(Object.keys(message).every((key) => ['simulatorOnly', 'displayId', 'role', 'status',
        'sessionId', 'sequence', 'error', 'result', 'checks'].includes(key)), 'METADATA_ONLY');
    }
    for (const message of ready) {
      assert.equal(message.role, display.role, 'ROLE_MISMATCH');
      assert.ok(typeof message.sessionId === 'string' && message.sessionId.length > 0, 'SESSION_REQUIRED');
      assert.ok(Number.isSafeInteger(message.sequence), 'SEQUENCE_REQUIRED');
    }
    // The probe emits a final disconnected state while releasing its socket.
    const finals = messages.filter((message) => message.result !== undefined);
    assert.equal(finals.length, 1, 'ONE_RESULT_REQUIRED');
    const final = finals[0];
    assert.equal(final.result, 'passed', 'CLIENT_NOT_PASSED');
    assert.deepEqual(final.checks, ['welcome-identity', 'protocol-version', 'session-snapshot', 'explicit-reconnect']);
    return { displayId: display.displayId, role: display.role, pid: result.pid,
      ready: ready.map(({ sessionId, sequence }) => ({ sessionId, sequence })), checks: final.checks };
  }));
  report.clients = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  if (results.some((result) => result.status === 'rejected')) throw new Error('INDEPENDENT_CLIENT_FAILED');
  assert.equal(new Set(report.clients.map((client) => client.pid)).size, 5, 'FIVE_DISTINCT_PROCESSES_REQUIRED');
  assert.ok(report.clients.every((client) => Number.isInteger(client.pid)), 'PROCESS_ID_REQUIRED');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  // No stdout/stderr, snapshots, raw provider payloads or user data in durable reports.
  report.error = /^[A-Z_]+$/.test(error.message ?? '') ? error.message : 'CHECK_FAILED';
  process.exitCode = 1;
} finally {
  try {
    const completions = [...children.values()];
    for (const child of children.keys()) child.kill('SIGKILL');
    await Promise.allSettled(completions);
    try { if (gateway) await gateway.close(); }
    finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
    report.cleanup = true;
  } catch {
    report.status = 'failed'; report.error = 'CLEANUP_FAILED'; process.exitCode = 1;
  }
  process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
  report.finishedAt = new Date().toISOString();
  const output = `${JSON.stringify(report, null, 2)}\n`;
  console.log(output);
  if (reportPath && reportAllowed) {
    try { await writeFile(reportPath, output, { flag: 'wx' }); }
    catch { console.error('REPORT_WRITE_FAILED'); process.exitCode = 1; }
  }
}
