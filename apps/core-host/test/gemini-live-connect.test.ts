import assert from "node:assert/strict";
import test from "node:test";
import { GeminiVoiceStreamingAdapter, type GeminiVoiceAdapterOptions } from "../../../adapters/voice/gemini-live-voice-adapter.js";

type LiveSession = Awaited<ReturnType<NonNullable<GeminiVoiceAdapterOptions["liveConnector"]>>>;

test("Gemini Live authentication callback rejects a pending connect immediately", async () => {
  const reasons: string[] = [];
  const adapter = new GeminiVoiceStreamingAdapter({
    apiKey: "test-credential-not-used-by-injected-connector",
    connectTimeoutMs: 1_000,
    liveConnector: (_apiKey, parameters) => {
      queueMicrotask(() => parameters.callbacks.onerror?.(Object.assign(new Error("AUTH_REJECTED"), { message: "AUTH_REJECTED" }) as unknown as ErrorEvent));
      return new Promise(() => undefined);
    },
  });
  assert.equal(adapter.route, "cloud");
  adapter.subscribe((event) => {
    if (event.type === "provider_error") reasons.push(event.reasonCode);
  });

  const startedAt = Date.now();
  await assert.rejects(adapter.connect("auth-error-connect"), { message: "AUTH_REJECTED" });
  assert.ok(Date.now() - startedAt < 500);
  assert.deepEqual(reasons, ["AUTH_REJECTED"]);
  adapter.close();
});

test("a never-resolving Live connect fails at the configured timeout and closes a late session", async () => {
  let resolveConnection: ((session: LiveSession) => void) | undefined;
  let lateSessionClosed = false;
  const adapter = new GeminiVoiceStreamingAdapter({
    apiKey: "test-credential-not-used-by-injected-connector",
    connectTimeoutMs: 15,
    liveConnector: () => new Promise((resolve) => { resolveConnection = resolve; }),
  });

  await assert.rejects(adapter.connect("connect-timeout"), { message: "GEMINI_CONNECT_TIMEOUT" });
  resolveConnection?.({ close: () => { lateSessionClosed = true; } } as unknown as LiveSession);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(lateSessionClosed, true);
  adapter.close();
});

test("closing the adapter cancels an in-flight connection attempt", async () => {
  const adapter = new GeminiVoiceStreamingAdapter({
    apiKey: "test-credential-not-used-by-injected-connector",
    connectTimeoutMs: 1_000,
    liveConnector: () => new Promise(() => undefined),
  });

  const connecting = adapter.connect("close-pending-connect");
  adapter.close();
  await assert.rejects(connecting, { message: "VOICE_SESSION_CLOSED" });
});
