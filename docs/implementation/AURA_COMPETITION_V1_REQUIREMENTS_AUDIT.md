# AURA Competition V1 requirements audit

**Audit date:** 2026-10-02
**Authority:** [`../product/AURA_MASTER_SPEC_2026-10-02.md`](../product/AURA_MASTER_SPEC_2026-10-02.md), preserving frozen §§61.24–61.25 and Section 64.
**Scope:** Repository evidence only. No physical device, live provider, trained model, performance, or competition demonstration is inferred from source code or documentation. No tests/builds were run for this audit.

## Status key

- **Implemented in source:** the named source path exists; runtime or end-to-end behavior may still need direct validation.
- **Partial:** some named parts exist, but the full requirement is not met.
- **Not implemented:** no qualifying implementation was found.
- **Unverified:** a claim requires runtime, provider, device, or benchmark evidence not available in this audit.
- **Out of scope by frozen spec:** explicitly excluded from Competition V1.

## §61.24 MVP Priority

### MUST

| Requirement | Status | Evidence and remaining work |
|---|---|---|
| Shared State | Partial | `packages/core-runtime/src/core-runtime.ts` owns reducer-backed state and snapshots. Only limited display clients are connected; verify five-client state synchronization end to end. |
| HMI Gateway | Partial | `apps/core-host/src/hmi-gateway.ts` validates protocol messages, registers displays, handles commands/events and voice. Browser integration covers Center and Front Passenger paths; five live displays and reconnection behavior are not established. |
| Display Registry | Implemented in source | `apps/core-host/config/display-registry.json`, protocol registry validation and gateway registration. |
| Five logical HMI surfaces | Partial | Five visual surfaces exist in `apps/web-simulator/src/App.tsx` and retain Section 64 composition. Only limited surfaces have live Gateway connections; this is not five independently running clients. |
| Control Console | Partial | Developer controls report speed and cognitive load over the Gateway in `apps/web-simulator/src/App.tsx` and `src/core/useAuraCommand.ts`; no end-to-end run evidence in this audit. |
| Voice input abstraction | Partial | Voice Runtime and provider interfaces exist in `packages/core-runtime/src/voice-runtime.ts`; browser PCM path exists, but no vehicle microphone/device evidence. |
| STT/TTS path | Partial | Mock and Gemini Live adapters plus Gateway PCM/transcript path exist. Live provider credentials and a live voice session have not been verified. |
| Wake interaction | Not implemented | Browser microphone is user-triggered; no wake-word detector was found. |
| Local LLM | Partial | Optional Ollama student adapter in `adapters/local/ollama-proposal-model.ts` and explicit router selection exist. The deterministic Gemma-named adapter is a rule matcher, not an LLM; no local model response or trained student is verified. |
| Action Request / Policy / Safety / Consent | Implemented in source | `packages/core-domain/src/action-gate.ts`, `safety-supervisor.ts`, `consent-manager.ts`; Core Runtime routes proposals and consent through governed state transitions. Runtime behavior still needs end-to-end validation. |
| Scenario Engine | Partial | `adapters/simulator/src/scenario.ts` and CLI provide a scenario runner. Phase 7's YAML scenario and JSON fixture do not alone prove execution by the runner. |
| Vehicle Simulator | Partial | Scenario signal ingestion and browser Control Console can report simulated speed/load; no complete vehicle simulator or physical vehicle link is established. |
| Multi-display synchronization | Partial | Shared state/event bus and two browser Gateway clients are documented; five clients and complete cross-display parity remain open. |
| Basic Journey | Partial | Journey state, consent-governed stop addition and SQLite journey store exist. End-to-end cross-display journey continuity needs verification. |
| Basic Recommendation | Partial | `packages/core-runtime/src/journey-recommender.ts` ranks typed evidence and produces governed proposals. No provider enrichment or HMI recommendation flow is wired; fixtures are simulated. |
| Online/offline state | Not implemented | Signal types include connectivity-related provenance, but no verified continuity router, cloud recovery, task resumption or offline cache path is integrated. |

### SHOULD

