# AURA evaluation registry (draft)

This folder instantiates the five suites proposed in Master Spec §61.21. It is a versioned registry and contract, not a populated or executed benchmark. Every JSONL file is intentionally empty (`case_count: 0`); both content and rights gates are pending. Do not interpret the empty suites or the cabin extraction evaluator as cross-domain results.

Validate registry shape, case counts, and file hashes without loading a model:

```sh
python3 evaluation/validate_registry.py
```

## Files and current state

`manifest.json` binds suite paths, exact case counts and SHA-256 hashes, dataset version, the protocol schema's version and content hash, and the required comparison dimensions. A comparison's `dataset_sha256` is the SHA-256 of this registry file, which in turn binds all suite hashes. `manifest.schema.json` prevents a registry from claiming `sealed_approved` unless both human review gates say approved. `comparison.schema.json` defines the metadata and metric shape for future measured runs and hard-codes `benchmark_claim_allowed: false` until a separate evidence review process exists.

The suites are `intent/zh-TW_commands.jsonl`, `parking/assistance_cases.jsonl`, `recommendation/journey_cases.jsonl`, `safety/unsafe_action_cases.jsonl`, and `conversation/interruption_cases.jsonl`. Each case added later must have a stable ID, an expected outcome/tool/structured result as applicable, provenance, content review status, and source rights review status. Keep evaluation data separate from SFT training records and never use assistant or teacher authored examples as approved ground truth by default.

## Dimensions

The run contract requires intent accuracy, tool selection, structured output validity, latency in milliseconds, unsafe action proposal rate, response length in tokens, and task completion. Compare only runs using the same sealed dataset hash and version, tool schema version, and compatible measurement conditions; record prompt version and immutable model revision/hash. Hardware and provider-specific §61.20 measures (wake detection, STT, barge-in, display sync, offline retention, interruption rates) need their own instrumentation and must not be inferred from these model-level metrics.

The existing `ml/aura_distill/train/evaluate.py` remains a narrow offline cabin-setting experiment. Its reports cover schema validity, exact intent/payload match, abstention, a prohibited-output gate, latency, and memory. It does not populate these suites or measure tool selection, response length, task completion, or real vehicle/peripheral benchmarks.

No dataset rows, model inference, training, or benchmark results are included by this scaffold. A future human review must decide both content and rights status; internal-use clearance and model-license declarations do not imply redistribution permission.
