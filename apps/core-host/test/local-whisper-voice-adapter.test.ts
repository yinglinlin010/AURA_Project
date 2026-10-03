import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  const adapter = new LocalWhisperVoiceAdapter({ modelPath: model, whisperCli: "whisper tool", sayCommand: "say tool", afconvertCommand: "afconvert tool", sayVoice: "Ting-Ting", platform: "darwin", runner, silenceMs: 100 });
  const events: Array<Record<string, unknown>> = [];
  adapter.subscribe((event) => events.push(event));
  try {
    await adapter.connect("local-test");
    adapter.sendAudioChunk(frame(1000));
    for (let i = 0; i < 5; i += 1) adapter.sendAudioChunk(frame(0));
    await waitFor(events as Array<{ type: string }>, "turn_complete");

    assert.equal(events.find((event) => event.type === "input_transcription")?.text, spoken);
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
