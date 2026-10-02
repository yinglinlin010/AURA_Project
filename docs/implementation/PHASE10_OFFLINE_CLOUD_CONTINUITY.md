# Phase 10 Offline / Cloud Router and Continuity

**Status:** backend protocol/runtime behavior and the simulated Control Console path are implemented; automated five-client Gateway verification and the deterministic scenario pass. This does not verify a real network interface, provider outage, or provider recovery.

**Authority:** Master Spec [§61.16](../product/AURA_MASTER_SPEC_2026-10-02.md#6116-rear-to-driver-collaboration), [§§64.5–64.7](../product/AURA_MASTER_SPEC_2026-10-02.md#645-cross-display-proposal-and-handoff), [§§61.19–61.21](../product/AURA_MASTER_SPEC_2026-10-02.md#6119-testing-architecture), [§61.25](../product/AURA_MASTER_SPEC_2026-10-02.md#6125-development-roadmap----frozen-order), and [§61.27](../product/AURA_MASTER_SPEC_2026-10-02.md#6127-coding-agent-guardrails). This implementation stays within Context → Policy/Action → Shared State/Event → Experience and does not alter HMI composition.

## Cross-display load policy (§61.16, §§64.5–64.7)

The generic `ActionProposal`/provider path accepts only `secondary` and `normal` priorities and cannot submit `WARN`; it cannot self-promote to urgent or bypass high-load deferral. The Action Gate defers all generic proposals while driver load is `high` or `critical`. Critical context signals use the separate deterministic Safety Supervisor override path and activate shared warning state. When load returns to `normal` or `low`, `CoreRuntime` reevaluates deferred proposals through the Action Gate: an already-consented proposal carries its consent back into policy revalidation, while an unconsented proposal routes to Center and still awaits driver approval before a journey update.

## Connectivity state and events

`AuraSharedState.connectivity` stores the canonical `online`, `degraded`, or `offline` mode plus source, observed time, freshness, and bounded evidence. A new `connectivity.state.changed` domain event is the only reducer path for changing this state. `CoreRuntime.updateConnectivity()` validates and publishes the event; an ingested `connectivity.mode` context signal is also recorded as `context.signal.received` before it produces the connectivity event. The initial state is `degraded` with derived/unknown freshness and `CONNECTIVITY_UNCONFIRMED`, so startup does not claim a successful cloud probe.

Connectivity updates replace only the connectivity record. They preserve the runtime session, journey, consent state, pending proposals, tasks, and other shared state. Successful cloud provider responses record derived `online` evidence. Provider errors record derived `degraded` evidence before attempting fallback unless an explicit offline transition arrived while that request was pending; in that case offline state is retained. If a request started while online completes after an explicit offline transition, its result is discarded and local continuity is used.

The web Control Console exposes **Set network online / degraded / offline** buttons. Those buttons send `connectivity.mode.report`; Core Runtime ingests it as a `connectivity.mode` signal with `source: simulated`, publishes the normal shared state event, and leaves every non-connectivity state field intact. All five logical browser sockets receive the event and reconnect snapshots retain the selected mode. The display source label remains visible so this control cannot be mistaken for an operating-system connectivity probe.

## Routing behavior

- Deterministic local commands (currently the explicit simulator adapter) remain available in all connectivity modes.
- In `offline`, the router does not invoke `ProposalSource.proposeFromText`; it may use an injected student candidate only when that dependency is configured, then tries the deterministic local command path. Unsupported inputs return `availability: unavailable` without claiming a successful response.
- In `online` or `degraded`, the router tries cloud first for non-deterministic commands. If the cloud call fails or returns an invalid candidate, it records degraded evidence and tries the configured local student candidate, then the deterministic local command. Results expose `availability` as `cloud`, `local`, `offline_local`, or `unavailable`, with a fallback reason when applicable.
- A streamed provider proposal received after the shared state is explicitly offline is rejected before it reaches the action policy.
- Proposal results still pass through `CoreRuntime.proposeAction()` and the existing policy/consent path. A returned proposal means it was submitted for policy handling, not that a vehicle action executed.

## Reproducible scenario

[`scenarios/connectivity/phase10-offline-cloud-continuity.yaml`](../../scenarios/connectivity/phase10-offline-cloud-continuity.yaml) seeds and consents to a journey stop through registered display commands, routes one intent through a simulated cloud provider, creates a governed proposal awaiting center consent, signals simulated offline state, routes a supported local volume command, then signals simulated recovery and routes another cloud intent. The scenario runner records route availability, connectivity before/after, session continuity, journey stop IDs, and proposal statuses around each intent. For every connectivity transition it asserts journey and governed-proposal preservation and records source/freshness evidence. Run it with the existing simulator scenario CLI in an environment where the project dependencies are already available:

```sh
npm run scenario -- scenarios/connectivity/phase10-offline-cloud-continuity.yaml --fast
```

The CLI's scenario cloud provider is a deterministic in-process fixture and the local fallback uses the deterministic simulator adapter. Connectivity changes from both the scenario and Control Console are simulated signals. This scenario makes no live network, cloud-provider, model, hardware, latency, or deployment claim.

## Verification boundary

Automated evidence: the multi-client Gateway test submits a simulated offline transition, verifies one shared event reaches all five connected clients, checks `source: simulated` and command/trace lineage, confirms shared state changes, and verifies a reconnect snapshot retains offline state. Live network detection, network-interface transitions, provider behavior, and physical display behavior remain unverified.
