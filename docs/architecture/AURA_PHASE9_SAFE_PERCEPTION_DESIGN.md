# AURA Phase 9 / M5 Safe Perception Path

Status: isolated design and deterministic simulated fixture. This is not an
integrated camera feature and makes no claim of physical-device support.

## Roadmap and authority

The [master spec §61.24](../../docs/product/AURA_MASTER_SPEC_2026-10-02.md#6124-mvp-priority)
lists camera observation and adaptive parking assistance as SHOULD items.
The frozen roadmap in [§61.25](../../docs/product/AURA_MASTER_SPEC_2026-10-02.md#6125-development-roadmap----frozen-order)
places camera/perception at Phase 9 after Phase 8 provider adapters and before
Phase 10 offline/cloud continuity; M5 is “Simulator + camera/context → help
likelihood → proactive assistance offer.” This work does not reorder that
sequence or imply the Phase 9 milestone is integrated.

Section 64 remains the authority for the five display layouts and interaction
hierarchy. In particular, [§64.5](../../docs/product/AURA_MASTER_SPEC_2026-10-02.md#645-cross-display-proposal-and-handoff)
requires display changes to use shared state, policy, and consent, and
[§64.8](../../docs/product/AURA_MASTER_SPEC_2026-10-02.md#648-ui-data-integrity)
requires simulated/live and freshness provenance. This isolated fixture changes
no display layout or visual design.

## Contract

`contracts/perception/schemas/perception-observation.schema.json` defines the
strict v1 observation boundary. Required fields include:

- mandatory `reality: real | simulated`, source kind and source ID;
- observation and receipt timestamps plus freshness state, age, and maximum
  age;
- a bounded confidence value and explicit uncertainty level/reasons;
- a permission state scoped to parking-context observation;
- a narrow parking phase and allow-listed context cues, with no image payload,
  person identity, medical/emotional inference, or vehicle-control command.

The schema requires simulator source and `not_applicable_simulation` permission
for simulated observations. A real observation cannot claim simulator source;
camera/context observations carry an explicit permission state. The evaluator
fails closed for real observations unless permission is `granted`, for stale or
unknown-age observations, confidence below 0.7, or high/unknown uncertainty.

`contracts/perception/schemas/parking-assistance-assessment.schema.json` fixes
the output shape. The deterministic evaluator in
`packages/perception/src/parking-assistance.ts` uses fixed cue weights and a
0.6 likelihood threshold. Only an active parking context with fresh,
permissioned, adequately confident and bounded-uncertainty input can produce
`OFFER`; other inputs produce `NO_OFFER` or `UNCERTAIN`. Each result copies
reality/source/freshness/confidence/uncertainty provenance from its input.

An OFFER is only the text “Would you like parking guidance?”, addressed to
Center, with `requiresConsent: true`. The result contract explicitly fixes
`vehicleControlAllowed`, `diagnosisAllowed`, and `automaticActionAllowed` to
false. It is not an executable action proposal, and it cannot change journey,
vehicle, or shared state.

## Deterministic simulated fixture

`adapters/perception/parking-context-simulator.ts` creates synthetic
parking-context signals only. Its source ID is `fixture:parking-context-v1`,
and every observation states `reality: simulated`; the scenario at
`scenarios/perception/m5-parking-assistance-simulated.json` repeats that marker
at case, input, and expected-output boundaries. It covers one help-likelihood
OFFER and one below-threshold NO_OFFER. No camera is opened, no image or real
user data is used, and no network or model is called.

The scenario is deliberately labeled as an illustrative contract fixture, not
registered with the existing scenario runner. This avoids pretending its
contract is already supported by the runner.

## Integration seam and safety boundary

The existing action path is in `packages/core-runtime/src/core-runtime.ts`;
`CoreRuntime.proposeAction` validates proposals, calls the domain Action Gate,
and routes consent through the current protocol. The gate in
`packages/core-domain/src/action-gate.ts` routes an unconsented proposal to its
target and can defer secondary work at high driver load; the consent manager
then validates the driver response. Those files/contracts are outside this
change's ownership boundary and remain untouched.

There is no mapping from this perception OFFER to a protocol command in this
isolated implementation. A future integration owner may translate the
consent-seeking offer into a supported, allow-listed assistance proposal and
submit it through `CoreRuntime.proposeAction`; the existing policy and Center
consent path must remain authoritative. The adapter must reject any direct
actuator, diagnosis, or auto-action mapping. Until that seam is implemented,
this code is a standalone deterministic contract/evaluator fixture, not an
end-to-end user-visible feature.

## Limits and follow-up

No camera capture/provider, permission UI, retention policy, real-device source,
perception model, runtime event, gateway envelope, display behavior, tests, or
deployment claim is included. Thresholds and cue weights are prototype
constants for transparent fixture behavior, not validated performance or a
safety assessment. A future Phase 9 integration requires owner-approved
protocol/domain/runtime mapping, a real permission lifecycle, and separate
validation while preserving the frozen Phase 8 → 9 → 10 order and Section 64
visual authority.
