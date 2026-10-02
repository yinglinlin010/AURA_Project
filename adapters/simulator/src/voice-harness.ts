import type { DisplayRole } from "../../../contracts/protocol/src/types.js";
import { MockGeminiVoiceStreamingAdapter } from "../../voice/mock-gemini-voice-streaming-adapter.js";
import type { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import {
  VoiceRuntime,
  type VoiceOutputPort,
} from "../../../packages/core-runtime/src/voice-runtime.js";
import type { IntelligenceRouter } from "../../../packages/core-runtime/src/intelligence-router.js";

/** Credential-free scenario wiring. It models provider events and cancellation, not real audio I/O. */
export function createScenarioVoiceHarness(
  runtime: CoreRuntime,
  router: IntelligenceRouter,
  requestedByRole: DisplayRole = "center",
): { voice: VoiceRuntime; adapter: MockGeminiVoiceStreamingAdapter } {
  const adapter = new MockGeminiVoiceStreamingAdapter();
  const voice = new VoiceRuntime({
    sessionId: runtime.sessionId,
    adapter,
    output: new ScenarioVoiceOutput(),
    onProposalCandidate: ({ candidate, traceId }) => router.handleProviderProposal({
      requestId: `scenario-voice:${traceId}`,
      traceId,
      requestedByRole,
      candidate,
    }),
  });
  return { voice, adapter };
}

/** Holds mock playback open until stop/barge-in cancels it, so those transitions are observable. */
class ScenarioVoiceOutput implements VoiceOutputPort {
  async playAudio(_data: Buffer, _mimeType: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      const onAbort = () => resolve();
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }
    });
  }

  stopPlayback(): void {}
  setAudioDucked(_ducked: boolean): void {}
}
