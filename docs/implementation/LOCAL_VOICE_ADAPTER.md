# Local voice adapter

`AURA_VOICE_MODE=local` selects the opt-in local `VoiceProvider` in
`adapters/voice/local-whisper-voice-adapter.ts`. The route uses browser-sent
16 kHz mono signed PCM, closes a phrase after configured low-energy audio,
transcribes it with `whisper-cli`, sends recognized text through the existing
deterministic local intent proposal and policy/consent path, then speaks a
literal “I heard: …” response through macOS `say` and `afconvert`. Audio uses
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

One generated-audio smoke was run on the development Mac after implementation:
whisper.cpp 1.9.4 (`/opt/homebrew/bin/whisper-cli`) with
`ggml-base.bin` (SHA-256
`60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`),
language `auto`, and macOS `Meijia (中文（台灣）)`; `say` generated the input
sentence `把車內音量調大`, and the adapter transcribed `法車內音量調大` then
produced 132,340 bytes of output PCM. This is one generated fixture with a
transcript mismatch in its first character; it is not an accuracy result or
evidence of live microphone capture, speaker playback, or cabin performance.
