# AURA Teacher–Student Model Plan

**Status:** Prototype plan only; no model, dataset, or runtime integration is selected or created by this document.
**Scope:** A bounded supervised fine-tuning (SFT) experiment for extracting supported, non-safety action proposals from text.
**Authority:** The frozen [AURA Master Spec](../product/AURA_MASTER_SPEC_2026-10-02.md), especially §§61.9–61.10, 61.14, 61.19–61.21, 61.25, 59–60, and the current protocol/schema. If this plan conflicts with frozen architecture or policy, the frozen spec wins.

## Recommendation

Proceed with a **data and evaluation feasibility experiment in parallel** with the integrated M1–M3 work. Keep it outside the running application: do not replace the deterministic `Gemma2BOfflineSimulator`, alter the M1 Control Console/Cluster telemetry path, change the M2 Passenger → Center proposal/consent/journey path, or bypass the M3 voice/Gateway/Intelligence Router path. A trained student is only a candidate generator. Any later runtime integration must submit validated candidates through the existing Core Runtime and deterministic Action Gate; this plan does not authorize that integration.

The first task should be deliberately narrower than the Master Spec’s full local-AI direction:

> Given a short text utterance, produce either a typed `CHANGE_CABIN_SETTING` candidate for the currently supported volume or cabin-temperature commands, or abstain.

This matches the two commands recognized by the current deterministic simulator. The proposed approach is **example-level teacher-output distillation followed by SFT**, not logit/hidden-state distillation. It is **not** an action executor, policy model, safety model, voice activity detector, general assistant, or substitute for live journey/provider data. The M2 stop proposal remains an explicit Passenger UI command, not a model-generated action.

## Repository and roadmap evidence

- The frozen roadmap in Master Spec §61.25 puts **Local AI / Ollama in Phase 6**, after Phase 5 voice, and places benchmark/reliability work in Phase 12. §§59–60 call for task-specific behavior, scenario-backed data, human review of teacher-generated examples, evaluation before tuning, and quantization/deployment only after model and hardware evaluation.
- `adapters/local/gemma2b-offline-simulator.ts` is explicitly deterministic-only. It maps a small set of volume and temperature text patterns to `CHANGE_CABIN_SETTING` candidates; it loads no weights and performs no inference. Keep its identity and behavior as the baseline and fallback until any later review approves a replacement.
- `packages/core-runtime/src/intelligence-router.ts` checks the local deterministic model first, otherwise asks the configured cloud `ProposalSource`, schema-validates the candidate, and only then submits a proposal through `CoreRuntime.proposeAction()`. Its current local interface is deterministic and synchronous; it does not provide a trained-model or Ollama inference path. A future student needs a separately reviewed routing/adapter change, then its candidate must return through `CoreRuntime.proposeAction()`. The Core Runtime’s deterministic policy owns route/defer/reject/execute outcomes. A student must not produce or override those outcomes.
- `apps/core-host/src/intelligence.ts` wires `Gemma2BOfflineSimulator` as the local interface. Voice provider selection is separate. The running host does not establish that a fine-tuned local model or Ollama is present. Places, routing, weather, and SQLite adapter implementations exist, but the external adapter stack is not started by the host entry point.
- Current scenario assets are `scenarios/cognitive-load-deferral.yaml` and `scenarios/safety-override.yaml`. They cover policy deferral/consent and safety interruption; they are not student-model training data or a held-out intent benchmark. The Master Spec §61.21 proposes an `evaluation/` structure, but no such evaluation dataset directory or model benchmark asset currently exists in the repository.
- The documented deployment target is Android HMI / Android 14+ / Target SDK 34, with a proposed main-computer/AI-Box plus tablet topology. The frozen spec explicitly leaves the actual compute hardware, exact model, inference runtime, latency and memory targets for measurement. This plan assumes **no particular GPU, NPU, RAM, AI Box model, or training host**.

## Task definition and safety boundary

### Included first-task intents

Only existing deterministic local patterns:

| Intent family | Candidate kind and payload | Constraints |
|---|---|---|
| Volume adjustment | `CHANGE_CABIN_SETTING`, `{ "setting": "volume", "direction": "up" | "down" }` | Direction must be explicit; no arbitrary numeric gain or device routing. |
| Cabin temperature adjustment | `CHANGE_CABIN_SETTING`, `{ "setting": "temperature_celsius", "value": number }` | Range follows the existing supported 16–30 °C behavior; out-of-range or unclear values abstain. |

