# Requirements Audit Report (2026-10-04)

## Stale Claims
1. **Git State (Handoff Doc)**: `AURA_AGENT_HANDOFF_2026-10-04.md` (Lines 22-29) claims the HEAD is `7808eb3dc83...` with uncommitted changes in `adapters/voice/` etc. This is stale; the current HEAD is `c603246` and these files are already committed.
2. **Test Evidence (Audit Doc)**: `AURA_COMPETITION_V1_REQUIREMENTS_AUDIT.md` (Line 199) claims "73 Node tests". This is stale; `npm test` now passes 111 Node tests, matching the updated claim in the Handoff doc.
3. **Task Recovery Gaps (Audit Doc)**: `AURA_COMPETITION_V1_REQUIREMENTS_AUDIT.md` (Line 96, §31) claims "No predictor/prefetch/cache/pending task resume...". This is stale, as task recovery, SQLite persistence, and resume revalidation are now implemented (evidenced by recent commits and tests).

## Contradictory Claims
4. **Adaptive Parking Evidence (Audit Doc)**: `AURA_COMPETITION_V1_REQUIREMENTS_AUDIT.md` (Line 94, §29) demands "real context, step guidance, completion and capability update". This contradicts Master Spec §61.31, which explicitly permits showing a simulation if no verified existing vehicle interface is connected and focuses on adapter limits rather than requiring real physical step guidance for V1.

## Recommended Minimal Doc Corrections
- Update `AURA_AGENT_HANDOFF_2026-10-04.md` (Lines 22-29) to reflect HEAD `c603246` and remove the list of uncommitted changes.
- Update `AURA_COMPETITION_V1_REQUIREMENTS_AUDIT.md` (Line 199) to 111 Node tests.
- Update `AURA_COMPETITION_V1_REQUIREMENTS_AUDIT.md` (Line 96) to reflect that pending task resume and SQLite task state are implemented.
- Align `AURA_COMPETITION_V1_REQUIREMENTS_AUDIT.md` (Line 94) with Master Spec §61.31 to accept the simulated parking adapter as conforming for V1.

## Unresolved Human/External Blockers (Missing Verification Gates)
- **Data/Rights Review**: Human content and rights review for the local Whisper adapter and dataset is still pending (Handoff doc, Line 103).
- **Physical/Live Validation**: Real hardware microphone/playback testing, live charging/drop-off provider data, and Android/AI Box deployment are missing. Current evidence remains restricted to simulated paths and fake processes.
- **Visual Acceptance**: Independent verification of the five HMI display clients against the frozen visuals in Master Spec §64 is pending.
