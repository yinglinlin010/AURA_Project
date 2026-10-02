# Critical Safety Warning Lifecycle

## Frozen behavior

This implementation follows Master Spec §61.13–61.14 and §64.3–64.4,
64.6: critical safety conditions can override a declined coaching offer;
immediate warnings are local-first; Cluster may prioritize critical safety
information; the canonical HMI presence is `WARNING`; and CRITICAL load
suppresses non-safety content on Center and Cluster. This is guidance/HMI
behavior and does not control the vehicle.

## Deterministic event and state path

1. `CoreRuntime.ingestSignal` publishes `context.signal.received`.
2. `SafetySupervisor` recognizes a critical signal and creates an
   `safety.override.activated` event with a supervisor-derived warning,
   decision, and interrupted secondary task IDs.
3. The reducer stores that warning as `activeSafetyWarning` in shared state,
   then records the existing `task.interrupted` events. Snapshots and gateway
   subscribers can observe the persistent warning.
4. Center and Cluster render the shared active warning immediately. Center
   suppresses ordinary journey/map/action content while active; Cluster keeps
   speed/vehicle status and elevates the warning in its existing instrument
   surface.

The protocol and reducer include `safety.warning.cleared`, which can clear
only the matching warning and identifies `safety_supervisor` as the emitter.
No runtime path emits it, and the HMI exposes no acknowledge/dismiss action.

## Open specification decision

Sections 61 and 64 do not say what observable condition clears a critical
warning, whether a driver acknowledgement is allowed, whether a warning can
be replaced by a later warning, or whether clearing restores the prior HMI
surface immediately. The implementation therefore retains the first active
warning until a matching supervisor clear event and does not infer a
sensor-clear or acknowledgement rule. Later critical signals still produce
their own override and task-interruption events; their signals remain in
`latestSignals`, while the already active HMI warning remains visible. Clearing
and restoration semantics require a product decision.

## Scenario and verification boundary

`scenarios/safety/critical-warning-persistence.yaml` starts a secondary task,
then sends a clearly simulated critical signal. Scenario output records the
active warning after each step, including source/freshness, while the final
shared state shows the warning and interrupted task. This definition and the
event/state/UI path were inspected statically; scenario execution, tests,
build, and browser behavior were not verified.