| Requirement | Status | Evidence and remaining work |
|---|---|---|
| Cloud enhancement | Partial | Gemini Live adapter is selectable by configuration; no live cloud request evidence. |
| Live weather | Not implemented | Weather adapter is a mock fixture; no live weather provider is connected. |
| Live POI/routing | Partial | Mapbox Search Box and Directions adapters are constructed by Core Host when configured. No caller is wired through Gateway, recommendation or UI, and no live key/request was verified. |
| Camera observation | Not implemented | No camera capture or perception path found. |
| Adaptive parking assistance | Not implemented | No perception-backed parking-state/help-likelihood flow; no physical parking-control claim is in scope. |
| Barge-in | Partial | Voice stop/interruption path exists in source; no latency or device-level interruption evidence. |
| Audio ducking | Not implemented | No vehicle audio-mix/ducking integration found. |
| AURA character/presence | Partial | Five visual previews contain presence-oriented presentation; shared presence state and cross-display behavior are not established. |
| Memory/preferences | Partial | Journey persistence exists; user preference learning/memory policy is not implemented as an end-to-end capability. |
| Connectivity degradation | Not implemented | No integrated offline/cloud continuity and recovery path. |
| Dev Console | Partial | Browser Control Console provides speed/load and connection indicators; a complete engineering trace/state console is not established. |
| Trace/latency metrics | Partial | Structured trace hooks exist across runtime and adapters. No benchmark/latency result is measured. |

### COULD

The following remain unimplemented or unverified and must not be presented as complete: advanced crowd estimation, speaker localization, real beamforming, advanced predictive connectivity, advanced stress estimation, complex VLM, fine-tuned local model, full offline map, advanced media, multiple rear displays, and native AAOS deployment. Source adapters or simulated fixtures do not satisfy device/provider/model evidence for these capabilities.

### WON'T --- Competition V1

Per the frozen spec these are deliberately out of scope: real vehicle control, brake actuation, steering actuation, autonomous parking, production ADAS, production driver monitoring, full map-platform replacement, full infotainment OS, production-grade AAOS integration, custom foundation-model training, and automotive certification. Prototype proposals and simulated state must not be described as these capabilities.

## §61.25 Frozen roadmap and milestones

| Frozen phase | Current evidence | Status / exit gap |
|---|---|---|
| 0 Repository / contracts / configuration | `contracts/`, Core Host config, architecture and implementation decision docs | Partial; repository-wide contract/configuration audit remains. |
| 1 Shared State + Event Bus + HMI Gateway | `core-runtime.ts`, `event-bus.ts`, `hmi-gateway.ts` | Partial; no five-client live synchronization evidence. |
| 2 Simulator + Control Console | Scenario runner and browser Control Console | Partial; simulator and console end-to-end flow not verified. |
| 3 Five-display skeleton + Display Registry | Five visual previews and five configured logical registrations | Partial; five independent live surfaces are absent. Preserve Section 64 layout. |
| 4 Action / Policy / Consent / Safety | Core Domain Action Gate, Consent Manager, Safety Supervisor; M2 flow review reported implementation | Implemented in source, unverified end-to-end. |
| 5 Voice pipeline + stop/barge-in | Mock/Gemini adapters, browser PCM, Voice Runtime and stop route | Partial; no wake-word, vehicle audio, live provider or latency evidence. |
| 6 Local AI / Ollama | Optional Ollama adapter/router; one-file pending review queue; teacher-generation CLI; LoRA SFT/evaluation harness | Partial; no verified model pull completion, teacher generation, human-approved training split, training run, evaluation or deployed student. Deterministic Gemma path is not an LLM. |
| 7 Journey + Recommendation | Deterministic scorer, simulated fixture and consent/defer scenario | Partial; no provider enrichment, UI integration, executed scenario evidence or preference source. |
| 8 External provider adapters | Mapbox Search Box and Directions adapters; conditional Core Host construction | Partial; adapters have no Gateway/recommendation/UI caller; Android rendering, offline tiles and live key/request remain absent. |
| 9 Camera / perception | No qualifying capture/perception implementation found | Not implemented. |
| 10 Offline / Cloud Router + Continuity | Local text rules, optional Ollama and cloud routing are separate proposal paths | Not implemented as continuity; no demonstrated cloud-off/local-on/recovery-without-reset flow. |
| 11 Window / AURA presence | Window visual preview and basic CSS presence indicator | Partial; no shared presence state/lifecycle or independently connected window client. |
| 12 Benchmark / reliability / competition polish | Trace hooks and harness source exist | Not implemented as benchmark evidence; no measured reliability, latency, memory, endurance, or polished live demo evidence. |

