# TASK: AURA Project - Backend Phase 0 & 1 (Core Runtime & Contracts)

**To:** Codex / Backend Engineering Agent
**From:** System Architect (via Orca Orchestration)
**Reference Docs:** `../product/AURA_MASTER_SPEC_2026-10-02.md`, `../architecture/AURA_RUNTIME_IMPLEMENTATION_DESIGN.md`
**UI Baseline:** `../../AURA_UI_UX_Handoff/images/*_final.jpg` (For reference ONLY, DO NOT implement UI in this task).

## ⚠️ STRICT BOUNDARY WARNING
- **DO NOT** write any React, HTML, CSS, or Android Jetpack Compose code in this task.
- **DO NOT** implement visual layouts.
- Focus **EXCLUSIVELY** on `Phase 0 (Contracts)` and `Phase 1 (Shared State, Event Bus, Gateway)` as defined in Section 10 of the Runtime Implementation Design.
- Language: **TypeScript / Node.js** for Core Runtime.

---

## 1. INTEGRATION MAPPING (UX to Runtime Policy)
When implementing the Domain Logic and Policy Decisions, you must map the UX interaction scenarios to the `PolicyOutcome` enums:

1. **Safety Override (AEB / Critical Alerts)**
   - UX: Cluster Display turns Signal Red immediately.
   - Runtime: Bypasses AI/Cloud. Handled by `Safety Supervisor` -> Emits `EXECUTE` priority command -> Dispatches critical domain event.
2. **Rear-to-Driver Proposal (POI / Climate)**
   - UX: Rear passenger taps a tile. Wait for Driver confirmation on Center Display.
   - Runtime: `ActionProposal` generated -> Policy evaluates as `ROUTE` (Target: Center/Driver) -> Transitions to `AWAITING_CONSENT`.
3. **Cognitive Load Deferral (High Speed / Intersection)**
   - UX: Incoming notifications are held back if driver is busy.
   - Runtime: Context Engine detects high load -> Policy evaluates incoming proposal as `DEFER` -> Stores with `deferUntil` conditions.

---

## 2. DISPATCH: PHASE 0 (Contracts & Configuration)
**Target Location:** `contracts/protocol/`

**Task Details:**
1. Define JSON Schemas / TypeScript Interfaces for the core data exchange protocol over WebSocket.
2. Create `Command` definitions (Requests for change).
3. Create `Event` definitions (Immutable facts of what happened).
4. Create `State Snapshot` schema (The exact structure sent to the 5 HMI clients to render the UI).
5. Define the `Display Registry` config schema (mapping logical roles like `Cluster`, `Center` to physical connections).

---

## 3. DISPATCH: PHASE 1 (Core Runtime & Gateway)
**Target Location:** `packages/core-domain/`, `packages/core-runtime/`, `apps/core-host/`

**Task Details:**
1. **Shared State & Reducers:** Implement the centralized state machine in `core-domain`. It must hold vehicle state, active tasks, and active proposals.
2. **Event Bus:** Implement an idempotent event bus in `core-runtime` that tracks `sessionId`, `traceId`, and `commandId` for observability.
3. **HMI Gateway (WebSocket Server):** Implement the `core-host` entry point. It must spin up a WebSocket server that allows 5 abstract clients to connect, subscribe to state updates, and push commands.
4. **Resilience:** Ensure that if a WebSocket client disconnects and reconnects, it receives the latest State Snapshot to resynchronize without re-running actions.

---
**Completion Condition:**
Output the TypeScript contract definitions (Phase 0) and the directory structure initialization (Phase 1) for the Architect to review. Stop and await further instructions before implementing external adapters or local AI inference.
