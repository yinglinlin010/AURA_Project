# Phase 9 M5: Simulated Parking Assistance

This implementation is a deterministic simulator fixture for the frozen M5
milestone. It does not capture camera data, contact a model or cloud service,
read physical vehicle signals, diagnose a driver, or actuate a vehicle.

## Flow

`perception.parking` scenario steps create a schema-shaped synthetic
observation through `adapters/perception/parking-context-simulator.ts`.
`packages/perception/src/parking-assistance.ts` validates provenance and
freshness fields and computes a deterministic help-likelihood assessment.
Only a qualified assessment enters CoreRuntime as a Center-targeted,
secondary `SHOW_GUIDANCE` proposal with required driver consent. The existing
Action Gate defers this non-critical proposal at HIGH/CRITICAL; existing load
events release it when the driver returns to NORMAL/LOW, where consent is
still required. Decline leaves the proposal declined. Approval starts only a
simulator task/presentation state; it cannot cause a vehicle-control action.

The Center renders the governed proposal inside its existing action panel,
labels its simulator provenance and freshness, and states that no vehicle
control is available. The five display compositions and gateway/consent
contract are unchanged.

## Scenario

Run from the repository root with the existing simulator runner:

```sh
npm run scenario -- scenarios/perception/m5-parking-assistance-simulated.yaml --fast
```

The scenario creates two offers at HIGH and CRITICAL load. It lowers load to
NORMAL/LOW, then records one driver decline and one driver approval. The
runner output includes each synthetic observation, assessment, provenance,
initial policy outcome/status, per-step proposal status/consent/provenance
snapshots, command receipts, and final shared state.
The authored file and runtime behavior are statically integrated but were not
executed in this task.

## Limits

This demonstrates only deterministic simulated context and the existing
policy/consent path. It does not establish camera permissions or quality,
parking safety, real guidance behavior, physical-device integration, or
competition readiness. Existing behavior has no guidance executor; approval
only marks a generic simulator task as executing and the Center explains the
simulator-only result.

Urgent warnings are not ordinary proposals. The deterministic Safety
Supervisor consumes critical context signals and emits
`context.signal.received` followed by `safety.override.activated`; its
interruption behavior and shared Center/Cluster presentation remain separate
from Action Gate consent and load deferral. Acknowledgement and clearing
semantics remain unspecified, so no dismissal control is offered; generic
provider/model candidates cannot create `WARN` proposals or claim urgent
priority.
