# TASK: AURA Project - Backend Phase 5 (Intelligence, Voice & Adapters)

**To:** Codex / Backend Engineering Agent
**From:** System Architect
**Reference Docs:** `../architecture/AURA_RUNTIME_IMPLEMENTATION_DESIGN.md` (Section 11)

## ⚠️ STRICT BOUNDARY WARNING
- **DO NOT** implement UI.
- You MUST rely on the HMI Gateway and Shared State established in Phases 0-4.

## 1. ARCHITECTURE DECISIONS (Resolving Section 11)
You must implement the adapters based on the following definitive technology choices:

1. **Voice & Reasoning Stack (Cloud):** Use **Gemini Live API** (via `google-genai` SDK). This single bidirectional WebSocket will handle VAD (Voice Activity Detection), ASR (Speech-to-Text), LLM Reasoning, and TTS (Text-to-Speech) with ultra-low latency.
2. **Local Fallback Model:** Simulate a local `gemma-2b` model interface for offline continuity (deterministic commands only).
3. **External Data Providers:**
   - Routing & Places: **Google Maps Platform** API.
   - Weather: Mocked JSON endpoint (to be replaced by live provider later).
4. **Data Persistence & Security:** Use **SQLite** for durable caching. All stored journey data must have a strict 7-day retention limit (TTL) and be stored locally to respect privacy.

## 2. DISPATCH: INTELLIGENCE ROUTER & VOICE RUNTIME
**Target Location:** `packages/core-runtime/`, `adapters/`

**Task Details:**
1. **Intelligence Router:**
   - Implement the logic that routes user intents: Deterministic cabin commands -> Local Logic; Complex planning -> Cloud AI (Gemini).
   - Ensure the router maps Cloud AI outputs back to the strict `ActionProposal` schema (preventing the LLM from executing raw code).
2. **Voice Runtime (Gemini Live Integration):**
   - Implement the state machine: `IDLE -> LISTENING -> TRANSCRIBING -> THINKING -> SPEAKING`.
   - Implement the `STOP` command (Cancellation mechanism): If the user speaks while TTS is playing, it must immediately send an abort signal to cut off the audio ducking and cancel the ongoing voice task.
3. **External Adapters:**
   - Build the `PlacesAdapter` and `RoutingAdapter` using standard REST fetching, ensuring responses are normalized into AURA internal domain events.

## 3. OBSERVABILITY
- Ensure all Voice interactions and LLM API calls are logged with `duration` and `fallback reason` in the traces.
- Sensitive contents (raw audio buffers) must be explicitly dropped from logging.

**Completion Condition:**
Implement the `IntelligenceRouter` and the `GeminiVoiceAdapter`. Provide a test script showing a text-based simulated voice query being routed, processed, and returning an `ActionProposal`.
