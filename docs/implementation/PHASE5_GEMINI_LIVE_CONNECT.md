# Phase 5: Gemini Live connection behavior

## Implemented locally

`GeminiLiveVoiceAdapter` now bounds Live API session establishment. The default
handshake timeout is 10 seconds; callers may set `connectTimeoutMs` from 1 to
60,000 milliseconds. SDK error and close callbacks reject a pending connect,
and `close()` or `interrupt()` cancels that pending attempt. If the SDK returns
a session after the attempt has already failed, timed out, or been cancelled,
the adapter closes that late session instead of attaching it.

The behavior is covered by `apps/core-host/test/gemini-live-connect.test.ts`
using an injected connector. Those tests do not make network requests.

## Provider evidence and limit

A connect-only attempt on 2026-10-03 reached the configured Live API path but
received an authentication rejection. The SDK reported the failure through its
error callback while its connect promise remained pending. The adapter lifecycle
fix and tests address that hang; the provider was not retried afterward. No user
text or audio was sent, and this result does not establish a successful Live
session, transcription, generated speech, or barge-in performance.

To complete the provider-backed portion of Phase 5, configure a credential
authorized for Gemini Live, then record a successful session, input/output
transcription and audio, error handling, and a real playback interruption test.
