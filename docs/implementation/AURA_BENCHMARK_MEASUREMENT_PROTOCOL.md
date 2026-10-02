# AURA Competition V1 benchmark measurement protocol

This document defines evidence to collect for the twelve core metrics in Master
Spec §61.20. It defines measurement boundaries; it contains no measured values,
acceptance thresholds, or product capability claims. Product owners must resolve
the open semantics below before collecting comparative results.

## Required run manifest

Every measured run must identify:

- repository revision and working-tree state;
- benchmark/dataset version, content hash, case count, rights/content review
  status, and the evaluator revision;
- model/provider identifier and immutable version/revision/hash, prompt version,
  tool/protocol schema version, and runtime/library versions;
- hardware model, OS/build, audio/display peripherals, power mode, and process
  configuration;
- language, cabin-noise/motion conditions, invocation method, connectivity
  condition, and trial grouping where applicable;
- clock source and synchronization method for all devices;
- raw numerator/denominator, exclusions and reasons, per-trial outcomes, and
  artifact paths. Aggregate values without trial-level evidence are not
  sufficient.

Content and rights approval are independent gates. The current evaluation
registry has zero cases and both gates pending; no model comparison is permitted
until an authorized human approves a held-out dataset. This protocol does not
approve data or set pass thresholds.

## Metric definitions to freeze before testing

| Master Spec metric | Proposed observable and denominator | Required conditions / unresolved decision |
|---|---|---|
| Wake Detection Rate | Correct wake detections divided by adjudicated intentional wake trials. | Freeze wake phrase, language, distance, noise/motion cohorts, timeout window, and what counts as one trial. Requires the target microphone and wake detector. |
| False Wake Rate | Unintended wake activations per hour of eligible non-invocation listening. | Freeze eligible listening time, exclusions, background audio cohorts, and duplicate-trigger window. Requires continuous target-device capture. |
| STT Accuracy | Character error rate for languages without reliable whitespace word boundaries; report word error rate where meaningful, with reference transcript and per-cohort counts. | Freeze language normalization, punctuation/number treatment, transcript adjudication, noise, speaker and microphone conditions. Requires approved audio/text rights. |
| Intent Accuracy | Correct adjudicated intent labels divided by eligible utterance trials. | Freeze intent taxonomy, ambiguous/unsupported handling, tool context, and whether abstention is correct for each case. Requires a sealed held-out set. |
| First Response Latency | Report invocation-to-first-user-perceivable response and end-of-user-turn-to-first response as separate intervals; retain both event timestamps. | Spec does not settle which interval is the headline measure or whether acknowledgement and substantive response differ. Freeze these semantics, output modality, percentile method, hardware and network before comparison. |
| Barge-in Stop Latency | Time from locally detected interruption event to the last audible output sample/frame. | Also retain speech-onset-to-detection separately. Requires synchronized mic/output loopback on the target audio path; synthetic cancellation is not evidence. |
| Action Success Rate | Governed actions that reach the expected terminal state divided by approved execution attempts. | Report by action class and distinguish simulated actions from provider/device execution. Define timeout, partial completion, retry and user cancellation handling. |
| Unsafe Action Block Rate | Adjudicated unsafe proposals blocked before execution divided by unsafe proposal attempts. | Requires a rights-cleared adversarial test set and explicit unsafe taxonomy; report false blocks separately. No unsafe action may be executed to test the block. |
| Display Sync Latency / Sync Spread | For one event, time from authoritative commit to each registered display rendering the matching revision; spread is latest minus earliest display render. | Capture source and render timestamps with a shared clock; report missing/stale clients and per-role results. Logical Gateway receipt is not rendered-device evidence. |
| Offline Capability Retention | Successful supported tasks during verified network loss divided by the same frozen tasks that succeed online. | Report supported/unsupported tasks separately and assert truthful offline/unavailable presentation. Requires controlled network isolation and named target hardware. |
| False Offer Rate | Human-adjudicated non-beneficial proactive offers divided by all proactive offers in the defined observation cohort. | Freeze “beneficial”, offer opportunity, adjudicator protocol and exposure window before collecting; report missed beneficial opportunities separately. |
| Unnecessary Interruption Rate | Human-adjudicated non-urgent interruptions during protected user activity per defined activity-hour (and raw count). | Freeze protected-activity categories, urgency taxonomy, exposure window and adjudication method. Requires representative, rights-cleared sessions. |

These definitions are proposals for consistent collection, not values frozen by
the Master Spec. Where the spec leaves the denominator or event boundary open,
do not compare runs until product owners record the choice in a versioned
protocol revision.

## Evidence classes

- **Simulator regression:** YAML expectations, state invariants and fresh-process
  replay reproducibility. These are local software checks only; process wall
  time is not a §61.20 response, interruption, or synchronization metric.
- **Model comparison:** requires an approved held-out dataset and the exact
  model/prompt/tool/data manifest. Keep every trial and report evaluator-defined
  denominators; the current zero-case registry cannot produce results.
- **Device/provider measurement:** requires the named microphone, speakers,
  displays, target device, controlled network/provider versions and synchronized
  event capture. A browser preview, injected connector, mock transport or
  simulated signal cannot satisfy this class.
- **Human-reviewed outcome:** false offers, interruption necessity, unsafe
  labels, and final reviewer acceptance require an identified human adjudication
  record. An automated model review is not approval.

Never combine these classes into a single score. Never report a percentage before
its dataset, denominator, conditions, and per-trial evidence are reviewable.
