# Local voice adapter

`AURA_VOICE_MODE=local` selects the opt-in local `VoiceProvider` in
`adapters/voice/local-whisper-voice-adapter.ts`. The route uses browser-sent
16 kHz mono signed PCM, closes a phrase after configured low-energy audio,
transcribes it with `whisper-cli`, sends recognized text through the local
intent and policy/consent path, then speaks a literal “I heard: …” response
through macOS `say` and `afconvert`. Without `AURA_LOCAL_MODEL`, intent uses
deterministic local command matching. With `AURA_LOCAL_MODEL` set to an already
installed Ollama model, the recognized text is sent to Ollama for bounded cabin
volume/temperature extraction; the model can only propose a Center action, and
Action Gate plus explicit Center consent still control it. The default Ollama
host is localhost; `OLLAMA_HOST` can override it. When Ollama is unavailable or
abstains, voice still returns the transcript and spoken acknowledgement
without submitting an action. Audio uses
the existing transcript and PCM output events; no protocol change or
always-listening wake path is introduced.

Configure `AURA_WHISPER_MODEL` with a readable local whisper.cpp model file,
optionally `AURA_WHISPER_CLI` with the executable name or path, and
`AURA_WHISPER_LANGUAGE` with a whisper.cpp language code (`auto` by default).
Set `AURA_SAY_VOICE` to an installed macOS speech voice when needed; available
names depend on the host OS speech voices, and an unavailable name fails as a
TTS process error. The adapter
fails closed when the model is missing, the CLI cannot start, processing fails
or times out, or audio exceeds its utterance bound. It never substitutes mock
or Gemini in local mode. Commands run as argument arrays with shell execution
disabled. `voice.stop` aborts the active child process and removes temporary
audio files.

Speech output currently requires macOS `say` and `afconvert`; other operating
systems fail closed with `LOCAL_VOICE_TTS_UNSUPPORTED_OS`. This is a developer
host path, not validated target-device audio. Before distributing a model or
runtime, review the whisper.cpp executable and model source/license terms,
model redistribution rights, and macOS speech/output terms for the intended
use. Tests inject a fake process runner and use placeholder files; they prove
argument handling, WAV framing, state/error handling, bounds, and cancellation,
not recognition quality, synthesized speech quality, or speaker playback.

For real audio evidence, run a model-backed smoke with known speech and record
model/version/hash, language, input audio source, transcript, and whether PCM
output was produced. A generated audio fixture does not test browser
microphone capture, speaker playback, recognition quality in cabin conditions,
or target-device behavior.

On 2026-10-04 this Mac installed `ggml-base.bin` at
`~/.cache/whisper/ggml-base.bin` from the upstream model artifact (SHA-256
`60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`). The
real adapter ran against macOS-generated Traditional Chinese speech for
`把車內音量調大`, returned that transcript, and emitted 128,996 bytes of
generated 24 kHz mono PCM from local TTS. A direct Whisper CLI run on the same
fixture once misrecognized the first character; neither run tested a physical
microphone, speaker playback, an in-cabin speaker, or recognition quality.
That earlier adapter smoke did not call Ollama. A follow-up end-to-end run on
2026-10-04 configured `AURA_LOCAL_MODEL=qwen3:4b` and sent the same generated
PCM through `VoiceRuntime`, Whisper, and Ollama. Whisper recognized
`把車內音量調大`; Ollama returned a volume-up candidate; the router recorded a
local `local-voice-proposal` result with policy outcome `DEFER`. The runtime
had no driver-load evidence, so Action Gate deferred the proposal instead of
submitting it for consent or execution. No cloud call was made. This verifies
the local handoff and fail-safe policy on one generated fixture, not microphone
capture, recognition quality, speaker playback, or vehicle integration.

One generated-audio smoke was run on the development Mac after implementation:
whisper.cpp 1.9.4 (`/opt/homebrew/bin/whisper-cli`) with
`ggml-base.bin` (SHA-256
`60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`),
language `auto`, and macOS `Meijia (中文（台灣）)`; `say` generated the input
sentence `把車內音量調大`, and the adapter transcribed `法車內音量調大` then
produced 132,340 bytes of output PCM. This is one generated fixture with a
transcript mismatch in its first character; it is not an accuracy result or
evidence of live microphone capture, speaker playback, or cabin performance.
