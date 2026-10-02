# AURA SFT and offline evaluation

This directory contains an isolated experiment harness for the bounded cabin-setting extraction task in [`docs/architecture/AURA_TEACHER_STUDENT_MODEL_PLAN.md`](../../../docs/architecture/AURA_TEACHER_STUDENT_MODEL_PLAN.md). It does not change the running deterministic simulator or M1–M3 paths. Training and evaluation consume the canonical strict completion schema at [`ml/aura_distill/data/label.schema.json`](../data/label.schema.json): a supported volume/temperature proposal or an `ambiguous`, `unsupported`, or `out_of_scope` abstention.

## Dataset contract consumed by the CLIs

Input files are UTF-8 JSONL, one record per non-empty line. Every row must have `record_id`, `input`, `label`, and `provenance`; `label` is validated against the shared schema. `input` must contain an `en-US` `utterance` and the frozen context:

```json
{"locale":"en-US","utterance":"Turn the cabin volume down","context":{"allowed_task":"cabin_setting_extraction","allowed_settings":["volume","temperature_celsius"]}}
```

Both independent gates must pass on every row: `provenance.review_status=human_approved` and `provenance.source_rights_review_status=approved_internal_training`; pending or rejected status on either gate fails closed in training and evaluation. The harness delegates record validation to `ml/aura_distill/data/records.py`, including source/model license identifiers, separate rights-review status, required source/reviewer/creation fields, and the `source_group` grouping contract. The train CLI verifies train and validation file hashes against the required `manifest.json` emitted by `ml/aura_distill/data/dataset_cli.py split`; it independently rejects overlapping source groups and requires one matching dataset version. Real user transcripts remain outside the current source contract. Each record declares `source_license_id` and `source_rights_review_status`; teacher records separately carry `teacher_model_license_id`. A declared teacher model license does not convey a license to generated output or clear it for redistribution. Internal-training rights approval is not redistribution clearance.

For evaluation rows, add this harness-only extension; the canonical dataset record schema has no evaluation-category field:

```json
"evaluation": {"category":"safety_prohibited","prohibited":true}
```

Categories are `volume`, `temperature`, `ambiguous`, `unsupported`, `out_of_scope`, and `safety_prohibited`. Proposal labels must match the volume/temperature category and set `prohibited:false`; prohibited examples must have an abstention label. The evaluator requires this metadata so it can report abstention by expected category and enforce the zero-candidate safety gate; the gate fails when there are no prohibited examples as well as when any prohibited candidate is emitted.

## Training

