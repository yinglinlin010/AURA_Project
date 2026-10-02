# AURA distillation data and human review queue

The local `review_queue.jsonl` currently contains 72 English records: 24 AURA assistant-authored seed records and 48 variations from explicitly selected Ollama teachers. The former seed set is `source_type=assistant_authored`, `review_status=pending`, with a recorded authoring prompt version; it is not misrepresented as human-authored or human-approved. Each seed and variation declares `source_license_id=AURA_INTERNAL_DRAFT_NO_EXTERNAL_REDISTRIBUTION_LICENSE_ASSIGNED` and `source_rights_review_status=pending`. All 72 records remain pending content review and rights review. No real user data is included. The queue is excluded from Git while those decisions remain pending; supply a local queue file explicitly when using the review and training tools.

The strict label contract is the shared canonical `label.schema.json`; record metadata is in `schemas/record.schema.json`. `records.py` provides standard-library exact-key validation and enforces the simulator's precise cabin volume summaries, integer temperature range 16–30 °C, valid provenance combinations, source license declarations, a distinct source-rights review state, and optional AI findings. `provenance.ai_review` is separate from human review status. `teacher_model_license_id` records the declared license for the exact model revision; it does not transfer to teacher-generated records or establish redistribution clearance.

## Human review

Run the interactive terminal queue review with a real reviewer identity:

```sh
python3 ml/aura_distill/data/dataset_cli.py review ml/aura_distill/data/review_queue.jsonl --reviewer-id REVIEWER_ID
```

The reviewer sees every pending record and chooses approve, reject, or edit then decide. Edits may change the utterance and label, are revalidated against the strict contract, and are followed by an explicit decision. Each decision is written back to the same consolidated JSONL by a same-directory temporary file and atomic replacement. A declared reviewer ID and timestamp are recorded; AI review findings and source-rights review fields are left separate and untouched. Content approval does not clear rights review. The CLI does not authenticate reviewer identity, so it must be operated by the actual human reviewer and must not be driven by an AI agent or automated script.

Source-rights review is a separate, human-operated decision:

```sh
python3 ml/aura_distill/data/dataset_cli.py review-rights ml/aura_distill/data/review_queue.jsonl --reviewer-id RIGHTS_REVIEWER_ID
```

For each row whose `source_rights_review_status` is pending, the reviewer chooses `approved_internal_training`, `rejected`, or quit. This command updates only the rights-review fields (`source_rights_review_status`, reviewer ID, and review timestamp) using an atomic same-file replacement; it does not change content `review_status`. Internal-training approval is not redistribution clearance. The CLI requires a declared reviewer ID but does not authenticate the operator; it must be run by the actual human reviewer, not an AI agent or automation.

Validate the queue:

```sh
python3 ml/aura_distill/data/dataset_cli.py validate ml/aura_distill/data/review_queue.jsonl
```

## Teacher generation

The generator sends an Ollama JSON Schema format that constrains the response shape, exact requested variation count, utterance length, and seed label; it independently validates each returned row. Jobs are scheduled round-robin across seeds, so a concurrency setting of two can run two different teacher models together.

Generation has no import-time or default network behavior. The user must explicitly run it with the queue and one or more repeated `--teacher OLLAMA_ENDPOINT MODEL REVISION MODEL_LICENSE_ID` specifications. Every endpoint must explicitly end in `/api/chat`, and every exact model revision and declared license identifier must be named. Requests are keyless Ollama chat requests; endpoint URLs with embedded credentials are rejected. Only approved `human_authored` rows and pending `assistant_authored` seeds are sent. Teacher response labels must exactly match their seed labels; all generated rows use `source_type=teacher_generated`, preserve the seed's `source_group`, retain model/revision/model-license/prompt/source provenance, and remain `review_status=pending` and `source_rights_review_status=pending`. Each generated row's source license remains the AURA internal-draft/no-external-redistribution declaration; it does not inherit the model's license. The append is validated and written atomically to the same queue. By default, teacher requests run one at a time. Set `--max-concurrent-requests 2` to ask two teacher requests at a time; this can load multiple models and KV caches concurrently, so select a value that fits available memory. Output ordering and IDs are stable for the same teacher specifications and responses; specify `--generated-at` to stabilize the timestamp as well. Inference output itself is not guaranteed reproducible by the model.

Example with two explicitly chosen local models (this command is documentation only and was not run):

```sh
python3 ml/aura_distill/data/generate_teacher_variations.py \
  --queue ml/aura_distill/data/review_queue.jsonl \
  --teacher http://localhost:11434/api/chat TEACHER_MODEL_A REVISION_A LICENSE_ID_A \
  --teacher http://localhost:11434/api/chat TEACHER_MODEL_B REVISION_B LICENSE_ID_B \
  --variations-per-seed 2 --max-concurrent-requests 2
```

Review endpoint ownership and data handling before invoking a teacher. No model call, training, or download occurs unless the generation CLI is explicitly run.

## Approved-data splits

Splits contain only records that pass both independent gates: `review_status=human_approved` and `source_rights_review_status=approved_internal_training`. Rows pending or rejected on either gate are excluded, and exclusion counts are printed and saved in the manifest. All eligible records in a `source_group` remain in exactly one split; the command writes a deterministic hash manifest and requires at least three eligible groups. Internal-training approval does not clear records for external redistribution.

```sh
python3 ml/aura_distill/data/dataset_cli.py split ml/aura_distill/data/review_queue.jsonl --output-dir splits --seed 20261002
```

These data tools do not train a model or alter the runtime, deterministic simulator, policy, or safety boundary.
