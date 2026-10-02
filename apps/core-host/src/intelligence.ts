import { randomUUID } from "node:crypto";
import { Gemma2BOfflineSimulator, OllamaProposalModel } from "../../../adapters/local/index.js";
import { GeminiVoiceStreamingAdapter } from "../../../adapters/voice/gemini-live-voice-adapter.js";
import { MockGeminiVoiceStreamingAdapter } from "../../../adapters/voice/mock-gemini-voice-streaming-adapter.js";
import type { DisplayRole } from "../../../contracts/protocol/src/types.js";
import {
  IntelligenceRouter,
  StructuredTraceSink,
  VoiceRuntime,
  type VoiceProvider,
  type ProposalSource,
  type VoiceOutputPort,
  type TraceSink,
} from "../../../packages/core-runtime/src/index.js";
import type { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import { brandFromEnvironment } from "../../../packages/core-domain/src/brand.js";

export interface IntelligenceStack {
  router: IntelligenceRouter;
  voice: VoiceRuntime;
  gemini: ProposalSource & VoiceProvider;
  close(): void;
}

export interface IntelligenceStackOptions {
  requestedByRole?: DisplayRole;
  trace?: TraceSink;
}

export function createIntelligenceStack(
  runtime: CoreRuntime,
  audioOutput: VoiceOutputPort,
  options: IntelligenceStackOptions = {},
): IntelligenceStack {
  const trace = options.trace ?? new StructuredTraceSink();
  const requestedByRole = options.requestedByRole ?? "center";
  const brand = brandFromEnvironment(process.env);
  const useMock = process.env.AURA_VOICE_MODE === "mock" ||
    (process.env.AURA_VOICE_MODE !== "live" && !process.env.GEMINI_API_KEY);
  const gemini: ProposalSource & VoiceProvider = useMock
    ? new MockGeminiVoiceStreamingAdapter()
    : new GeminiVoiceStreamingAdapter({ sessionId: runtime.sessionId, trace, assistantName: brand.assistantName });
  let voice: VoiceRuntime;
  const cloud: ProposalSource = {
    async proposeFromText(input) {
      await voice.start(input.traceId);
      const signal = input.signal ?? voice.turnSignal;
      return gemini.proposeFromText({
        text: input.text,
        traceId: input.traceId,
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
  const router = new IntelligenceRouter({
    runtime,
    cloud,
    local: new Gemma2BOfflineSimulator(),
    ...(process.env.AURA_LOCAL_MODEL?.trim()
      ? {
          student: new OllamaProposalModel({
            model: process.env.AURA_LOCAL_MODEL.trim(),
            ...(process.env.OLLAMA_HOST?.trim()
              ? { host: process.env.OLLAMA_HOST.trim() }
              : {}),
            ...(process.env.AURA_LOCAL_MODEL_TIMEOUT_MS?.trim()
              ? { timeoutMs: Number(process.env.AURA_LOCAL_MODEL_TIMEOUT_MS) }
              : {}),
          }),
        }
      : {}),
    trace,
    stopVoice: (traceId) => voice.stop(traceId),
  });
  voice = new VoiceRuntime({
    sessionId: runtime.sessionId,
    adapter: gemini,
    output: audioOutput,
    trace,
    onProposalCandidate: ({ candidate, traceId }) => router.handleProviderProposal({
      requestId: `live-voice:${randomUUID()}`,
      traceId,
      requestedByRole,
      candidate,
    }),
  });

  return {
    router,
    voice,
    gemini,
    close: () => voice.close(),
  };
}
