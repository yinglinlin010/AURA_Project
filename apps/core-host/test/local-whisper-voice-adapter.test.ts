import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LocalWhisperVoiceAdapter,
  localVoiceInternals,
  type VoiceProcessRunner,
  type VoiceProcessResult,
} from "../../../adapters/voice/local-whisper-voice-adapter.js";

const ok = (stdout = ""): VoiceProcessResult => ({ stdout: Buffer.from(stdout), stderr: Buffer.alloc(0), exitCode: 0 });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "aura-local-voice-test-"));
  const model = join(directory, "model with spaces.ggml");
  await writeFile(model, "test-only placeholder; not a speech model");
  return { directory, model };
}

function frame(level: number, bytes = 640): Buffer {
  const result = Buffer.alloc(bytes);
  for (let offset = 0; offset + 1 < bytes; offset += 2) result.writeInt16LE(level, offset);
  return result;
}

async function waitFor(events: Array<{ type: string }>, type: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (events.some((event) => event.type === type)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${type}; saw ${events.map((event) => event.type).join(",")}`);
}

test("local speech passes PCM to whisper and emits transcript plus converted PCM with safe argv", async () => {
  const { directory, model } = await fixture();
  const commands: Array<{ command: string; args: readonly string[] }> = [];
  const spoken = "turn volume up; $(touch /tmp/not-executed)";
  const candidate = {
    kind: "CHANGE_CABIN_SETTING",
    summary: "Increase cabin audio volume",
    targetRole: "center",
    priority: "normal",
    requiresConsent: true,
    payload: { setting: "volume", direction: "up" },
  };
  const runner: VoiceProcessRunner = {
    async run(command, args) {
      commands.push({ command, args });
      if (command === "whisper tool") return ok(spoken);
      if (command === "say tool") {
        await writeFile(args[1]!, "fixture-aiff");
        return ok();
      }
      if (command === "afconvert tool") {
        await writeFile(args[7]!, localVoiceInternals.makeWav(Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]), 24_000));
        return ok();
      }
      return { ...ok(), exitCode: 127 };
    },
  };
  const adapter = new LocalWhisperVoiceAdapter({ modelPath: model, whisperCli: "whisper tool", sayCommand: "say tool", afconvertCommand: "afconvert tool", sayVoice: "Ting-Ting", platform: "darwin", runner, silenceMs: 100, candidateForTranscript: async (text) => { assert.equal(text, spoken); await Promise.resolve(); return candidate; } });
  const events: Array<Record<string, unknown>> = [];
  adapter.subscribe((event) => events.push(event));
  try {
    await adapter.connect("local-test");
    adapter.sendAudioChunk(frame(1000));
    for (let i = 0; i < 5; i += 1) adapter.sendAudioChunk(frame(0));
    await waitFor(events as Array<{ type: string }>, "turn_complete");

    assert.equal(events.find((event) => event.type === "input_transcription")?.text, spoken);
    assert.deepEqual(events.find((event) => event.type === "proposal_candidate"), { type: "proposal_candidate", candidate, traceId: "local-test", route: "local" });
    assert.equal(events.find((event) => event.type === "output_transcription")?.text, `I heard: ${spoken}`);
    const audio = events.find((event) => event.type === "audio_chunk");
    assert.deepEqual(audio?.data, Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]));
    assert.equal(audio?.mimeType, "audio/pcm;rate=24000");
    assert.deepEqual(commands[0]?.args.slice(0, 3), ["-m", model, "-f"]);
    assert.deepEqual(commands[0]?.args.slice(-4), ["-l", "auto", "-nt", "-np"]);
    assert.deepEqual(commands[1]?.args.slice(0, 2), ["-v", "Ting-Ting"]);
    assert.deepEqual(commands[1]?.args.slice(-1), [`I heard: ${spoken}`]);
    assert.equal(commands.some(({ args }) => args.includes("$(touch /tmp/not-executed)")), false);
  } finally {
    adapter.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("voice.stop aborts an active local subprocess and clears the session", async () => {
  const { directory, model } = await fixture();
  let started!: () => void;
  const hasStarted = new Promise<void>((resolve) => { started = resolve; });
  let wasAborted = false;
  const runner: VoiceProcessRunner = {
    run(_command, _args, { signal }) {
      started();
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        wasAborted = true;
        reject(new Error("LOCAL_VOICE_CANCELLED"));
      }, { once: true }));
    },
  };
  const adapter = new LocalWhisperVoiceAdapter({ modelPath: model, platform: "darwin", runner, silenceMs: 100 });
  try {
    await adapter.connect("cancel-test");
    adapter.sendAudioChunk(frame(1000));
    for (let i = 0; i < 5; i += 1) adapter.sendAudioChunk(frame(0));
    await hasStarted;
    await adapter.interrupt("cancel-test");
    assert.equal(wasAborted, true);
    assert.equal(adapter.connected, false);
  } finally {
    adapter.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("local input limits and subprocess errors fail closed", async () => {
  const { directory, model } = await fixture();
  const failures: Array<{ type: string; reasonCode: string }> = [];
  const oversized = new LocalWhisperVoiceAdapter({ modelPath: model, platform: "darwin", maxUtteranceBytes: 640 });
  oversized.subscribe((event) => { if (event.type === "provider_error") failures.push({ type: event.reasonCode, reasonCode: event.reasonCode }); });
  const failedProcess = new LocalWhisperVoiceAdapter({
    modelPath: model,
    platform: "darwin",
    silenceMs: 100,
    runner: { async run() { return { ...ok(), exitCode: 2 }; } },
  });
  failedProcess.subscribe((event) => { if (event.type === "provider_error") failures.push({ type: event.reasonCode, reasonCode: event.reasonCode }); });
  const timedOut = new LocalWhisperVoiceAdapter({
    modelPath: model,
    platform: "darwin",
    silenceMs: 100,
    runner: { async run() { throw new Error("LOCAL_VOICE_PROCESS_TIMEOUT"); } },
  });
  timedOut.subscribe((event) => { if (event.type === "provider_error") failures.push({ type: event.reasonCode, reasonCode: event.reasonCode }); });
  try {
    await oversized.connect("limit-test");
    oversized.sendAudioChunk(frame(1000));
    oversized.sendAudioChunk(frame(1000));
    assert.equal(failures[0]?.reasonCode, "LOCAL_VOICE_UTTERANCE_TOO_LARGE");
    assert.equal(oversized.connected, false);

    await failedProcess.connect("error-test");
    failedProcess.sendAudioChunk(frame(1000));
    for (let i = 0; i < 5; i += 1) failedProcess.sendAudioChunk(frame(0));
    await waitFor(failures, "LOCAL_VOICE_ASR_FAILED");
    assert.equal(failedProcess.connected, false);

    await timedOut.connect("timeout-test");
    timedOut.sendAudioChunk(frame(1000));
    for (let i = 0; i < 5; i += 1) timedOut.sendAudioChunk(frame(0));
    await waitFor(failures, "LOCAL_VOICE_PROCESS_TIMEOUT");
    assert.equal(timedOut.connected, false);
  } finally {
    oversized.close();
    failedProcess.close();
    timedOut.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("local route requires a configured model and does not support non-macOS output", async () => {
  const missing = new LocalWhisperVoiceAdapter({ modelPath: "", platform: "darwin" });
  await assert.rejects(missing.connect("missing-model"), { message: "LOCAL_VOICE_MODEL_REQUIRED" });
  const { directory, model } = await fixture();
  try {
    const unsupported = new LocalWhisperVoiceAdapter({ modelPath: model, platform: "linux" });
    await assert.rejects(unsupported.connect("unsupported-os"), { message: "LOCAL_VOICE_TTS_UNSUPPORTED_OS" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function waitForFile(path: string): Promise<string> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try { return await readFile(path, "utf8"); } catch { /* Child has not signalled readiness yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Child did not become ready");
}

// No microphone, model, network or speech tools: the child only writes test fixtures.
function stubbornChild(marker: string, overflow = false): string {
  return `process.on("SIGTERM", () => {});
    require("node:fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid));
    ${overflow ? 'process.stdout.write(Buffer.alloc(2_000_001));' : ''}
    setInterval(() => {}, 1000);`;
}

for (const mode of ["abort", "timeout", "output-limit"] as const) {
  test(`real local process escalates ${mode} to SIGKILL and preserves its reason`, { timeout: 8_000 }, async () => {
    const { directory } = await fixture();
    const marker = join(directory, "ready");
    const controller = new AbortController();
    const runner = new localVoiceInternals.SpawnVoiceProcessRunner();
    const promise = runner.run(process.execPath, ["-e", stubbornChild(marker, mode === "output-limit")], {
      signal: controller.signal, timeoutMs: mode === "timeout" ? 1_500 : 5_000,
    });
    // Attach rejection handling before waiting for the child readiness handshake.
    const reason = mode === "abort" ? "LOCAL_VOICE_CANCELLED" : mode === "timeout" ? "LOCAL_VOICE_PROCESS_TIMEOUT" : "LOCAL_VOICE_PROCESS_OUTPUT_TOO_LARGE";
    const checked = assert.rejects(promise, { message: reason });
    try {
      const pid = Number(await waitForFile(marker));
      if (mode === "abort") controller.abort();
      await checked;
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    } finally {
      controller.abort();
      await checked;
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("real runner normal exit succeeds and pre-aborted run never spawns", { timeout: 5_000 }, async () => {
  const runner = new localVoiceInternals.SpawnVoiceProcessRunner();
  const controller = new AbortController();
  const result = await runner.run(process.execPath, ["-e", 'process.stdout.write("done"); process.stderr.write("detail");'], {
    signal: controller.signal, timeoutMs: 2_000,
  });
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.toString(), "done");
  assert.equal(result.stderr.toString(), "detail");
  controller.abort(); // A settled run no longer owns an abort listener.
  const { directory } = await fixture();
  const marker = join(directory, "must-not-exist");
  try {
    await assert.rejects(runner.run(process.execPath, ["-e", stubbornChild(marker)], {
      signal: controller.signal, timeoutMs: 2_000,
    }), { message: "LOCAL_VOICE_CANCELLED" });
    await assert.rejects(readFile(marker), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const mode of ["interrupt", "close", "timeout"] as const) {
  test(`adapter ${mode} reaps its real child and removes the utterance directory`, { timeout: 8_000 }, async () => {
    const { directory, model } = await fixture();
    const marker = join(directory, "ready");
    let inputPath = "";
    const realRunner = new localVoiceInternals.SpawnVoiceProcessRunner();
    const events: Array<{ type: string }> = [];
    const adapter = new LocalWhisperVoiceAdapter({ modelPath: model, platform: "darwin", silenceMs: 100,
      processTimeoutMs: mode === "timeout" ? 1_500 : 5_000,
      runner: { run(_command, args, options) {
        inputPath = args[3]!;
        return realRunner.run(process.execPath, ["-e", stubbornChild(marker)], options);
      } },
    });
    adapter.subscribe((event) => events.push(event));
    try {
      await adapter.connect("cleanup-test");
      adapter.sendAudioChunk(frame(1000));
      for (let i = 0; i < 5; i += 1) adapter.sendAudioChunk(frame(0));
      const pid = Number(await waitForFile(marker));
      if (mode === "close") {
        adapter.close();
        let removed = false;
        for (let i = 0; i < 600; i += 1) {
          try { await stat(join(inputPath, "..")); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            removed = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        assert.ok(removed, "close must clean up without a subsequent interrupt");
      }
      if (mode === "timeout") {
        // Timeout is exercised by the real runner, rather than a fake thrown error.
        for (let i = 0; i < 600 && !events.some((event) => event.type === "provider_error"); i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        assert.ok(events.some((event) => event.type === "provider_error"));
      }
      await adapter.interrupt("cleanup-test");
      assert.equal(adapter.connected, false);
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      await assert.rejects(readFile(inputPath), { code: "ENOENT" });
      // Check the directory itself, not only the input file.
      await assert.rejects(stat(join(inputPath, "..")), { code: "ENOENT" });
      assert.equal(events.some((event) => ["audio_chunk", "turn_complete", "proposal_candidate", "output_transcription"].includes(event.type)), false);
    } finally {
      await adapter.interrupt("cleanup-test");
      adapter.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("cancel during candidate callback suppresses late proposal and TTS", async () => {
  const { directory, model } = await fixture();
  let started!: () => void;
  const hasStarted = new Promise<void>((resolve) => { started = resolve; });
  let release!: (candidate: unknown) => void;
  const candidate = new Promise<unknown>((resolve) => { release = resolve; });
  const commands: string[] = [];
  const events: Array<{ type: string }> = [];
  const adapter = new LocalWhisperVoiceAdapter({ modelPath: model, platform: "darwin", silenceMs: 100,
    runner: { async run(command) { commands.push(command); return ok("test transcript"); } },
    candidateForTranscript: () => { started(); return candidate; },
  });
  adapter.subscribe((event) => events.push(event));
  try {
    await adapter.connect("late-candidate");
    adapter.sendAudioChunk(frame(1000));
    for (let i = 0; i < 5; i += 1) adapter.sendAudioChunk(frame(0));
    await hasStarted;
    const stopped = adapter.interrupt("late-candidate");
    release({ kind: "CHANGE_CABIN_SETTING" });
    await stopped;
    assert.equal(commands.length, 1);
    assert.deepEqual(events.map((event) => event.type), ["input_transcription"]);
  } finally {
    release(undefined);
    await adapter.interrupt("late-candidate");
    adapter.close();
    await rm(directory, { recursive: true, force: true });
  }
});

async function waitForRemoval(path: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    try { await stat(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Candidate task did not clean up its directory");
}

for (const mode of ["interrupt", "close", "timeout"] as const) {
  for (const late of ["resolve", "reject", "never"] as const) {
    test(`candidate ${mode} completes without cooperative callback; late ${late} is ignored`, { timeout: 5_000 }, async () => {
      const { directory, model } = await fixture();
      let started!: () => void;
      const hasStarted = new Promise<void>((resolve) => { started = resolve; });
      let release!: (value: unknown) => void;
      let rejectLate!: (error: Error) => void;
      const candidate = new Promise<unknown>((resolve, reject) => { release = resolve; rejectLate = reject; });
      let callbackSignal!: AbortSignal;
      let inputDirectory = "";
      const commands: string[] = [];
      const events: Array<{ type: string; reasonCode?: string }> = [];
      const adapter = new LocalWhisperVoiceAdapter({ modelPath: model, platform: "darwin", silenceMs: 100,
        processTimeoutMs: 80,
        runner: { async run(command, args) {
          commands.push(command);
          inputDirectory = join(args[3]!, "..");
          return ok("callback fixture");
        } },
        candidateForTranscript: (_text, _traceId, signal) => { callbackSignal = signal; started(); return candidate; },
      });
      adapter.subscribe((event) => events.push(event));
      try {
        await adapter.connect("bounded-candidate");
        adapter.sendAudioChunk(frame(1000));
        for (let i = 0; i < 5; i += 1) adapter.sendAudioChunk(frame(0));
        await hasStarted;
        if (mode === "interrupt") await adapter.interrupt("bounded-candidate");
        if (mode === "close") adapter.close();
        await waitForRemoval(inputDirectory); // No release, rejection, or extra interrupt is needed.
        assert.equal(adapter.connected, false);
        assert.equal(callbackSignal.aborted, true);
        assert.equal(getEventListeners(callbackSignal, "abort").length, 0);
        const expected = mode === "timeout" ? ["input_transcription", "provider_error"] : ["input_transcription"];
        assert.deepEqual(events.map((event) => event.type), expected);
        if (mode === "timeout") assert.equal(events[1]?.reasonCode, "LOCAL_VOICE_CANDIDATE_TIMEOUT");
        if (late === "resolve") release({ kind: "CHANGE_CABIN_SETTING" });
        if (late === "reject") rejectLate(new Error("LATE_CALLBACK_REJECTION"));
        await new Promise((resolve) => setTimeout(resolve, 100)); // Also catches any leftover 80ms timeout.
        assert.deepEqual(events.map((event) => event.type), expected);
        assert.equal(commands.length, 1, "Late completion must never start TTS");
      } finally {
        adapter.close();
        await adapter.interrupt("bounded-candidate");
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
}

for (const mode of ["sync-throw", "reject", "undefined", "sync-candidate"] as const) {
  test(`candidate ${mode} preserves local success/failure behavior and releases listener`, async () => {
    const { directory, model } = await fixture();
    let signal!: AbortSignal;
    const events: Array<{ type: string; reasonCode?: string }> = [];
    const commands: string[] = [];
    const adapter = new LocalWhisperVoiceAdapter({ modelPath: model, platform: "darwin", silenceMs: 100, processTimeoutMs: 80,
      runner: { async run(command, args) {
        commands.push(command);
        if (command === "whisper-cli") return ok("local callback test");
        if (command === "say") { await writeFile(args[1]!, "aiff fixture"); return ok(); }
        await writeFile(args[7]!, localVoiceInternals.makeWav(Buffer.from([1, 0]), 24_000));
        return ok();
      } },
      candidateForTranscript: (_text, _traceId, callbackSignal) => {
        signal = callbackSignal;
        if (mode === "sync-throw") throw new Error("CANDIDATE_SYNC_FAILED");
        if (mode === "reject") return Promise.reject(new Error("CANDIDATE_ASYNC_FAILED"));
        if (mode === "undefined") return undefined;
        return { kind: "CHANGE_CABIN_SETTING" };
      },
    });
    adapter.subscribe((event) => events.push(event));
    try {
      await adapter.connect("candidate-behavior");
      adapter.sendAudioChunk(frame(1000));
      for (let i = 0; i < 5; i += 1) adapter.sendAudioChunk(frame(0));
      const failed = mode === "sync-throw" || mode === "reject";
      await waitFor(events, failed ? "provider_error" : "turn_complete");
      assert.equal(getEventListeners(signal, "abort").length, 0);
      if (failed) {
        assert.equal(events.find((event) => event.type === "provider_error")?.reasonCode,
          mode === "sync-throw" ? "CANDIDATE_SYNC_FAILED" : "CANDIDATE_ASYNC_FAILED");
        assert.equal(commands.length, 1);
        assert.equal(adapter.connected, false);
      } else {
        assert.equal(events.some((event) => event.type === "proposal_candidate"), mode === "sync-candidate");
        assert.equal(commands.length, 3);
        assert.equal(adapter.connected, true);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(events.filter((event) => event.type === "provider_error").length, failed ? 1 : 0);
    } finally {
      await adapter.interrupt("candidate-behavior");
      adapter.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
