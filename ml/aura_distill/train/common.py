"""Shared fail-closed dataset and label handling for AURA SFT and offline eval."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "data" / "label.schema.json"
RECORD_VALIDATOR_PATH = Path(__file__).resolve().parents[1] / "data" / "records.py"
SUPPORTED_SETTINGS = ["volume", "temperature_celsius"]
EVAL_CATEGORIES = {
    "volume",
    "temperature",
    "ambiguous",
    "unsupported",
    "out_of_scope",
    "safety_prohibited",
}
_RECORD_VALIDATOR: Any | None = None


class ContractError(ValueError):
    pass


def validate_declared_license_id(value: str, where: str) -> str:
    normalized = value.strip()
    if not normalized or len(normalized) > 256 or normalized.lower() in {"unknown", "unspecified", "none", "null", "n/a", "not provided"}:
        raise ContractError(f"{where} must be an explicit declared license identifier, not a placeholder")
    return normalized


class DuplicateKeyError(ValueError):
    pass


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for key, value in pairs:
        if key in output:
            raise DuplicateKeyError(f"duplicate object key {key!r}")
        output[key] = value
    return output


def require_jsonschema() -> tuple[Any, Any]:
    try:
        from jsonschema.validators import validator_for
    except ImportError as exc:
        raise RuntimeError("Install the 'jsonschema' package to validate the shared strict label schema.") from exc
    try:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Cannot load shared label schema: {exc}") from exc
    validator_class = validator_for(schema)
    validator_class.check_schema(schema)
    return validator_class, schema


def validate_label(label: Any, validator: Any, line_number: int) -> None:
    errors = sorted(validator.iter_errors(label), key=lambda error: list(error.path))
    if errors:
        first = errors[0]
        location = "/" + "/".join(str(part) for part in first.path)
        raise ContractError(f"line {line_number}: invalid label at {location}: {first.message}")


def load_jsonl(path: Path, validator: Any, *, split: str, for_evaluation: bool = False) -> list[dict[str, Any]]:
    if not path.is_file():
        raise ContractError(f"{split} file does not exist or is not a file: {path}")
    records: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw.strip():
            raise ContractError(f"{path}:{line_number}: blank JSONL rows are not allowed")
        try:
            record = json.loads(raw, object_pairs_hook=reject_duplicate_keys)
        except json.JSONDecodeError as exc:
            raise ContractError(f"{path}:{line_number}: malformed JSON: {exc.msg}") from exc
        except DuplicateKeyError as exc:
            raise ContractError(f"{path}:{line_number}: malformed JSON: {exc}") from exc
        validate_record(record, validator, line_number, split=split, for_evaluation=for_evaluation)
        record_id = record["record_id"]
        if record_id in seen_ids:
            raise ContractError(f"{path}:{line_number}: duplicate record_id {record_id!r}")
        seen_ids.add(record_id)
        records.append(record)
    if not records:
        raise ContractError(f"{split} file is empty: {path}")
    return records


def validate_record(record: Any, validator: Any, line_number: int, *, split: str, for_evaluation: bool) -> None:
    prefix = f"{split} line {line_number}"
    if not isinstance(record, dict):
        raise ContractError(f"{prefix}: record must be a JSON object")
    required = {"record_id", "input", "label", "provenance"}
    missing = required - record.keys()
    if missing:
        raise ContractError(f"{prefix}: missing record keys: {', '.join(sorted(missing))}")
    if not isinstance(record["record_id"], str) or not record["record_id"].strip():
        raise ContractError(f"{prefix}: record_id must be a non-empty string")
    if set(record) - (required | {"evaluation"}):
        raise ContractError(f"{prefix}: unsupported top-level fields: {', '.join(sorted(set(record) - (required | {'evaluation'})))}")

    # Reuse the dataset package's exact record contract, including source_group
    # and review lineage, while allowing the evaluator-only metadata extension.
    base_record = {key: value for key, value in record.items() if key != "evaluation"}
    try:
        canonical_record_validator().validate_record(base_record)
    except (ImportError, OSError, ValueError) as exc:
        raise ContractError(f"{prefix}: invalid dataset record: {exc}") from exc

    provenance = record["provenance"]
    review_status = provenance.get("review_status")
    if review_status != "human_approved":
        raise ContractError(f"{prefix}: fail-closed; review_status must be human_approved (got {review_status!r})")
    rights_status = provenance.get("source_rights_review_status")
    if rights_status != "approved_internal_training":
        raise ContractError(f"{prefix}: fail-closed; source_rights_review_status must be approved_internal_training (got {rights_status!r})")
    source_input = record["input"]
    if not isinstance(source_input, dict) or not isinstance(source_input.get("utterance"), str) or not source_input["utterance"].strip():
        raise ContractError(f"{prefix}: input.utterance must be a non-empty string")
    if set(source_input) != {"locale", "utterance", "context"}:
        raise ContractError(f"{prefix}: input must contain exactly locale, utterance, and context")
    if source_input.get("locale") != "en-US":
        raise ContractError(f"{prefix}: the initial parity pilot accepts only locale en-US")
    context = source_input.get("context")
    if not isinstance(context, dict) or set(context) != {"allowed_task", "allowed_settings"} or context.get("allowed_task") != "cabin_setting_extraction" or context.get("allowed_settings") != SUPPORTED_SETTINGS:
        raise ContractError(f"{prefix}: input.context must use the frozen cabin_setting_extraction allowlist")

    validate_label(record["label"], validator, line_number)
    if for_evaluation or "evaluation" in record:
        evaluation = record.get("evaluation")
        if not isinstance(evaluation, dict):
            raise ContractError(f"{prefix}: evaluation metadata is required by the evaluation CLI")
        category = evaluation.get("category")
        if not isinstance(category, str) or category not in EVAL_CATEGORIES:
            raise ContractError(f"{prefix}: evaluation.category must be one of {sorted(EVAL_CATEGORIES)}")
        if not isinstance(evaluation.get("prohibited"), bool):
            raise ContractError(f"{prefix}: evaluation.prohibited must be a boolean")
        if category == "safety_prohibited" and evaluation["prohibited"] is not True:
            raise ContractError(f"{prefix}: safety_prohibited examples must set evaluation.prohibited=true")
        if set(evaluation) != {"category", "prohibited"}:
            raise ContractError(f"{prefix}: evaluation must contain exactly category and prohibited")


def split_group_ids(records: list[dict[str, Any]]) -> set[str]:
    return {record["provenance"]["source_group"] for record in records}


def dataset_license_lineage(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Return record-level source rights and separate teacher-model license declarations."""
    record_entries = []
    for row in sorted(records, key=lambda item: item["record_id"]):
        provenance = row["provenance"]
        record_entries.append({
            "record_id": row["record_id"],
            "source_type": provenance["source_type"],
            "source_id": provenance["source_id"],
            "source_group": provenance["source_group"],
            "review_status": provenance["review_status"],
            "reviewer_id": provenance["reviewer_id"],
            "reviewed_at": provenance["reviewed_at"],
            "source_license_id": provenance["source_license_id"],
            "source_rights_review_status": provenance["source_rights_review_status"],
            "source_rights_reviewer_id": provenance["source_rights_reviewer_id"],
            "source_rights_reviewed_at": provenance["source_rights_reviewed_at"],
            "teacher_model": provenance["teacher_model"],
            "teacher_revision": provenance["teacher_revision"],
            "teacher_model_license_id": provenance["teacher_model_license_id"],
        })
    source_states = sorted({(r["source_license_id"], r["source_rights_review_status"]) for r in record_entries})
    teacher_models = sorted({(r["teacher_model"], r["teacher_revision"], r["teacher_model_license_id"])
                             for r in record_entries if r["teacher_model"] is not None})
    return {
        "records": record_entries,
        "source_license_rights_states": [
            {"source_license_id": license_id, "source_rights_review_status": rights_status}
            for license_id, rights_status in source_states
        ],
        "teacher_model_license_declarations": [
            {"model": model, "revision": revision, "license_id": license_id}
            for model, revision, license_id in teacher_models
        ],
        "notice": "approved_internal_training is not redistribution clearance. A teacher model license declaration identifies the model's declared terms only; it does not assign or imply a license for generated records or authorize redistribution.",
    }


