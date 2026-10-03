import assert from "node:assert/strict";
import test from "node:test";
import type { DisplayRegistry } from "../../../contracts/protocol/src/types.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import { createIntelligenceStack } from "../src/intelligence.js";

const registry: DisplayRegistry = {
  version: 1,
  displays: [{ displayId: "center-main", deviceId: "center-device", role: "center", protocolVersion: 1, enabled: true }],
};

test("AURA_VOICE_MODE=local selects local speech and missing model fails without fallback", async () => {
  const oldMode = process.env.AURA_VOICE_MODE;
  const oldModel = process.env.AURA_WHISPER_MODEL;
  const traceRecords: Array<{ route?: "local" | "mock" | "cloud" }> = [];
  process.env.AURA_VOICE_MODE = "local";
  delete process.env.AURA_WHISPER_MODEL;
  const stack = createIntelligenceStack(
    new CoreRuntime({ registry }),
    { playAudio: async () => {}, stopPlayback: () => {}, setAudioDucked: () => {} },
    { trace: { record: (record) => traceRecords.push(record) } },
  );
  try {
    assert.equal(stack.gemini.modelName, "local-whisper-cpp");
    await assert.rejects(stack.voice.start("local-missing-model"), { message: "LOCAL_VOICE_MODEL_REQUIRED" });
    assert.equal(stack.voice.currentState, "IDLE");
    assert.equal(traceRecords.at(-1)?.route, "local");
    assert.notEqual(traceRecords.at(-1)?.route, "cloud");
  } finally {
    stack.close();
    if (oldMode === undefined) delete process.env.AURA_VOICE_MODE;
    else process.env.AURA_VOICE_MODE = oldMode;
    if (oldModel === undefined) delete process.env.AURA_WHISPER_MODEL;
    else process.env.AURA_WHISPER_MODEL = oldModel;
  }
});