For the first parity pilot, use English (`en-US`) utterances because that is the deterministic simulator’s current pattern language. This is not a product locale decision: Master Spec §61.21 explicitly suggests `zh-TW` intent evaluation, so passing the English pilot cannot establish Traditional Chinese readiness; add a separately reviewed zh-TW benchmark before any broader Competition V1 claim.

Candidate metadata for this narrow task is fixed to `targetRole: "center"`, `priority: "normal"`, and `requiresConsent: true`. The model may extract the requested value and concise summary; it may not choose a display role, priority, consent requirement, or execution outcome.

Out of scope: `WARN`, safety/hazard classification, steering/braking/acceleration, parking control, arbitrary cabin controls, journey routing, external tools, medical/driver diagnosis, camera/perception, and decisions about whether an action is safe, allowed, deferred, routed, or executable. A safety-related, unsupported, contradictory, or ambiguous request must not be “handled” by generative safety reasoning. It receives no candidate and stays on the existing deterministic/policy paths.

### Teacher target schema

Store one JSON object per line. The `label` is the only supervised completion; provenance belongs in the record metadata and is not copied into the model response.

```json
{
  "record_id": "sha256:...",
  "input": {
    "locale": "en-US",
    "utterance": "Turn the cabin volume down",
    "context": {
      "allowed_task": "cabin_setting_extraction",
      "allowed_settings": ["volume", "temperature_celsius"]
    }
  },
  "label": {
    "decision": "proposal",
    "candidate": {
      "kind": "CHANGE_CABIN_SETTING",
      "summary": "Decrease cabin audio volume",
      "targetRole": "center",
      "priority": "normal",
      "requiresConsent": true,
      "payload": { "setting": "volume", "direction": "down" }
    }
  },
  "provenance": {
    "source_type": "teacher_generated",
    "source_id": "sha256:...",
    "teacher_model": "teacher-model-id",
    "teacher_revision": "immutable-revision",
    "prompt_version": "teacher-prompt-v1",
    "review_status": "human_approved",
    "reviewer_id": "reviewer-pseudonym",
    "created_at": "ISO-8601 UTC",
    "dataset_version": "aura-cabin-extraction-v1"
  }
}
```

The only allowed completion variants are:

```json
{"decision":"proposal","candidate":{"kind":"CHANGE_CABIN_SETTING","summary":"Decrease cabin audio volume","targetRole":"center","priority":"normal","requiresConsent":true,"payload":{"setting":"volume","direction":"down"}}}
{"decision":"proposal","candidate":{"kind":"CHANGE_CABIN_SETTING","summary":"Set cabin temperature to 22 degrees","targetRole":"center","priority":"normal","requiresConsent":true,"payload":{"setting":"temperature_celsius","value":22}}}
{"decision":"abstain","reason":"ambiguous"}
```

For abstention, `reason` is one of `ambiguous`, `unsupported`, or `out_of_scope`.

