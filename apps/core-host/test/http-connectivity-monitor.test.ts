import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { HttpConnectivityMonitor, type CoreConnectivityUpdate } from "../../../adapters/connectivity/http-connectivity-monitor.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";

test("health probe reports degraded until two healthy responses, then online", async () => {
  const updates: CoreConnectivityUpdate[] = [];
  const monitor = new HttpConnectivityMonitor({
    endpoint: "https://health.example.test/ready",
    report: (update) => updates.push(update),
    fetchImplementation: async () => new Response(null, { status: 204 }),
  });

  await monitor.probeOnce();
  await monitor.probeOnce();

  assert.deepEqual(updates.map(({ mode, evidence, source, freshness }) => ({ mode, evidence, source, freshness })), [
    { mode: "degraded", evidence: "HTTP_PROBE_RECOVERING", source: "api", freshness: "fresh" },
    { mode: "online", evidence: "HTTP_PROBE_HEALTHY", source: "api", freshness: "fresh" },
  ]);
  assert.notEqual(updates[0]?.traceId, updates[1]?.traceId);
  assert.ok(updates.every((update) => !JSON.stringify(update).includes("health.example.test")));
  await monitor.stop();
});

test("configured probe performs real HEAD requests against a local HTTP health endpoint", async () => {
  const methods: string[] = [];
  const server = createServer((request, response) => {
    methods.push(request.method ?? "");
    response.writeHead(204).end();
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const runtime = new CoreRuntime();
  const monitor = new HttpConnectivityMonitor({
    endpoint: `http://127.0.0.1:${address.port}/health`,
    report: (update) => runtime.updateConnectivity(update),
  });
  try {
    await monitor.probeOnce();
    await monitor.probeOnce();
    assert.deepEqual(methods, ["HEAD", "HEAD"]);
    assert.equal(runtime.getState().connectivity.mode, "online");
    assert.equal(runtime.getState().connectivity.source, "api");
    assert.equal(runtime.getState().connectivity.evidence, "HTTP_PROBE_HEALTHY");
  } finally {
    await monitor.stop();
    await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  }
});

test("only consecutive network failures mark the configured probe offline", async () => {
  const updates: CoreConnectivityUpdate[] = [];
  let outcome: "failure" | "healthy" = "failure";
  const monitor = new HttpConnectivityMonitor({
    endpoint: "https://health.example.test/ready",
    report: (update) => updates.push(update),
    fetchImplementation: async () => {
      if (outcome === "failure") throw new TypeError("network unavailable");
      return new Response(null, { status: 204 });
    },
  });

  await monitor.probeOnce();
  await monitor.probeOnce();
  await monitor.probeOnce();
  assert.deepEqual(updates.map((update) => update.mode), ["degraded", "degraded", "offline"]);
  assert.equal(updates[2]?.evidence, "HTTP_PROBE_UNREACHABLE");

  outcome = "healthy";
  await monitor.probeOnce();
  await monitor.probeOnce();
  assert.deepEqual(updates.slice(3).map((update) => update.mode), ["degraded", "online"]);
  await monitor.stop();
});

test("an HTTP error means degraded service, not network offline", async () => {
  const updates: CoreConnectivityUpdate[] = [];
  const monitor = new HttpConnectivityMonitor({
    endpoint: "https://health.example.test/ready",
    report: (update) => updates.push(update),
    fetchImplementation: async () => new Response(null, { status: 503 }),
  });

  for (let attempt = 0; attempt < 4; attempt++) await monitor.probeOnce();
  assert.ok(updates.every((update) => update.mode === "degraded"));
  assert.ok(updates.every((update) => update.evidence === "HTTP_PROBE_UNHEALTHY"));
  await monitor.stop();
});

test("endpoint validation rejects credentials, query strings, and non-HTTP schemes", () => {
  const report = () => undefined;
  for (const endpoint of [
    "file:///etc/passwd",
    "https://user:pass@health.example.test/ready",
    "https://health.example.test/ready?token=secret",
  ]) {
    assert.throws(() => new HttpConnectivityMonitor({ endpoint, report }), { message: "INVALID_CONNECTIVITY_ENDPOINT" });
  }
});

test("stopping an in-flight probe aborts it without publishing stale offline evidence", async () => {
  const updates: CoreConnectivityUpdate[] = [];
  const monitor = new HttpConnectivityMonitor({
    endpoint: "https://health.example.test/ready",
    timeoutMs: 250,
    report: (update) => updates.push(update),
    fetchImplementation: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  });

  const pending = monitor.probeOnce();
  await monitor.stop();
  await pending;
  assert.deepEqual(updates, []);
});

test("a health probe timeout counts as a network failure", async () => {
  const updates: CoreConnectivityUpdate[] = [];
  const monitor = new HttpConnectivityMonitor({
    endpoint: "https://health.example.test/ready",
    timeoutMs: 250,
    failureThreshold: 1,
    report: (update) => updates.push(update),
    fetchImplementation: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  });

  await monitor.probeOnce();
  assert.equal(updates[0]?.mode, "offline");
  assert.equal(updates[0]?.evidence, "HTTP_PROBE_UNREACHABLE");
  await monitor.stop();
});
