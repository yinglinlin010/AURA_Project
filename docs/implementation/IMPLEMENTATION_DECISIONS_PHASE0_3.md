# AURA Backend Implementation Notes — Phases 0–3

## Implemented scope

- Phase 0: versioned TypeScript protocol contracts, JSON Schema validation boundary, and a data-driven Display Registry.
- Phase 1: immutable event envelopes, an in-process idempotent event bus, shared-state reducer, WebSocket registration/command/snapshot/resync gateway, and command receipts.
- Phase 2: headless YAML scenario loading and timeline replay through `CoreRuntime.ingestSignal()` and `CoreRuntime.submitCommand()`.
- Phase 3 assignment: deterministic Safety Supervisor, cognitive-load Action Gate, role-scoped Consent Manager, and abortable secondary task tracking.

No UI, React, HTML, CSS, Compose, or visual baseline files were changed.

## Contract and policy choices

- `ContextSignal.timestamp` remains numeric and provenance includes `sensor`, `simulated`, `api`, `derived`, and `cache`, following Master Spec §61.12.
- Scenario signal `source` is assigned by the simulator as `simulated`; the YAML author cannot label a scenario signal as a live sensor.
- A critical signal is recognized by `type: safety.critical`, a string value `critical`, or an object whose `severity` or `level` is `critical` (case-insensitive). This is a deterministic intake convention proposed for review because the Master Spec does not freeze a signal severity schema.
- Driver load uses the canonical `low`, `normal`, `high`, and `critical` levels; no observation is represented by an absent `currentLoad` and confidence remains separate metadata. Secondary proposals defer at `high` or `critical` and are re-evaluated when load falls below `high` (`normal` or `low`); no observation follows the route path.
- A proposal requiring consent is routed to its target role and held at `awaiting_consent`. Only a command authenticated to that target role can move it to `executing`; approval creates a cancellable runtime task. The gate does not actuate vehicle controls.
- Protocol command and event validation is in-process plus JSON Schema at the WebSocket boundary. The gateway validates both inbound client messages and outbound server messages. Command and signal idempotency records, event history, and shared state are process-memory only.
- Event IDs are fingerprinted and deduplicated for the runtime session; reusing an ID with changed event content is rejected. Published envelopes and payloads are cloned and deeply frozen. Replay history is bounded (default 5,000 events) independently from the per-session deduplication ledger; both are process-memory only.
- The protocol schema declares typed payloads for every domain event and a complete server-message union. Gateway input validation remains at the WebSocket client-message boundary; server output is produced from the matching TypeScript union.

## Roadmap label discrepancy

The System Architect task file labels Action Gate / Consent / Safety as Phase 3. The frozen Master Spec §61.25 assigns Phase 3 to the five-display skeleton and Display Registry, then assigns Action / Policy / Consent / Safety to Phase 4. Runtime Implementation Design §10 groups these as Phases 3–4. The implementation follows the newly assigned work while preserving the Master Spec roadmap labels in this record.

Master Spec Phase 2 includes a Control Console. The current assignment explicitly requires a headless simulator and NO UI, so only the Scenario Runner is included.

## Deferred decisions

- WebSocket authentication, device enrollment, and network exposure policy.
- Durable persistence, retention, encryption, and deletion controls.
- Signal freshness expiry rules and a formal safety severity taxonomy.
- Exact cognitive-load scoring and hysteresis.
- Production routing/provider selection and runtime performance targets.

## Scenario Runner

After building the TypeScript project, run a scenario with:

```sh
npm run scenario -- scenarios/cognitive-load-deferral.yaml
```

The Runner uses virtual relative timeline offsets for signal timestamps and command `sentAt`, then waits those offsets against wall-clock time. The scenario output prints receipts and the resulting shared state. The scenario runner was not executed. `./node_modules/.bin/tsc --noEmit` passed, and `npm run test:event-bus` passed all five tests.