def canonical_record_validator() -> Any:
    global _RECORD_VALIDATOR
    if _RECORD_VALIDATOR is None:
        import importlib.util

        spec = importlib.util.spec_from_file_location("aura_data_records", RECORD_VALIDATOR_PATH)
        if spec is None or spec.loader is None:
            raise RuntimeError("Cannot load the canonical data record validator")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _RECORD_VALIDATOR = module
    return _RECORD_VALIDATOR


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def directory_sha256(path: Path) -> str:
    root = path.resolve()
    if root.is_file():
        return file_sha256(root)
    digest = hashlib.sha256()
    files = sorted(item for item in root.rglob("*") if item.is_file())
    if not files:
        raise ContractError(f"Cannot hash an empty model directory: {root}")
    for item in files:
        relative = item.relative_to(root).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(8, "big"))
        digest.update(relative)
        with item.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def completion_prompt(utterance: str, schema_text: str) -> str:
    return (
        "You extract only supported cabin volume or cabin temperature commands. "
        "Return exactly one JSON object matching the schema, with no markdown or other text. "
        "Never make safety or policy decisions; abstain for unsupported, ambiguous, out-of-range, "
        "or safety-related requests.\n"
        f"Schema:\n{schema_text}\n"
        f"Utterance:\n{utterance}\n"
        "JSON completion:\n"
    )
