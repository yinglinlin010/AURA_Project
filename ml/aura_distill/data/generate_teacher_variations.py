"""Append review-pending drafts from explicitly selected Ollama teachers."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    from .records import RecordError, read_jsonl, validate_label, validate_license_identifier, validate_record, write_jsonl
except ImportError:  # pragma: no cover - direct script execution
    from records import RecordError, read_jsonl, validate_label, validate_license_identifier, validate_record, write_jsonl

PROMPT_VERSION = "aura-ollama-variation-v1"


def call_ollama(endpoint: str, model: str, revision: str, seed: dict, count: int, timeout: int) -> list[dict]:
    parsed = urllib.parse.urlsplit(endpoint)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password or not parsed.path.endswith("/api/chat"):
        raise RecordError("each teacher endpoint must be an explicit HTTP(S) Ollama URL ending in /api/chat, without embedded credentials")
    prompt = {
        "instruction": "Create English paraphrases of the given utterance that preserve exactly the given narrow cabin-setting extraction label. Return only JSON with a variations array; each item has exactly utterance and label. Do not introduce safety, policy, consent, or execution decisions.",
        "utterance": seed["input"]["utterance"], "label": seed["label"], "count": count,
        "allowed_task": "cabin_setting_extraction", "allowed_settings": ["volume", "temperature_celsius"]
    }
    output_schema = {
        "type": "object",
        "properties": {
            "variations": {
                "type": "array",
                "minItems": count,
                "maxItems": count,
                "items": {
                    "type": "object",
                    "properties": {
                        "utterance": {"type": "string", "minLength": 1, "maxLength": 500},
                        "label": {"const": seed["label"]},
                    },
                    "required": ["utterance", "label"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["variations"],
        "additionalProperties": False,
    }
    body = {"model": model, "messages": [{"role": "user", "content": json.dumps(prompt, ensure_ascii=False)}], "stream": False, "format": output_schema, "options": {"temperature": 0}}
    request = urllib.request.Request(endpoint, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as e:
        raise RecordError(f"Ollama request for {model}@{revision} failed ({type(e).__name__}); response content suppressed") from e
    try:
        content = result["message"]["content"]
        decoded = json.loads(content)
    except (KeyError, TypeError, json.JSONDecodeError) as e:
        raise RecordError(f"Ollama {model}@{revision} response did not contain JSON content") from e
    if not isinstance(decoded, dict) or set(decoded) != {"variations"} or not isinstance(decoded["variations"], list) or len(decoded["variations"]) != count:
        raise RecordError(f"Ollama {model}@{revision} must return exactly {count} variations")
    return decoded["variations"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--queue", required=True, help="the consolidated queue, appended atomically")
    parser.add_argument("--teacher", action="append", nargs=4, metavar=("OLLAMA_ENDPOINT", "MODEL", "REVISION", "MODEL_LICENSE_ID"), required=True,
                        help="repeat once per teacher; declare the exact license identifier for that model revision")
    parser.add_argument("--variations-per-seed", type=int, default=2, choices=range(1, 6))
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--max-concurrent-requests", type=int, default=1, choices=range(1, 4), help="Explicit Ollama generation concurrency; default 1 avoids loading multiple teacher models together.")
    parser.add_argument("--generated-at", help="optional explicit ISO-8601 UTC timestamp for reproducible manifests")
    args = parser.parse_args()
    try:
        queue = Path(args.queue).resolve()
        if not queue.is_file():
            raise RecordError("--queue must name an existing consolidated JSONL file")
        if args.timeout < 1 or args.timeout > 600:
            raise RecordError("--timeout must be 1..600 seconds")
        now = args.generated_at or datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        if not now.endswith("Z"):
            raise RecordError("--generated-at must be an ISO-8601 UTC timestamp ending in Z")
        datetime.fromisoformat(now[:-1] + "+00:00")
        teachers = []
        for endpoint, model, revision, model_license_id in args.teacher:
            model, revision, model_license_id = model.strip(), revision.strip(), model_license_id.strip()
            if not model or len(model) > 256 or not revision or len(revision) > 256 or not model_license_id or len(model_license_id) > 256:
                raise RecordError("every --teacher must provide model, immutable revision, and explicit model license identifier")
            validate_license_identifier(model_license_id, "teacher model license identifier")
            parsed = urllib.parse.urlsplit(endpoint)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password or not parsed.path.endswith("/api/chat"):
                raise RecordError("each --teacher endpoint must explicitly end in /api/chat and contain no credentials")
            teachers.append((endpoint, model, revision, model_license_id))
        if len({(endpoint, model, revision) for endpoint, model, revision, _ in teachers}) != len(teachers):
            raise RecordError("duplicate teacher specifications are not allowed")
        teachers.sort(key=lambda t: (t[1], t[2], t[0], t[3]))
        records = read_jsonl(queue)
        seeds = [r for r in records if (r["provenance"]["source_type"] == "human_authored" and r["provenance"]["review_status"] == "human_approved") or
                 (r["provenance"]["source_type"] == "assistant_authored" and r["provenance"]["review_status"] == "pending")]
        if not seeds:
            raise RecordError("queue has no approved human_authored or pending assistant_authored seed records")
        # Round-robin teachers per seed so a concurrency value of two can
        # actually exercise two distinct teacher models at the same time.
        jobs = [(endpoint, model, revision, license_id, seed)
                for seed in sorted(seeds, key=lambda r: r["record_id"])
                for endpoint, model, revision, license_id in teachers]
        def generate_job(job: tuple[str, str, str, str, dict]) -> tuple[str, str, str, str, dict, list[dict]]:
            endpoint, model, revision, license_id, seed = job
            return endpoint, model, revision, license_id, seed, call_ollama(endpoint, model, revision, seed, args.variations_per_seed, args.timeout)

        generated = []
        with ThreadPoolExecutor(max_workers=args.max_concurrent_requests) as pool:
            results = pool.map(generate_job, jobs)
            for endpoint, model, revision, model_license_id, seed, variations in results:
                for idx, variation in enumerate(variations, 1):
                    if not isinstance(variation, dict) or set(variation) != {"utterance", "label"}:
                        raise RecordError(f"{model}@{revision}: each variation must contain only utterance and label")
                    utterance = variation["utterance"]
                    if not isinstance(utterance, str) or not utterance.strip() or len(utterance) > 500:
                        raise RecordError(f"{model}@{revision}: generated utterance must be non-empty and at most 500 characters")
                    label = validate_label(variation["label"])
                    if label != seed["label"]:
                        raise RecordError(f"{model}@{revision}: generated label must exactly match its seed")
                    record_id = "teacher-" + hashlib.sha256(f"{endpoint}\0{model}\0{revision}\0{model_license_id}\0{seed['record_id']}\0{idx}\0{utterance}".encode()).hexdigest()[:28]
                    row = {"record_id": record_id, "input": {"locale": "en-US", "utterance": utterance, "context": seed["input"]["context"]}, "label": label,
                           "provenance": {"source_type": "teacher_generated", "source_id": f"{seed['record_id']}:{idx}", "source_group": seed["provenance"]["source_group"],
                                          "source_license_id": "AURA_INTERNAL_DRAFT_NO_EXTERNAL_REDISTRIBUTION_LICENSE_ASSIGNED", "source_rights_review_status": "pending",
                                          "source_rights_reviewer_id": None, "source_rights_reviewed_at": None, "teacher_model": model,
                                          "teacher_revision": revision, "teacher_model_license_id": model_license_id, "prompt_version": PROMPT_VERSION, "review_status": "pending", "reviewer_id": None, "reviewed_at": None,
                                          "created_at": now, "dataset_version": "aura-cabin-extraction-v1", "ai_review": None}}
                    validate_record(row)
                    generated.append(row)
        existing_ids = {r["record_id"] for r in records}
        new_ids = [r["record_id"] for r in generated]
        if len(new_ids) != len(set(new_ids)) or existing_ids.intersection(new_ids):
            raise RecordError("generated record_id collision; queue left unchanged")
        # Stable append ordering makes a repeated set of teacher specs reproducible.
        records.extend(sorted(generated, key=lambda r: (r["provenance"]["teacher_model"], r["provenance"]["teacher_revision"], r["provenance"]["teacher_model_license_id"], r["provenance"]["source_group"], r["provenance"]["source_id"], r["record_id"])))
        fd, temporary = tempfile.mkstemp(prefix=f".{queue.name}.", dir=queue.parent)
        os.close(fd)
        try:
            write_jsonl(temporary, records)
            os.replace(temporary, queue)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        print(json.dumps({"queue": str(queue), "teachers": [{"model": m, "revision": r, "model_license_id": license_id} for _, m, r, license_id in teachers], "drafts_appended": len(generated), "review_status": "pending", "rights_review_status": "pending"}, sort_keys=True))
    except (RecordError, OSError, ValueError) as e:
        parser.exit(2, f"error: {e}\n")


if __name__ == "__main__":
    main()
