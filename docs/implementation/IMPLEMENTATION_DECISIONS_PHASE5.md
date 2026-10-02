# AURA Backend Implementation Notes — Phase 5

## Implemented scope

- `IntelligenceRouter` classifies deterministic cabin commands for the local logic seam and sends other requests to a cloud proposal source.
- Cloud outputs are checked against an allowlisted Action Proposal Candidate schema, assigned a Core-owned proposal ID, then passed through `CoreRuntime.proposeAction()` and the Action Gate. The model has no direct execution path.
- `GeminiLiveVoiceAdapter` wraps the Google GenAI Live WebSocket for bidirectional audio, text, transcription, and constrained proposal tool calls.
- `GeminiVoiceStreamingAdapter` is the public integration name (with `GeminiLiveVoiceAdapter` retained as a compatibility export). The HMI gateway accepts `voice.start` for mono PCM16 little-endian at 16 kHz, then binary WebSocket frames; `voice.stop` cancels the active turn. Server audio is sent to the owning display as `voice.audio` start metadata, binary PCM frames, and end metadata.
- The core host selects `MockGeminiVoiceStreamingAdapter` when `GEMINI_API_KEY` is absent, unless `AURA_VOICE_MODE=live` is explicitly set. The mock uses RMS VAD plus a 320 ms silence endpoint and a fixed transcript because mock PCM is not actually recognized or synthesized. Set `AURA_VOICE_MODE=mock` to force it when credentials exist.
- `VoiceRuntime` tracks `IDLE → LISTENING → TRANSCRIBING → THINKING → SPEAKING`, aborts playback on VAD interruption, and drops audio ducking on STOP/barge-in.
- Streamed Gemini proposal tool calls go through the Intelligence Router's schema validation and local policy gate; tool calls never execute effects directly.
- `Gemma2BOfflineSimulator` is an explicitly simulated, deterministic-only local fallback seam. It handles a small fixed set of cabin volume and temperature commands; it does not load a model or perform inference.
- Google Places Text Search and Routes Compute REST adapters normalize results and emit metadata-only runtime signals. The external stack exposes a separately named fixture weather adapter and a setting-controlled Open-Meteo adapter; the fixture is not a live fallback, and the Open-Meteo adapter is not called by host startup.
- A local SQLite journey store retains user-authored journey inputs and Place IDs for at most seven days. Provider response content is transient and is not copied to the store or shared state.
- Core-host factories wire the Router, voice runtime, local fallback, Gemini adapter, Maps adapters, weather fixture, and SQLite store without depending on a UI or a particular audio device.

## Frozen technology choices

- Gemini Live model defaults to `gemini-3.8-live` and remains overridable with `GEMINI_LIVE_MODEL`; API credentials come from `GEMINI_API_KEY` and are never logged.
- The official TypeScript package name is `@google/genai` (the task uses “google-genai” descriptively). Dependency is pinned to the current Node 20-compatible v2 line, `^2.26.0`; SDK v3 currently requires Node 22 or later.
- Voice audio is passed as buffers to the provider and audio output port. Trace records contain session/trace IDs, durations, model/route, outcome, and fallback reason, with no transcript or raw audio content.
- Gemini's `submit_action_proposal` tool is a data-returning proposal seam only. Its response states that local policy review is pending and that nothing was executed.

## Spec notes and limits

- The new Architect stack resolves prior Master Spec/runtime-design proposals for this assignment. The Master Spec's earlier Ollama/Qwen local direction differs from the newly frozen Gemma 2B simulator choice. The simulator does not claim that Gemma weights or inference are present.
- The sample router script injects a simulated cloud proposal source so it can demonstrate the text-query → Router → Action Gate → `ActionProposal` path without credentials. It is a demo script, not a live Gemini validation.
- Places API content is subject to Google Maps Platform caching restrictions. Only Place IDs are persisted from Places results; labels and coordinates in saved journeys are user-supplied. Route results remain transient.
- Required entry point: `npm run demo:router` after building. Live Gemini and Maps requests require `GEMINI_API_KEY` and `GOOGLE_MAPS_API_KEY`; credentials are never stored in source or traces.