| Milestone | Status | Evidence / gap |
|---|---|---|
| M1 Vehicle State Across Displays | Partial | Control Console can report speed/load and Cluster reads shared speed in UI source. No observed live run; five display synchronization remains incomplete. |
| M2 First Cross-display Action | Partial | Passenger-to-Center proposal/consent/journey code and scenario paths exist. No end-to-end execution evidence in this audit. |
| M3 Voice → Action | Partial | PCM/Gateway/voice proposal path exists, but no wake interaction or live end-to-end voice/action evidence. |
| M4 Contextual AI | Partial | Journey scorer and Mapbox adapters exist independently; provider/context fusion and HMI recommendation path are not wired. |
| M5 Adaptive Assistance | Not implemented | Camera/perception and help-likelihood path absent. |
| M6 Resilience | Not implemented | Cloud OFF → local continuity → cloud ON without journey reset is not implemented or demonstrated. |

## §63 Final Definition of Done

| # | Reviewer-visible outcome | Status | Required evidence still missing |
|---:|---|---|---|
| 1 | One AI spans cockpit rather than five unrelated apps | Partial | Demonstrate one shared live session across all five independently registered displays. |
| 2 | Displays have distinct roles | Partial | Role layouts exist visually; demonstrate role-specific live responsibilities across five clients. |
| 3 | System understands context, not only text | Partial | Typed context and policy exist; demonstrate scenario-driven context fusion and behavior. |
| 4 | Passenger requests become governed driver proposals | Partial | Code exists; capture an end-to-end run through consent and shared journey state. |
| 5 | AURA defers non-critical interaction | Partial | Load policy and scenario exist; execute and record defer/release behavior. |
| 6 | Parking assistance is adaptive and consent-aware | Not implemented | Perception/context, adaptive help policy and governed UI flow. |
| 7 | Safety events override ordinary dialogue | Partial | Safety supervisor and interrupt path exist; demonstrate priority behavior in a recorded scenario. |
| 8 | AURA is naturally invoked and immediately interrupted | Partial | Browser voice is manual; wake detector and measured/device interruption proof absent. |
| 9 | Useful AI remains during network loss | Not implemented | Integrated local offline behavior and explicit data freshness/unavailable UI. |
| 10 | Cloud recovery continues without journey reset | Not implemented | State continuity and replay/recovery scenario with evidence. |
| 11 | Real and simulated data are clearly distinguished | Partial | Protocol source/freshness fields and simulated fixtures exist; audit all user-visible labels and execute scenarios. |
| 12 | Portable toward Android/AAOS/CDC | Partial | Protocol/core are TypeScript abstractions; no Android/AAOS client or portability build evidence. |
| 13 | Live end-to-end demo, not timed animation | Unverified | No recorded direct live demonstration or reviewer observation. |
| 14 | Third-party model/API/library/dataset/media sources accurately disclosed | Partial | Mapbox/Qwen and package provenance are documented in places; finish a complete inventory and license/terms lineage for models and every training datum. |

## §§59–60 and Appendix A: local model and scenario-data gates

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Domain-adapt a local model for bounded AURA behavior; do not imitate frontier general intelligence | Partial | The current SFT task is deliberately narrow cabin-setting extraction. No SFT student exists. |
| Keep changing route/weather/POI/vehicle facts in context/tools, not fine-tuned weights | Partial | Mapbox adapter and recommendation scorer are separate from the training labels, but not yet wired into a context/tool flow. |
| Never make generative safety thresholds the sole source of truth | Implemented in source | Local candidate passes schema validation, Core Runtime, deterministic Action Gate and Consent; confirm this remains true in future integrations. |
| Scenario dataset records context, utterance, expected intent/urgency, allowed/prohibited actions, structured output, response and fallback | Partial | `ml/aura_distill/data/` currently covers only a narrow English volume/temperature extraction task; broader scenario categories and response/fallback coverage are missing. |
| Teacher-generated examples follow human-defined rules and are validated | Partial | Strict schema and exact seed-label check are present; all source rows remain pending, and no teacher call has been run. |
| Human review before training | Pending | The single queue `ml/aura_distill/data/review_queue.jsonl` contains 24 assistant-authored pending seeds. No person has approved/rejected them yet; do not invoke automated approval. |
| Benchmark before fine-tuning | Not implemented | No frozen held-out benchmark, baseline comparison or benchmark report exists; do not train until human-reviewed splits and the benchmark gate are ready. |
| Evaluate accuracy, structure, unsafe/prohibited output, interruption/stop, offline tasks, tool selection, escalation and latency | Not implemented | Harness source exists for a narrow schema extraction evaluation, but no comprehensive dataset, evaluation run or measured result exists. |
| Quantize/deploy only after same-benchmark evaluation and actual AI Box hardware test | Not implemented | No trained adapter, conversion/quantization run, target hardware, or deployment evaluation exists. |