The completion contract should be implemented as a strict JSON Schema (draft 2020-12 or the selected validator's supported equivalent), with `additionalProperties: false` at every level. Its normative shape is:

```json
{
  "oneOf": [
    {
      "type": "object",
      "required": ["decision", "candidate"],
      "properties": {
        "decision": { "const": "proposal" },
        "candidate": {
          "type": "object",
          "required": ["kind", "summary", "targetRole", "priority", "requiresConsent", "payload"],
          "properties": {
            "kind": { "const": "CHANGE_CABIN_SETTING" },
            "summary": { "type": "string", "minLength": 1, "maxLength": 200 },
            "targetRole": { "const": "center" },
            "priority": { "const": "normal" },
            "requiresConsent": { "const": true },
            "payload": {
              "oneOf": [
                {
                  "type": "object",
                  "required": ["setting", "direction"],
                  "properties": { "setting": { "const": "volume" }, "direction": { "enum": ["up", "down"] } },
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "required": ["setting", "value"],
                  "properties": { "setting": { "const": "temperature_celsius" }, "value": { "type": "integer", "minimum": 16, "maximum": 30 } },
                  "additionalProperties": false
                }
              ]
            }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": ["decision", "reason"],
      "properties": {
        "decision": { "const": "abstain" },
        "reason": { "enum": ["ambiguous", "unsupported", "out_of_scope"] }
      },
      "additionalProperties": false
    }
  ]
}
```

These records are a **training-label schema**, not a new wire protocol. Before any runtime integration, a narrow validator must convert a `proposal` completion into the current `ActionProposalCandidate` shape, reject unknown fields/kinds/settings/ranges, and map `abstain` to no submitted proposal. It must not turn a model completion into `PolicyDecision`, consent, or a domain event. The existing JSON Schema and candidate validator remain authoritative for protocol and candidate acceptance.

## Dataset, provenance, and privacy review

1. **Write human-owned behavior rules first.** Define supported and excluded command patterns, locale, value normalization, ambiguity cases, and expected abstentions before asking any teacher for variations. Include positive examples for volume and temperature plus ambiguous, conflicting, out-of-range, unrelated, safety-related, and adversarially phrased requests.
2. **Generate only bounded synthetic variations.** If a teacher model is used, prompt it with the approved behavior table and schema. Teacher output is untrusted draft material: schema-check it, canonicalize it, then have a qualified human approve each label or a risk-weighted review sample with all edge cases fully reviewed. Do not treat teacher self-confidence as correctness.
3. **Do not ingest microphone recordings, transcripts from real users, vehicle identifiers, trip history, driver profiles, or personal data for this experiment.** Start with authored or synthetic utterances. Any later use of real data requires a separate privacy/consent, retention, access, deletion, and external-processing review. No teacher API/provider is selected here; external processing, model terms, data residency, budget, and approval are unresolved. No external model/API is called as part of this plan.
4. **Preserve lineage.** Record source type, immutable teacher/model and prompt revisions when applicable, human review state, label schema version, source/license terms, creation date, dataset version, and cryptographic content hashes. Exclude any record lacking a permitted source and review status. Store raw data and generated artifacts outside application/runtime source until repository policy and licensing are agreed.
5. **Split by source group, not random utterance.** Assign scenario template, semantic seed, and all its paraphrases to exactly one partition to prevent near-duplicate leakage. Proposed initial split: 70% train, 15% validation, 15% sealed test, stratified by supported intent and abstention category. Freeze and hash the test partition before tuning; never use test examples for prompt edits, teacher regeneration, early stopping, or threshold selection.

Suggested minimum sealed evaluation set: 500 reviewed utterances, with at least 100 each covering volume, temperature, ambiguous/contradictory requests, unsupported/out-of-scope requests, and requests outside the task allowlist that are safety-related/prohibited. Under the proposed 70/15/15 split, a 500-case test partition implies roughly 3,300 reviewed records overall; if that is infeasible, reduce the sample floor explicitly and report uncertainty rather than imply the same generalization confidence. This is a proposed feasibility floor, not a statistically validated guarantee; expand it if subgroup confidence intervals are too wide. Keep training examples separate from all five test groups.

## Training and local inference experiment

### Baselines and SFT

Evaluate three candidates on identical partitions: (1) the existing deterministic simulator, (2) the selected small base model with the extraction prompt/schema but no fine-tuning, and (3) the same student after SFT. This identifies whether a failure is already solved by deterministic rules or prompt/schema constraints and whether tuning adds value. Do not tune before the behavior rules, labels, and baseline benchmark are frozen, consistent with Master Spec Appendix A.

If the base model is legally and technically suitable, use supervised prompt/completion fine-tuning. A reasonable first training route is Hugging Face TRL `SFTTrainer` with PEFT LoRA; consider QLoRA only if measured training memory requires quantizing the frozen base during adapter training. The official [TRL SFTTrainer guide](https://huggingface.co/docs/trl/sft_trainer), [PEFT LoRA guide](https://huggingface.co/docs/peft/main/en/conceptual_guides/lora), and [PEFT quantization guide](https://huggingface.co/docs/peft/developer_guides/quantization) describe these current tool interfaces. These are workflow candidates, not decisions that a particular model is supported, affordable, or appropriate.

Keep the prompt short and versioned, provide only the current task’s allowlist, and request the exact label schema. Use constrained JSON/schema output when the selected local runtime supports it, but always parse and validate the response independently; Ollama documents JSON Schema structured output in its [structured outputs guide](https://docs.ollama.com/capabilities/structured-outputs). No decoding option or schema-constrained generation replaces the app-side validator.

### Quantized local inference path (candidate, hardware-dependent)

1. Select a small text model only after comparing supported language/locale behavior, model and tokenizer license, architecture/export compatibility, base quality, memory, cold-start and p50/p95 latency on the actual intended target. The Master Spec §61.10’s Ollama direction is a development preference, not evidence Ollama is installed or validated on the eventual AI Box.
2. Save immutable base model revision, tokenizer/chat template, SFT config, adapter weights, seed, package versions, and exact dataset/split hashes. Keep an unmodified base checkpoint and LoRA adapter as reproducible artifacts.
3. Compare deployment alternatives after SFT: **A)** merge the LoRA adapter into the base model and export/quantize a supported GGUF; **B)** retain a compatible adapter format if the chosen runtime/model supports it; or **C)** use a runtime-native supported format. Do not assume every architecture, tokenizer, LoRA variant, or quantizer round-trips without output-equivalence checks.
4. For a GGUF path, the official [llama.cpp model/quantization docs](https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md) describe conversion followed by quantization, and [Ollama model import docs](https://docs.ollama.com/import) state that GGUF must be quantized before Ollama import. Compare at least one quality-preserving higher-bit option and one smaller quantized option only if compatible; record quality and memory changes rather than presuming a quantization level.
5. If the offline experiment passes, propose a separately reviewed router/adapter change: preserve the existing deterministic matcher as the first exact-command path, and call the student only for its bounded task after a deterministic no-match. The current router does not yet expose a trained local inference path; do not describe this proposed seam as already wired. A student candidate passes strict task allowlisting, JSON parse, current candidate schema validation, and existing `CoreRuntime.proposeAction()` / Action Gate flow. Unsupported output becomes abstention. Define online fallback and offline failure behavior explicitly in that future change; none is implied by this plan. No M1–M3 UI or protocol flow is replaced.

### Compute options; no hardware assumptions

The repository specifies Android 14+/Target SDK 34 and a proposed main-computer/AI-Box plus tablet topology, but it does not specify the AI Box chipset, accelerator, usable RAM/VRAM, operating system for inference, or a training host. Use one of these explicit alternatives after inventory:

- **Available development workstation GPU:** train LoRA or QLoRA only after measuring VRAM, compatible kernels, and model support. Record exact hardware/software rather than generalizing results to the AI Box.
- **Approved shared/hosted GPU:** use only if budget, model/data license, access controls, and data residency are approved. Synthetic-only data is still subject to teacher/base-model terms. No hosted resource is presumed available.
- **CPU-only development host:** use for schema/evaluation harness work and, if performance permits, small-model inference; do not promise feasible fine-tuning duration or demo latency until measured.
- **Target AI Box or representative hardware:** required before any on-device performance or deployability claim. Inventory it first; if unavailable, report the deployment gate as unresolved and keep the model experimental.

Training compute and inference deployment are separate decisions. QLoRA reducing training memory does not prove that the quantized result fits, starts, or meets latency goals on target inference hardware.

## Offline evaluation and proposed acceptance gates

Run inference offline against the frozen test set, with fixed prompt, decoding settings, runtime/model hashes, and no teacher calls. Report per-intent confusion matrix, exact canonical candidate match (including payload), abstention behavior, raw JSON validity, post-validator acceptance, and per-example failure traces with personal data absent. Compare deterministic, untuned base, SFT, and every evaluated quantization. Report p50/p95 latency, peak resident memory, cold-start time, and artifact size **on named hardware only**; do not invent target-device numbers.

Proposed go/no-go gates for a later shadow/integration review:

- **Exact structured extraction:** at least 98% exact kind + payload match for each supported intent and at least 97% overall on supported test requests.
- **Safe abstention:** at least 98% correct abstention on ambiguous/unsupported requests and 100% no-proposal outcome for the sealed safety-related/prohibited set. Any prohibited candidate accepted by the task validator is an automatic failure, regardless of aggregate accuracy.
- **Output contract:** at least 99.5% raw schema-valid completions; 100% of completions passed onward are allowlisted and valid after the deterministic validator. Malformed or unknown output must fail closed.
- **No policy authority:** 100% of candidate submission in the harness goes through the unchanged Action Gate/Consent path; test that model output cannot set or alter policy outcome, consent, task execution, or safety override. Repeat proposals across load states and verify only deterministic Core policy controls defer/route/reject.
- **Value above baseline:** require at least a proposed +5 percentage-point exact-match improvement over the deterministic baseline on the preregistered natural-paraphrase subset, with the paired 95% bootstrap confidence interval excluding zero and no regression on the other gates. If the sample is too small to support that comparison or the student merely paraphrases rules already handled reliably, retain the simpler baseline and collect reviewed cases rather than claiming a win.
- **Deployment gate:** no ship decision until the quantized artifact meets the measured memory/latency budget on the actual target or a formally accepted representative. Hardware and latency budgets are currently unknown, so this gate is intentionally unresolved.

These thresholds are proposed experiment gates, not existing AURA benchmark results or Master Spec commitments. Zero observed errors in a finite test set is not proof of safety; the deterministic allowlist, parser/validator, consent, Action Gate, and Safety Supervisor remain mandatory.

## Versioning, promotion, and rollback

For each experiment record a manifest containing: student/base model ID and immutable revision, license, tokenizer/chat-template hash, dataset and split hashes, label-schema version, teacher/prompt provenance summary, SFT/LoRA/QLoRA configuration, random seed, training libraries and versions, adapter/merged/quantized artifact hashes, quantization method, runtime version, evaluation report, hardware inventory, and approver.

Keep artifacts out of application source until a model-artifact policy exists. Promotion is opt-in and staged: offline eval → local shadow comparison with deterministic output → explicit review → versioned runtime configuration. Preserve the previous model/runtime configuration and deterministic simulator artifact as rollback targets. Roll back immediately on validator breach, any prohibited candidate, worse held-out safety/abstention gate, model-load failure, or exceeded measured latency/memory budget. A rollback changes only the local candidate source/config; it must not alter M1–M3 wire contracts or the Core policy path.

Unknowns requiring an owner before training or integration:

- Approved base student and teacher models, languages, license compatibility, and redistribution constraints.
- Whether teacher-generated examples may be sent to an external service; budget, data residency, and review requirements.
- Actual target/representative hardware, available training compute, inference runtime support, RAM/VRAM, latency and startup budgets.
- Final canonical schema, locale coverage, review staffing, dataset retention/access/deletion, and acceptable uncertainty/abstention behavior.
- Whether the model adds measurable value over the existing deterministic commands, and how a future runtime artifact is packaged and updated.

## Minimal Phase 1 sequence

1. **Freeze the task card:** volume and temperature extraction only; list no-proposal and adversarial cases; keep all policy/safety decisions out of labels.
2. **Define and validate the label schema:** version it separately from the protocol; hand-author a small gold seed set and a validator before teacher generation.
3. **Inventory candidates and constraints:** model licenses/languages/runtime support and compute options; no weight download or paid API call until explicitly approved.
4. **Build the offline benchmark first:** group-safe train/validation/sealed-test split; run current deterministic baseline and untuned candidate when weights are available; publish exact-match and abstention breakdowns.
5. **Generate/review data:** create synthetic teacher variations from approved templates, attach provenance, validate every label, and privacy-review the resulting corpus.
6. **Run one SFT adapter experiment:** use the selected student and documented LoRA/optional QLoRA setup; stop if the student does not beat the relevant baseline or violates any gate.
7. **Quantize and compare:** test compatible candidate formats/quantizations on available hardware; do not claim target deployment if representative hardware is missing.
8. **Write a promotion decision:** report metrics, risks, artifact manifest, rollback package, and whether a separate implementation proposal is justified. Runtime integration remains a later reviewed task.

## Relationship to frozen milestones

This experiment is **compatible with parallel M1–M3 work only as an isolated plan/data/evaluation track**. M1’s shared vehicle state and Control Console, M2’s direct Passenger proposal → Center consent → shared Journey path, and M3’s browser voice/Gateway path remain authoritative and unchanged. The experiment does not intercept their commands, replace their UI, modify protocol envelopes, bypass consent, or make model-generated decisions.

The frozen roadmap places local AI/Ollama at Phase 6, after the voice pipeline, and benchmarking at Phase 12. Its M2 example names Rear → Center; the integrated UI currently exercises a Front Passenger → Center proposal, while the repository's headless scenario also covers Rear → Center. This student task does not alter either path. M1–M3 provide relevant shared-state, cross-display, and user-started browser voice/Gateway boundaries, but do not imply a trained local student exists or that wake-word invocation is implemented. Phase 1 here means the first bounded feasibility experiment, **not** a renumbering or reordering of the frozen roadmap. Any live student integration should wait for the experiment gates and a separately scoped Phase 6/12-compatible implementation review.
