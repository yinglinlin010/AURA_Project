"""Strict standard-library validation for AURA distillation JSONL records."""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

DATASET_VERSION = "aura-cabin-extraction-v1"
INTERNAL_DRAFT_LICENSE_ID = "AURA_INTERNAL_DRAFT_NO_EXTERNAL_REDISTRIBUTION_LICENSE_ASSIGNED"
CONTEXT = {"allowed_task": "cabin_setting_extraction", "allowed_settings": ["volume", "temperature_celsius"]}
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
PROVENANCE_KEYS = {"source_type", "source_id", "source_group", "source_license_id", "source_rights_review_status", "source_rights_reviewer_id", "source_rights_reviewed_at", "teacher_model", "teacher_revision", "teacher_model_license_id", "prompt_version", "review_status", "reviewer_id", "reviewed_at", "created_at", "dataset_version", "ai_review"}
AI_REVIEW_KEYS = {"model", "prompt_version", "findings", "reviewed_at"}


class RecordError(ValueError):
    pass


def _object_without_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise RecordError(f"duplicate JSON object key: {key}")
        result[key] = value
    return result


def _keys(value: Any, expected: set[str], where: str) -> dict:
    if not isinstance(value, dict):
        raise RecordError(f"{where} must be an object")
    if set(value) != expected:
        raise RecordError(f"{where} keys must be exactly {sorted(expected)}; got {sorted(value)}")
    return value


