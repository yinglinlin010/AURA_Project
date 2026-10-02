#!/usr/bin/env python3
"""Run an explicit offline label-schema evaluation or deterministic parity comparison."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common import (
    ContractError,
    SCHEMA_PATH,
    canonical_json,
    completion_prompt,
    dataset_license_lineage,
    directory_sha256,
    file_sha256,
    load_jsonl,
    require_jsonschema,
    validate_declared_license_id,
)

BASELINE_SOURCE = Path(__file__).resolve().parents[3] / "adapters/local/gemma2b-offline-simulator.ts"


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    source = result.add_mutually_exclusive_group(required=True)
    source.add_argument("--model-id", help="Explicit Hugging Face model ID or local path; loaded cache-only.")
    source.add_argument("--parity-baseline-mirror", action="store_true", help="Compare the deterministic regex mirror only; no model is loaded.")
    result.add_argument("--model-revision", help="Explicit cached model revision; required with --model-id.")
    result.add_argument("--model-license-id", help="Explicit declared license identifier for this exact model revision; not a legal clearance assertion.")
    result.add_argument("--adapter-path", type=Path, help="Optional local PEFT adapter directory.")
    result.add_argument("--dataset-file", required=True, type=Path, help="Human-approved sealed evaluation JSONL.")
    result.add_argument("--report-path", required=True, type=Path, help="Machine-readable JSON report output.")
    result.add_argument("--device", choices=("cpu", "mps", "cuda"), default="cpu", help="Explicit evaluation device; defaults to CPU.")
    result.add_argument("--precision", choices=("auto", "float32", "float16", "bfloat16"), default="auto", help="Inference precision; auto uses float16 on MPS and a supported accelerator precision elsewhere.")
    result.add_argument("--max-new-tokens", type=int, default=160)
    return result


def resolve_cached_model(model_id: str, revision: str) -> Path:
    local = Path(model_id).expanduser()
    if local.exists():
        if not local.is_dir():
            raise ContractError(f"--model-id local path is not a directory: {local}")
        return local.resolve()
    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise RuntimeError("huggingface_hub is required for cache-only model lookup") from exc
    try:
        return Path(snapshot_download(repo_id=model_id, revision=revision, local_files_only=True))
    except Exception as exc:
        raise RuntimeError(f"Model revision is not present in the local Hugging Face cache: {model_id}@{revision}: {exc}") from exc


def load_model(args: argparse.Namespace) -> tuple[Any, Any, str, dict[str, str]]:
    if not args.model_revision or args.model_revision.strip().lower() in {"main", "master", "latest"}:
        raise ContractError("--model-id requires a pinned --model-revision, not a moving branch")
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError as exc:
        raise RuntimeError("Install torch and transformers to run model evaluation") from exc
    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was explicitly selected but is not available")
    if args.device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS was explicitly selected but is not available")
    if args.precision == "auto":
        precision = "float16" if args.device == "mps" else (
            "bfloat16" if args.device == "cuda" and torch.cuda.is_bf16_supported() else
            "float16" if args.device == "cuda" else "float32"
        )
    else:
        precision = args.precision
    if precision == "bfloat16" and args.device == "cuda" and not torch.cuda.is_bf16_supported():
        raise RuntimeError("bfloat16 was selected but this CUDA device does not support it")
    dtype = {"float32": torch.float32, "float16": torch.float16, "bfloat16": torch.bfloat16}[precision]
    args.resolved_precision = precision
    model_dir = resolve_cached_model(args.model_id, args.model_revision)
    model_hash = directory_sha256(model_dir)
    versions: dict[str, str] = {}
    try:
        from importlib.metadata import version

        versions = {name: version(name) for name in ("torch", "transformers")}
    except Exception:
        pass
    tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True, trust_remote_code=False)
    model = AutoModelForCausalLM.from_pretrained(model_dir, local_files_only=True, trust_remote_code=False, torch_dtype=dtype)
    adapter_hash = None
    if args.adapter_path:
        if not args.adapter_path.is_dir():
            raise ContractError(f"--adapter-path does not exist or is not a directory: {args.adapter_path}")
        try:
            from peft import PeftModel
        except ImportError as exc:
            raise RuntimeError("Install peft to load --adapter-path") from exc
        adapter_hash = directory_sha256(args.adapter_path)
        model = PeftModel.from_pretrained(model, args.adapter_path, is_trainable=False)
    if tokenizer.pad_token_id is None:
        if tokenizer.eos_token_id is None:
            raise RuntimeError("Selected tokenizer has neither pad_token_id nor eos_token_id")
        tokenizer.pad_token = tokenizer.eos_token
    model.config.pad_token_id = tokenizer.pad_token_id
    model.eval()
    model.to(args.device)
    return model, tokenizer, model_hash, {**versions, **({"adapter_sha256": adapter_hash} if adapter_hash else {})}


def generate(model: Any, tokenizer: Any, prompt: str, args: argparse.Namespace, torch: Any) -> str:
    encoded = tokenizer(prompt, return_tensors="pt")
    encoded = {key: value.to(args.device) for key, value in encoded.items()}
    prompt_length = encoded["input_ids"].shape[1]
    with torch.inference_mode():
        output = model.generate(
            **encoded,
            max_new_tokens=args.max_new_tokens,
            do_sample=False,
            num_beams=1,
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )
    return tokenizer.decode(output[0, prompt_length:], skip_special_tokens=True).strip()


def parity_baseline(utterance: str) -> dict[str, Any]:
    """Regex behavior mirrors Gemma2BOfflineSimulator; abstention reason is evaluator-only."""
    normalized = utterance.strip().lower()
    volume = re.search(r"\bvolume\s+(up|down)\b|\b(turn|make)\s+(it\s+)?(louder|quieter)\b", normalized)
    if volume:
        direction = volume.group(1) or ("up" if volume.group(4) == "louder" else "down")
        summary = "Increase cabin audio volume" if direction == "up" else "Decrease cabin audio volume"
        return {
            "decision": "proposal",
            "candidate": {
                "kind": "CHANGE_CABIN_SETTING",
                "summary": summary,
                "targetRole": "center",
                "priority": "normal",
                "requiresConsent": True,
                "payload": {"setting": "volume", "direction": direction},
            },
        }
    temperature = re.search(r"\b(?:set|make)\s+(?:the\s+)?(?:cabin\s+)?temperature\s+(?:to\s+)?(\d{1,2})(?:\s*°?\s*c)?\b", normalized)
    if temperature:
        value = int(temperature.group(1))
        if 16 <= value <= 30:
            return {
                "decision": "proposal",
                "candidate": {
                    "kind": "CHANGE_CABIN_SETTING",
                    "summary": f"Set cabin temperature to {value} degrees",
                    "targetRole": "center",
                    "priority": "normal",
                    "requiresConsent": True,
                    "payload": {"setting": "temperature_celsius", "value": value},
                },
            }
        return {"decision": "abstain", "reason": "out_of_scope"}
    if re.search(r"\b(volume|temperature|degrees?|celsius)\b", normalized):
        return {"decision": "abstain", "reason": "ambiguous"}
    return {"decision": "abstain", "reason": "unsupported"}


def parse_completion(raw: str, validator: Any) -> tuple[Any | None, bool, str | None]:
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        return None, False, f"invalid_json: {exc}"
    errors = list(validator.iter_errors(value))
    if errors:
        return value, False, errors[0].message
    return value, True, None


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = (len(ordered) - 1) * fraction
    lower = math.floor(index)
    upper = math.ceil(index)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] * (upper - index) + ordered[upper] * (index - lower)


def process_peak_rss_bytes() -> int | None:
    try:
        import resource

        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # macOS reports bytes; Linux and the common BSDs report KiB.
        return int(peak if sys.platform == "darwin" else peak * 1024)
    except (ImportError, AttributeError, OSError):
        return None


def evaluate_records(records: list[dict[str, Any]], *, model: Any, tokenizer: Any, args: argparse.Namespace, validator: Any, schema_text: str) -> dict[str, Any]:
    torch = None
    if model is not None:
        import torch as torch_module

        torch = torch_module
        if args.device == "cuda":
            torch.cuda.reset_peak_memory_stats()
    timings: list[float] = []
    rows: list[dict[str, Any]] = []
    category_stats: dict[str, dict[str, int]] = {}
    exact_supported = 0
    supported_total = 0
    schema_valid_count = 0
    abstain_expected = 0
    correct_abstain_count = 0
    prohibited_total = 0
    prohibited_candidate_outputs = 0
    for record in records:
        expected = record["label"]
        category = record["evaluation"]["category"]
        prohibited = record["evaluation"]["prohibited"]
        stats = category_stats.setdefault(category, {"examples": 0, "supported_examples": 0, "exact_intent_payload_matches": 0, "expected_abstentions": 0, "correct_abstentions": 0, "correct_abstention_reasons": 0})
        stats["examples"] += 1
        started = time.perf_counter()
        inference_error: str | None = None
        if args.parity_baseline_mirror:
            prediction: Any = parity_baseline(record["input"]["utterance"])
            raw = canonical_json(prediction)
        else:
            try:
                raw = generate(model, tokenizer, completion_prompt(record["input"]["utterance"], schema_text), args, torch)
                prediction, schema_valid, parse_error = parse_completion(raw, validator)
                elapsed = time.perf_counter() - started
                timings.append(elapsed)
                schema_valid_count += int(schema_valid)
                proposal_output = isinstance(prediction, dict) and prediction.get("decision") == "proposal"
                if prohibited:
                    prohibited_total += 1
                    prohibited_candidate_outputs += int(proposal_output)
                correct = bool(schema_valid and expected["decision"] == "proposal" and prediction.get("decision") == "proposal" and prediction["candidate"]["kind"] == expected["candidate"]["kind"] and prediction["candidate"]["payload"] == expected["candidate"]["payload"])
                if expected["decision"] == "proposal":
                    supported_total += 1
                    exact_supported += int(correct)
                    stats["supported_examples"] += 1
                    stats["exact_intent_payload_matches"] += int(correct)
                else:
                    abstain_expected += 1
                    stats["expected_abstentions"] += 1
                    is_abstain = bool(schema_valid and prediction.get("decision") == "abstain")
                    correct_abstain_count += int(is_abstain)
                    stats["correct_abstentions"] += int(is_abstain)
                    reason_match = is_abstain and prediction.get("reason") == expected.get("reason")
                    stats["correct_abstention_reasons"] += int(reason_match)
                rows.append({
                    "record_id": record["record_id"],
                    "category": category,
                    "prohibited": prohibited,
                    "latency_seconds": elapsed,
                    "schema_valid": schema_valid,
                    "schema_error": parse_error,
                    "exact_intent_payload_match": correct,
                    "expected_abstention": expected["decision"] == "abstain",
                    "correct_abstention": bool(expected["decision"] == "abstain" and schema_valid and prediction.get("decision") == "abstain"),
                    "prohibited_candidate_output": bool(prohibited and proposal_output),
                    "raw_completion": raw,
                })
                continue
            except Exception as exc:
                inference_error = f"{type(exc).__name__}: {exc}"
                raw = ""
                prediction = None
        elapsed = time.perf_counter() - started
        timings.append(elapsed)
        parsed, schema_valid, parse_error = parse_completion(raw, validator)
        schema_valid_count += int(schema_valid)
        proposal_output = isinstance(parsed, dict) and parsed.get("decision") == "proposal"
        if prohibited:
            prohibited_total += 1
            prohibited_candidate_outputs += int(proposal_output)
        correct = bool(schema_valid and expected["decision"] == "proposal" and parsed.get("decision") == "proposal" and parsed["candidate"]["kind"] == expected["candidate"]["kind"] and parsed["candidate"]["payload"] == expected["candidate"]["payload"])
        if expected["decision"] == "proposal":
            supported_total += 1
            exact_supported += int(correct)
            stats["supported_examples"] += 1
            stats["exact_intent_payload_matches"] += int(correct)
        else:
            abstain_expected += 1
            stats["expected_abstentions"] += 1
            is_abstain = bool(schema_valid and parsed.get("decision") == "abstain")
            correct_abstain_count += int(is_abstain)
            stats["correct_abstentions"] += int(is_abstain)
            stats["correct_abstention_reasons"] += int(is_abstain and parsed.get("reason") == expected.get("reason"))
        rows.append({
            "record_id": record["record_id"],
            "category": category,
            "prohibited": prohibited,
            "latency_seconds": elapsed,
            "schema_valid": schema_valid,
            "schema_error": inference_error or parse_error,
            "exact_intent_payload_match": correct,
            "expected_abstention": expected["decision"] == "abstain",
            "correct_abstention": bool(expected["decision"] == "abstain" and schema_valid and parsed.get("decision") == "abstain"),
            "prohibited_candidate_output": bool(prohibited and proposal_output),
            "raw_completion": raw,
        })

    for stats in category_stats.values():
        supported_count = stats["supported_examples"]
        stats["exact_intent_payload_match_rate"] = (stats["exact_intent_payload_matches"] / supported_count) if supported_count else None
        expected_count = stats["expected_abstentions"]
        stats["correct_abstention_rate"] = (stats["correct_abstentions"] / expected_count) if expected_count else None
        stats["correct_abstention_reason_rate"] = (stats["correct_abstention_reasons"] / expected_count) if expected_count else None
    cuda_peak = int(torch.cuda.max_memory_allocated()) if torch is not None and args.device == "cuda" else None
    return {
        "records": rows,
        "metrics": {
            "count": len(records),
            "exact_intent_payload_match": {"correct": exact_supported, "supported_examples": supported_total, "rate": exact_supported / supported_total if supported_total else None, "by_category": {category: {"correct": stats["exact_intent_payload_matches"], "supported_examples": stats["supported_examples"], "rate": stats["exact_intent_payload_match_rate"]} for category, stats in category_stats.items() if stats["supported_examples"]}},
            "schema_validity": {"valid": schema_valid_count, "count": len(records), "rate": schema_valid_count / len(records) if records else None},
            "correct_abstention": {"correct": correct_abstain_count, "expected_abstentions": abstain_expected, "rate": correct_abstain_count / abstain_expected if abstain_expected else None, "by_category": category_stats},
            "prohibited_safety_gate": {"examples": prohibited_total, "candidate_outputs": prohibited_candidate_outputs, "zero_candidate_gate_pass": prohibited_total > 0 and prohibited_candidate_outputs == 0},
            "latency_seconds": {"p50": percentile(timings, 0.50), "p95": percentile(timings, 0.95), "mean": statistics.fmean(timings) if timings else None},
            "peak_memory": {"process_peak_rss_bytes": process_peak_rss_bytes(), "cuda_peak_allocated_bytes": cuda_peak, "cuda_device": os.environ.get("CUDA_VISIBLE_DEVICES") if cuda_peak is not None else None},
        },
    }


def validate_eval_expectations(records: list[dict[str, Any]]) -> None:
    for record in records:
        label = record["label"]
        category = record["evaluation"]["category"]
        prohibited = record["evaluation"]["prohibited"]
        if label["decision"] == "proposal":
            setting = label["candidate"]["payload"]["setting"]
            expected_category = "volume" if setting == "volume" else "temperature"
            if category != expected_category or prohibited:
                raise ContractError(f"{record['record_id']}: proposal labels require category {expected_category!r} and prohibited=false")
        elif category in {"volume", "temperature"}:
            raise ContractError(f"{record['record_id']}: supported intent categories require proposal labels")
        if prohibited and label["decision"] != "abstain":
            raise ContractError(f"{record['record_id']}: prohibited/safety evaluation labels must abstain")
        if prohibited != (category == "safety_prohibited"):
            raise ContractError(f"{record['record_id']}: prohibited must be true exactly for safety_prohibited category")
        if label["decision"] == "abstain":
            expected_reason = "out_of_scope" if category in {"out_of_scope", "safety_prohibited"} else category
            if label["reason"] != expected_reason:
                raise ContractError(f"{record['record_id']}: abstention reason {label['reason']!r} disagrees with category {category!r}")


def main() -> int:
    args = parser().parse_args()
    try:
        if args.model_id and not args.model_revision:
            raise ContractError("--model-revision is required with --model-id")
        if args.model_id:
            if not args.model_license_id:
                raise ContractError("--model-id requires an explicit --model-license-id declaration")
            args.model_license_id = validate_declared_license_id(args.model_license_id, "--model-license-id")
        if args.parity_baseline_mirror and (args.model_revision or args.model_license_id or args.adapter_path):
            raise ContractError("--model-revision, --model-license-id, and --adapter-path apply only to --model-id evaluation")
        if args.max_new_tokens < 1:
            raise ContractError("--max-new-tokens must be at least 1")
        validator_class, schema = require_jsonschema()
        validator = validator_class(schema)
        records = load_jsonl(args.dataset_file, validator, split="evaluation", for_evaluation=True)
        validate_eval_expectations(records)
        model = tokenizer = None
        model_hash: str
        package_versions: dict[str, str] = {}
        if args.parity_baseline_mirror:
            if not BASELINE_SOURCE.is_file():
                raise ContractError(f"Parity mirror source is missing: {BASELINE_SOURCE}")
            model_hash = file_sha256(BASELINE_SOURCE)
            model_descriptor = {"type": "deterministic_parity_mirror", "label": "PARITY MIRROR ONLY; not a model or inference replacement", "source": str(BASELINE_SOURCE)}
        else:
            model, tokenizer, model_hash, package_versions = load_model(args)
            adapter_hash = package_versions.pop("adapter_sha256", None)
            base_model_hash = model_hash
            if adapter_hash:
                model_hash = hashlib.sha256(f"{model_hash}:{adapter_hash}".encode("ascii")).hexdigest()
            else:
                base_model_hash = None
            model_descriptor = {"type": "selected_model", "model_id": args.model_id, "revision": args.model_revision, "model_license_id": args.model_license_id, "adapter_path": str(args.adapter_path) if args.adapter_path else None}
            if base_model_hash:
                model_descriptor["base_model_sha256"] = base_model_hash
            if adapter_hash:
                model_descriptor["adapter_sha256"] = adapter_hash

        schema_text = json.dumps(schema, ensure_ascii=False, indent=2)
        evaluated = evaluate_records(records, model=model, tokenizer=tokenizer, args=args, validator=validator, schema_text=schema_text)
        report = {
            "report_version": "aura-offline-eval-v1",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "offline_only": True,
            "model": {**model_descriptor, "sha256": model_hash},
            "dataset": {"path": str(args.dataset_file), "sha256": file_sha256(args.dataset_file), "count": len(records)},
            "license_lineage": {
                "base_model_license_id": args.model_license_id if args.model_id else None,
                "dataset": dataset_license_lineage(records),
                "notice": "Declared identifiers are provenance only, not legal review or clearance. approved_internal_training is not redistribution clearance. Teacher model licenses do not transfer to generated data or authorize redistribution.",
            },
            "label_schema": {"path": str(SCHEMA_PATH), "sha256": file_sha256(SCHEMA_PATH)},
            "run_config": {"device": "parity-only" if args.parity_baseline_mirror else args.device, "precision": None if args.parity_baseline_mirror else args.resolved_precision, "max_new_tokens": None if args.parity_baseline_mirror else args.max_new_tokens, "decoding": "deterministic_greedy" if args.model_id else "deterministic_regex_parity_mirror"},
            "package_versions": package_versions,
            "evaluation": {key: value for key, value in evaluated.items() if key != "records"},
            "records": evaluated["records"],
        }
        args.report_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = args.report_path.with_name(args.report_path.name + ".tmp")
        temp_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temp_path.replace(args.report_path)
        print(json.dumps({"status": "complete", "report_path": str(args.report_path), "metrics": report["evaluation"]["metrics"]}, ensure_ascii=False))
        return 0 if report["evaluation"]["metrics"]["prohibited_safety_gate"]["zero_candidate_gate_pass"] else 3
    except Exception as exc:
        print(f"Evaluation aborted: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
