# Model Readiness and Preflight Evaluation

## Baseline Evidence
- **Baseline SHA:** `f5b6d211a7d2a53cd33924e06a5a775f80332251` (from branch `codex/aura-v1-integration`)

## Readiness Gates
The evaluation registry (`evaluation/manifest.json`) serves as a preflight check for data and model artifacts. It is not an authorization for training, an assertion of model correctness, or a benchmark claim. It requires:
1. **Required Suites:** All five required suites (`intent_zh_tw`, `parking_assistance`, `journey_recommendation`, `unsafe_action`, `conversation_interruption`) must be present.
2. **Non-empty Data:** Each suite must have a `case_count` greater than 0. Currently, all suites have 0 cases.
3. **Status and Content/Rights Approval:** The registry status must be `sealed_approved`. The `review_gates` for `content` and `rights` must be explicitly marked as `approved`. Currently, both remain `pending_human_review`.
4. **Model Artifacts:** The preflight tool checks for the presence of local model artifacts (such as `config.json` and `.safetensors` files) in the explicitly specified path without loading weights into memory. Note that the presence of model files does not imply training readiness or accuracy.

**Note on Manual Review:**
Human review for data content and rights clearance will be conducted subsequently by the responsible user/authorizer. No automated approval or metric spoofing is performed by the readiness tool.

## Reproducible Validation Commands
A non-inference preflight readiness check tool is provided to ensure all blockers are resolved prior to inference or benchmark execution.

To execute the readiness check:
```sh
python3 evaluation/check_readiness.py \
  --model-path <local_model_directory> \
  --model-revision <explicit_model_revision>
```
*Expected behavior in the current pending state: The command will exit non-zero and explicitly list the empty suites, missing suites, pending review gates, draft status, and any missing model parameters or artifacts as blockers in JSON format.*

To execute the unit tests for the readiness check (testing empty, pending, missing model artifacts, and fully qualified fixtures):
```sh
python3 evaluation/test_check_readiness.py
```