def _string(value: Any, where: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise RecordError(f"{where} must be a non-empty string of at most {maximum} characters")
    return value


def validate_license_identifier(value: Any, where: str, maximum: int = 256) -> str:
    identifier = _string(value, where, maximum)
    if identifier.strip().lower() in {"unknown", "unspecified", "none", "null", "n/a", "not provided"}:
        raise RecordError(f"{where} must be an explicit declared license identifier, not a placeholder")
    return identifier


def validate_label(label: Any) -> dict:
    if not isinstance(label, dict):
        raise RecordError("label must be an object")
    decision = label.get("decision")
    if decision == "abstain":
        _keys(label, {"decision", "reason"}, "label")
        if not isinstance(label["reason"], str) or label["reason"] not in {"ambiguous", "unsupported", "out_of_scope"}:
            raise RecordError("label.reason is unsupported")
        return label
    if decision != "proposal":
        raise RecordError("label.decision must be proposal or abstain")
    _keys(label, {"decision", "candidate"}, "label")
    c = _keys(label["candidate"], {"kind", "summary", "targetRole", "priority", "requiresConsent", "payload"}, "label.candidate")
    if c["kind"] != "CHANGE_CABIN_SETTING" or c["targetRole"] != "center" or c["priority"] != "normal" or c["requiresConsent"] is not True:
        raise RecordError("candidate metadata does not match the supported proposal contract")
    _string(c["summary"], "candidate.summary", 200)
    payload = c["payload"]
    if not isinstance(payload, dict):
        raise RecordError("candidate.payload must be an object")
    if payload.get("setting") == "volume":
        _keys(payload, {"setting", "direction"}, "candidate.payload")
        if not isinstance(payload["direction"], str) or payload["direction"] not in {"up", "down"}:
            raise RecordError("volume direction must be up or down")
        wanted = "Increase cabin audio volume" if payload["direction"] == "up" else "Decrease cabin audio volume"
    elif payload.get("setting") == "temperature_celsius":
        _keys(payload, {"setting", "value"}, "candidate.payload")
        value = payload["value"]
        if isinstance(value, bool) or not isinstance(value, int) or not 16 <= value <= 30:
            raise RecordError("temperature value must be an integer from 16 through 30")
        wanted = f"Set cabin temperature to {value} degrees"
    else:
        raise RecordError("candidate.payload.setting is unsupported")
    if c["summary"] != wanted:
        raise RecordError(f"candidate.summary must match simulator output: {wanted!r}")
    return label


def validate_record(record: Any) -> dict:
    r = _keys(record, {"record_id", "input", "label", "provenance"}, "record")
    if not isinstance(r["record_id"], str) or not ID_RE.fullmatch(r["record_id"]):
        raise RecordError("record_id has invalid format")
    inp = _keys(r["input"], {"locale", "utterance", "context"}, "input")
    if inp["locale"] != "en-US":
        raise RecordError("input.locale must be en-US")
    _string(inp["utterance"], "input.utterance", 500)
    ctx = _keys(inp["context"], {"allowed_task", "allowed_settings"}, "input.context")
    if ctx != CONTEXT:
        raise RecordError("input.context must exactly match supported extraction task/settings")
    validate_label(r["label"])
    p = _keys(r["provenance"], PROVENANCE_KEYS, "provenance")
    if not isinstance(p["source_type"], str) or p["source_type"] not in {"human_authored", "assistant_authored", "teacher_generated", "scenario_derived"}:
        raise RecordError("provenance.source_type is unsupported")
    for key, maximum in (("source_id", 256), ("source_group", 160), ("source_license_id", 256), ("dataset_version", 128)):
        _string(p[key], f"provenance.{key}", maximum)
    for key, maximum in (("teacher_model", 256), ("teacher_revision", 256), ("teacher_model_license_id", 256), ("prompt_version", 128), ("reviewer_id", 128), ("source_rights_reviewer_id", 128)):
        if p[key] is not None:
            _string(p[key], f"provenance.{key}", maximum)
    if not isinstance(p["review_status"], str) or p["review_status"] not in {"pending", "human_approved", "human_rejected"}:
        raise RecordError("provenance.review_status is unsupported")
    if not isinstance(p["source_rights_review_status"], str) or p["source_rights_review_status"] not in {"pending", "approved_internal_training", "rejected"}:
        raise RecordError("provenance.source_rights_review_status is unsupported")
    if p["source_rights_review_status"] == "pending":
        if p["source_rights_reviewer_id"] is not None or p["source_rights_reviewed_at"] is not None:
            raise RecordError("pending rights review cannot name a reviewer or reviewed_at")
    elif p["source_rights_reviewer_id"] is None or p["source_rights_reviewed_at"] is None:
        raise RecordError("completed rights review requires reviewer_id and reviewed_at")
    reviewed_at = p["reviewed_at"]
    if reviewed_at is not None:
        if not isinstance(reviewed_at, str) or not reviewed_at.endswith("Z"):
            raise RecordError("provenance.reviewed_at must be null or an ISO-8601 UTC timestamp ending in Z")
        try:
            datetime.fromisoformat(reviewed_at[:-1] + "+00:00")
        except ValueError as e:
            raise RecordError("provenance.reviewed_at is malformed") from e
    rights_reviewed_at = p["source_rights_reviewed_at"]
    if rights_reviewed_at is not None:
        if not isinstance(rights_reviewed_at, str) or not rights_reviewed_at.endswith("Z"):
            raise RecordError("provenance.source_rights_reviewed_at must be null or an ISO-8601 UTC timestamp ending in Z")
        try:
            datetime.fromisoformat(rights_reviewed_at[:-1] + "+00:00")
        except ValueError as e:
            raise RecordError("provenance.source_rights_reviewed_at is malformed") from e
    created = p["created_at"]
    if not isinstance(created, str) or not created.endswith("Z"):
        raise RecordError("provenance.created_at must be an ISO-8601 UTC timestamp ending in Z")
    try:
        datetime.fromisoformat(created[:-1] + "+00:00")
    except ValueError as e:
        raise RecordError("provenance.created_at is malformed") from e
    if p["dataset_version"] != DATASET_VERSION:
        raise RecordError(f"provenance.dataset_version must be {DATASET_VERSION}")
    ai = p["ai_review"]
    if ai is not None:
        ai = _keys(ai, AI_REVIEW_KEYS, "provenance.ai_review")
        _string(ai["model"], "provenance.ai_review.model", 256)
        _string(ai["prompt_version"], "provenance.ai_review.prompt_version", 128)
        if not isinstance(ai["findings"], list) or any(not isinstance(x, str) or not x.strip() or len(x) > 1000 for x in ai["findings"]):
            raise RecordError("provenance.ai_review.findings must be an array of non-empty strings up to 1000 characters")
        reviewed_at = ai["reviewed_at"]
        if not isinstance(reviewed_at, str) or not reviewed_at.endswith("Z"):
            raise RecordError("provenance.ai_review.reviewed_at must be an ISO-8601 UTC timestamp ending in Z")
        try:
            datetime.fromisoformat(reviewed_at[:-1] + "+00:00")
        except ValueError as e:
            raise RecordError("provenance.ai_review.reviewed_at is malformed") from e
    st, rs = p["source_type"], p["review_status"]
    if st == "human_authored":
        if any(p[k] is not None for k in ("teacher_model", "teacher_revision", "teacher_model_license_id", "prompt_version")):
            raise RecordError("human_authored records must have null teacher fields")
        if rs == "pending":
            if p["reviewer_id"] is not None or p["reviewed_at"] is not None:
                raise RecordError("pending human_authored records cannot name a reviewer")
        elif p["reviewer_id"] is None or p["reviewed_at"] is None:
            raise RecordError("reviewed human_authored records require reviewer_id and reviewed_at")
    elif st == "assistant_authored":
        if p["source_license_id"] != INTERNAL_DRAFT_LICENSE_ID:
            raise RecordError("assistant_authored records must retain the AURA internal-draft source license identifier")
        if any(p[k] is not None for k in ("teacher_model", "teacher_revision", "teacher_model_license_id")):
            raise RecordError("assistant_authored records must have null teacher fields")
        if rs == "pending":
            if p["reviewer_id"] is not None or p["reviewed_at"] is not None:
                raise RecordError("pending assistant_authored records cannot name a reviewer")
        elif p["reviewer_id"] is None or p["reviewed_at"] is None:
            raise RecordError("reviewed assistant_authored records require reviewer_id and reviewed_at")
        _string(p["prompt_version"], "provenance.prompt_version", 128)
    elif st == "teacher_generated":
        if p["source_license_id"] != INTERNAL_DRAFT_LICENSE_ID:
            raise RecordError("teacher-generated output is not assigned the teacher model's license; use the AURA internal-draft source license identifier")
        _string(p["teacher_model"], "provenance.teacher_model", 256)
        _string(p["teacher_revision"], "provenance.teacher_revision", 256)
        validate_license_identifier(p["teacher_model_license_id"], "provenance.teacher_model_license_id")
        _string(p["prompt_version"], "provenance.prompt_version", 128)
        if rs == "pending" and (p["reviewer_id"] is not None or p["reviewed_at"] is not None):
            raise RecordError("pending records cannot name a reviewer or reviewed_at")
        if rs != "pending" and (p["reviewer_id"] is None or p["reviewed_at"] is None):
            raise RecordError("reviewed teacher records require reviewer_id and reviewed_at")
    elif st == "scenario_derived":
        if any(p[k] is not None for k in ("teacher_model", "teacher_revision", "teacher_model_license_id", "prompt_version")) or rs == "pending" or p["reviewer_id"] is None or p["reviewed_at"] is None:
            raise RecordError("scenario_derived records require human review and no teacher fields")
    return r


def read_jsonl(path: str | Path) -> list[dict]:
    records, ids = [], set()
    with open(path, encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            if not line.strip():
                raise RecordError(f"{path}:{line_no}: blank lines are not allowed")
            try:
                item = json.loads(line, object_pairs_hook=_object_without_duplicate_keys)
                validate_record(item)
            except (json.JSONDecodeError, RecordError) as e:
                raise RecordError(f"{path}:{line_no}: {e}") from e
            if item["record_id"] in ids:
                raise RecordError(f"{path}:{line_no}: duplicate record_id {item['record_id']}")
            ids.add(item["record_id"])
            records.append(item)
    return records


def write_jsonl(path: str | Path, records: list[dict]) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for item in records:
            validate_record(item)
            f.write(json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