The intended pilot student checkpoint is [`Qwen/Qwen3-4B`](https://huggingface.co/Qwen/Qwen3-4B) at immutable revision `1cfa9a7208912126459214e8b04321603b3df60c`; the model card identifies the license as Apache-2.0. This Transformers checkpoint is distinct from the Ollama `qwen3:4b` GGUF used for inference. The CLI remains explicit and accepts another compatible checkpoint only when its exact revision and terms are reviewed.

Create the pinned training environment outside the repository:

```sh
uv venv --python 3.11 /tmp/aura-distill-venv
uv pip install --python /tmp/aura-distill-venv/bin/python -r ml/aura_distill/train/requirements.txt
```

Invoke training explicitly and provide the declared license identifier for the exact base-model revision:

```sh
python3 ml/aura_distill/train/train_sft.py \
  --base-model-id '<approved-model-id-or-local-path>' \
  --base-model-revision '<pinned-revision>' \
  --base-model-license-id '<declared-license-identifier>' \
  --train-file '<approved-train.jsonl>' \
  --validation-file '<approved-validation.jsonl>' \
  --split-manifest '<split-directory/manifest.json>' \
  --output-dir '<new-output-directory>'
```

The CLI refuses unapproved/malformed data, duplicate IDs, manifest hash mismatches, train/validation group leakage, moving revisions such as `main`, and non-empty output directories. Select a Hugging Face Transformers compatible base model, immutable revision, and its declared license identifier explicitly; the CLI makes no model choice and does not accept an Ollama GGUF as a training checkpoint. The SFT manifest records the base-model license identifier and per-record source license IDs, source rights-review statuses, and separate teacher model/revision/license declarations. These are provenance fields, not a legal opinion or approval. Rights-pending AURA drafts carry `AURA_INTERNAL_DRAFT_NO_EXTERNAL_REDISTRIBUTION_LICENSE_ASSIGNED`; nothing in a manifest clears those terms or permits redistribution. The trainer uses TRL `SFTTrainer` with prompt/completion rows and PEFT LoRA, then saves the adapter, tokenizer, and dataset/schema/config manifest. The trainer uses Transformers' available accelerator; `--precision auto` selects float16 on Apple MPS, bfloat16 on supporting CUDA, float16 on other CUDA, or float32 on CPU. These defaults have not yet been measured on the target hardware. The explicit `--qlora` opt-in additionally requires `bitsandbytes` and an available CUDA device; no quantization is selected automatically.

The pinned Hugging Face base checkpoint is present in the local cache at the selected immutable revision; config, tokenizer, and all three indexed weight shards are present and non-empty. No model load, base benchmark, SFT run, adapter, or conversion has been performed. This cache is local environment state and is not part of the Git repository.

## Offline evaluation

Install `transformers`, PyTorch, `jsonschema`, `huggingface_hub`, and `peft` if evaluating an adapter. Model evaluation requires the selected model/revision to already be cached locally; `local_files_only=True` prevents network retrieval. The device defaults explicitly to CPU; request `--device mps` or `--device cuda` only when intentionally measuring there. `--precision auto` selects float16 on MPS, a supported precision on CUDA, and float32 on CPU. The report records process peak RSS and CUDA allocator memory where available; MPS-specific peak accelerator allocation is not currently reported.

```sh
python3 ml/aura_distill/train/evaluate.py \
  --model-id '<selected-model-id-or-local-path>' \
  --model-revision '<pinned-revision>' \
  --model-license-id '<declared-license-identifier>' \
  --dataset-file '<sealed-evaluation.jsonl>' \
  --report-path '<reports/model-eval.json>'
```

An optional adapter is loaded from a local directory with `--adapter-path '<adapter-dir>'`. Output is parsed as exactly one JSON value and checked with the same strict label schema. The report records the supplied model license identifier and every evaluation record's source license ID and rights-review status, plus each teacher model/revision/license declaration. These are declared lineage only: teacher model terms do not transfer to generated records and the report makes no redistribution-clearance claim. It also includes model and dataset SHA-256 hashes, exact `kind + payload` match, schema validity, correct abstention (including exact abstention reason) by category, the prohibited/safety zero-candidate gate, per-row traces, p50/p95/mean latency, and peak memory when the selected platform exposes it. Any prohibited candidate makes the CLI exit non-zero after writing the report.

The deterministic option is only a comparator:

```sh
python3 ml/aura_distill/train/evaluate.py \
  --parity-baseline-mirror \
  --dataset-file '<sealed-evaluation.jsonl>' \
  --report-path '<reports/parity-mirror.json>'
```

`PARITY MIRROR ONLY` copies the volume and temperature regex matching/payload behavior from `adapters/local/gemma2b-offline-simulator.ts`; it is not a trained model or runtime replacement. The existing simulator returns no candidate without an abstention reason, so the mirror supplies evaluator-only abstention labels. An out-of-range match is mapped to the schema's `out_of_scope` abstention label while preserving the baseline's no-candidate behavior.

## Explicit boundaries

- SFT and eval CLIs run only when called; importing files does not load models.
- Evaluation never makes model downloads or teacher/API calls.
- These outputs are experiment artifacts, not runtime candidates. No router, app, protocol, or safety-policy integration is provided.
- These commands do not claim performance on hardware that has not been explicitly measured.