Multiple teachers may generate separate drafts into the same queue, and a later SFT run can consume one human-approved consolidated dataset. This does not mean multiple models jointly optimize one student's weights. No teacher/student training has run.

## §64 Frozen HMI authority

Section 64 and its five approved visual references remain authoritative. No layout redesign is authorized by this audit. `apps/web-simulator/src/App.tsx` and `App.css` provide five role previews plus an external developer console. Source presence alone does not verify visual fidelity: a reference-by-reference rendered comparison is still required, and must preserve the five-display hierarchy, tactile slate system, AURA presence, cognitive-load presentation, journey handoff and data-integrity rules in §§64.1–64.8.

| Section | Review requirement | Status |
|---|---|---|
| 64.1 Visual authority and final references | Approved images override conflicting written layout details | Authority preserved; visual comparison unverified. |
| 64.2 Tactile Slate visual system | Preserve specified colors/material/typography/hierarchy | Source exists; rendered comparison unverified. |
| 64.3 Five display layout/content rules | Preserve role-specific five-display composition | Five previews present; only limited live synchronization. |
| 64.4 AURA presence and motion | Presence must communicate state without verbose persona | Visual indicator present; shared state/motion behavior partial. |
| 64.5 Cross-display proposal and handoff | Passenger/rear proposal routes through Center and consent | Passenger/Center path in source; rear and runtime evidence incomplete. |
| 64.6 Cognitive-load presentation | Align UI response with canonical load states | Four-level protocol/policy exists; cross-surface visual behavior not verified. |
| 64.7 Journey timeline and visual handoff | Shared journey handoff matches approved example | Center journey state exists; five-surface handoff incomplete. |
| 64.8 UI data integrity | Clearly distinguish live/simulated/cached/stale/unavailable | Provenance contract exists; inspect every visible factor and runtime state. |

## §61.27 and §61.30 guardrails

- Keep HMI rendering separate from domain logic; current Gateway/Core split supports this, but future provider calls must remain server-side.
- Preserve all cross-display behavior through shared state/events and Action Gate; no LLM may execute an action directly.
- Validate all external inputs and carry source/confidence/freshness; Mapbox and journey types do this in part. Review all adapters for consistent semantics.
- Do not treat mock weather, simulated parking, deterministic regex matching, source presence, or an unverified provider key as live capability.
- Add tests for policy changes when test work is authorized; this audit session did not run tests or builds.
- No new core subsystem should be added unless the frozen Context → Policy/Action → Shared State/Event → Experience architecture cannot express the feature.

## Immediate completion queue

1. Finish Phase 6 source/license provenance fields and ensure the single `ml/aura_distill/data/review_queue.jsonl` remains the only review queue. All records remain pending until a real person decides each row.
2. Wire Phase 8 provider calls through an existing server-side contract and connect recommendation presentation without changing Section 64; keep Search Box temporary-use data out of persistence.
3. Implement and connect the missing resilience path (Phase 10) and a safe simulated camera/perception path (Phase 9) using existing contracts; label every simulated signal.
4. Complete all five display connections and shared presence/visual data-integrity behavior under Section 64.
5. Perform the full M1–M6 scenario and reliability evidence run, plus the required test/build/evaluation work after it is explicitly requested; record exact hardware/provider/model facts.
6. Inventory and disclose all third-party software, model, dataset and media sources and their applicable terms.
7. Re-audit every row, reconcile implementation and docs, then commit and push the intended tree to `codex/aura-v1-integration`.
