#!/usr/bin/env python3
"""Train an explicitly selected AURA cabin-extraction SFT LoRA adapter."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import platform
import sys
from pathlib import Path
from typing import Any

from common import (
    ContractError,
    SCHEMA_PATH,
    canonical_json,
    dataset_license_lineage,
    directory_sha256,
    file_sha256,
    load_jsonl,
    require_jsonschema,
    split_group_ids,
    validate_declared_license_id,
)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--base-model-id", required=True, help="Explicit Hugging Face model ID or local model path.")
    result.add_argument("--base-model-revision", required=True, help="Explicit immutable model revision/commit.")
    result.add_argument("--base-model-license-id", required=True, help="Explicit license identifier/declaration for this exact base model revision; this is provenance, not a legal clearance assertion.")
    result.add_argument("--train-file", required=True, type=Path, help="Human-approved train JSONL split.")
    result.add_argument("--validation-file", required=True, type=Path, help="Human-approved validation JSONL split.")
    result.add_argument("--split-manifest", required=True, type=Path, help="manifest.json emitted beside these grouped dataset splits.")
    result.add_argument("--output-dir", required=True, type=Path, help="New directory for adapter and run manifest.")
    result.add_argument("--qlora", action="store_true", help="Explicitly opt into 4-bit QLoRA; checks CUDA and bitsandbytes, never selected automatically.")
    result.add_argument("--learning-rate", type=float, default=2e-4)
    result.add_argument("--num-train-epochs", type=float, default=3.0)
    result.add_argument("--train-batch-size", type=int, default=1)
    result.add_argument("--eval-batch-size", type=int, default=1)
    result.add_argument("--gradient-accumulation-steps", type=int, default=8)
    result.add_argument("--max-length", type=int, default=1024)
    result.add_argument("--seed", type=int, default=42)
    result.add_argument("--precision", choices=("auto", "float32", "float16", "bfloat16"), default="auto", help="Training precision; auto uses a supported accelerator precision when available.")
    return result


def check_positive(args: argparse.Namespace) -> None:
    if args.base_model_revision.strip().lower() in {"main", "master", "latest"}:
        raise ContractError("Use a pinned model revision, not a moving branch such as main/latest.")
    args.base_model_license_id = validate_declared_license_id(args.base_model_license_id, "--base-model-license-id")
    for name in ("learning_rate", "num_train_epochs"):
        if getattr(args, name) <= 0:
            raise ContractError(f"--{name.replace('_', '-')} must be greater than zero")
    for name in ("train_batch_size", "eval_batch_size", "gradient_accumulation_steps", "max_length"):
        if getattr(args, name) < 1:
            raise ContractError(f"--{name.replace('_', '-')} must be at least 1")
    if args.output_dir.exists() and any(args.output_dir.iterdir()):
        raise ContractError(f"Refusing to overwrite non-empty output directory: {args.output_dir}")


def validate_split_manifest(args: argparse.Namespace) -> None:
    try:
        manifest = json.loads(args.split_manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError(f"Cannot read grouped split manifest: {exc}") from exc
    if not isinstance(manifest, dict) or manifest.get("format") != "aura-grouped-split-v1":
        raise ContractError("--split-manifest must be an aura-grouped-split-v1 manifest")
    files = manifest.get("files")
    if not isinstance(files, dict):
        raise ContractError("Grouped split manifest has no files map")
    for name, supplied in (("train", args.train_file), ("validation", args.validation_file)):
        entry = files.get(name)
        if not isinstance(entry, dict) or entry.get("sha256") != file_sha256(supplied):
            raise ContractError(f"{name} file hash does not match --split-manifest")
        if not isinstance(entry.get("records"), int) or entry["records"] < 1:
            raise ContractError(f"Grouped split manifest declares an empty {name} split")


def require_training_dependencies(qlora: bool) -> dict[str, str]:
    needed = ["torch", "transformers", "trl", "peft", "datasets", "jsonschema"]
    if qlora:
        needed.append("bitsandbytes")
    versions: dict[str, str] = {}
    missing: list[str] = []
    for package in needed:
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            missing.append(package)
    if missing:
        raise RuntimeError("Missing required packages: " + ", ".join(missing))
    import torch

    if qlora and not torch.cuda.is_available():
        raise RuntimeError("--qlora requires an available CUDA device; QLoRA is never auto-enabled.")
    return versions


def resolve_precision(requested: str, torch: Any) -> tuple[Any, str]:
    if requested == "auto":
        if torch.cuda.is_available():
            selected = "bfloat16" if torch.cuda.is_bf16_supported() else "float16"
        elif torch.backends.mps.is_available():
            selected = "float16"
        else:
            selected = "float32"
    else:
        selected = requested
    dtype = {
        "float32": torch.float32,
        "float16": torch.float16,
        "bfloat16": torch.bfloat16,
    }[selected]
    if selected == "bfloat16" and torch.cuda.is_available() and not torch.cuda.is_bf16_supported():
        raise RuntimeError("bfloat16 was selected but this CUDA device does not support it")
    return dtype, selected


def prompt_for(record: dict[str, Any], schema_text: str) -> str:
    utterance = record["input"]["utterance"].strip()
    context = record["input"]["context"]
    return (
        "Extract only a supported cabin volume or cabin temperature command. "
        "Return exactly one JSON object matching the supplied schema. Never make safety or policy decisions; "
        "abstain for ambiguous, unsupported, out-of-range, or safety-related requests.\n"
        f"Allowed task: {context['allowed_task']}\n"
        f"Allowed settings: {canonical_json(context['allowed_settings'])}\n"
        f"Output schema:\n{schema_text}\n"
        f"Utterance:\n{utterance}\n"
        "JSON completion:\n"
    )


def to_sft_rows(records: list[dict[str, Any]], schema_text: str, eos_token: str | None) -> list[dict[str, str]]:
    return [
        {"prompt": prompt_for(record, schema_text), "completion": canonical_json(record["label"]) + (eos_token or "")}
        for record in records
    ]


def main() -> int:
    args = parser().parse_args()
    try:
        check_positive(args)
        if args.base_model_id.lower().endswith(".gguf"):
            raise ContractError("SFT requires a Transformers-compatible base checkpoint; an Ollama GGUF is not accepted")
        validate_split_manifest(args)
        validator_class, schema = require_jsonschema()
        validator = validator_class(schema)
        train = load_jsonl(args.train_file, validator, split="train")
        validation = load_jsonl(args.validation_file, validator, split="validation")
        train_ids = {row["record_id"] for row in train}
        validation_ids = {row["record_id"] for row in validation}
        if train_ids & validation_ids:
            raise ContractError("Train and validation contain duplicate record_id values")
        if split_group_ids(train) & split_group_ids(validation):
            raise ContractError("Train and validation split_group_id values overlap; refusing leakage")
        train_versions = {row["provenance"]["dataset_version"] for row in train}
        validation_versions = {row["provenance"]["dataset_version"] for row in validation}
        if len(train_versions) != 1 or train_versions != validation_versions:
            raise ContractError("Train and validation must use one matching dataset_version")
        versions = require_training_dependencies(args.qlora)

        import torch
        dtype, precision = resolve_precision(args.precision, torch)
        from huggingface_hub import snapshot_download
        from datasets import Dataset
        from peft import LoraConfig
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from trl import SFTConfig, SFTTrainer

        local_model_path = Path(args.base_model_id).expanduser()
        model_path = local_model_path.resolve() if local_model_path.exists() else Path(
            snapshot_download(repo_id=args.base_model_id, revision=args.base_model_revision)
        )
        base_model_sha256 = directory_sha256(model_path)
        tokenizer = AutoTokenizer.from_pretrained(
            model_path,
            local_files_only=True,
            trust_remote_code=False,
        )
        model_load_options: dict[str, Any] = {
            "local_files_only": True,
            "trust_remote_code": False,
            "torch_dtype": dtype,
        }
        if args.qlora:
            from transformers import BitsAndBytesConfig

            model_load_options["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype=dtype,
            )
            model_load_options["device_map"] = {"": 0}
        model = AutoModelForCausalLM.from_pretrained(model_path, **model_load_options)
        if tokenizer.pad_token is None:
            if tokenizer.eos_token is None:
                raise RuntimeError("Selected tokenizer has neither pad_token nor eos_token")
            tokenizer.pad_token = tokenizer.eos_token
        model.config.pad_token_id = tokenizer.pad_token_id
        model.config.use_cache = False

        peft_config = LoraConfig(
            r=16,
            lora_alpha=32,
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
            target_modules="all-linear",
        )
        training_args = SFTConfig(
            output_dir=str(args.output_dir),
            learning_rate=args.learning_rate,
            num_train_epochs=args.num_train_epochs,
            per_device_train_batch_size=args.train_batch_size,
            per_device_eval_batch_size=args.eval_batch_size,
            gradient_accumulation_steps=args.gradient_accumulation_steps,
            eval_strategy="epoch",
            save_strategy="epoch",
            logging_steps=10,
            report_to="none",
            seed=args.seed,
            max_length=args.max_length,
            completion_only_loss=True,
            gradient_checkpointing=True,
            gradient_checkpointing_kwargs={"use_reentrant": False},
            fp16=precision == "float16",
            bf16=precision == "bfloat16",
        )
        schema_text = json.dumps(schema, ensure_ascii=False, indent=2)
        train_dataset = Dataset.from_list(to_sft_rows(train, schema_text, tokenizer.eos_token))
        validation_dataset = Dataset.from_list(to_sft_rows(validation, schema_text, tokenizer.eos_token))
        trainer = SFTTrainer(
            model=model,
            args=training_args,
            train_dataset=train_dataset,
            eval_dataset=validation_dataset,
            processing_class=tokenizer,
            peft_config=peft_config,
        )
        trainer.train()
        args.output_dir.mkdir(parents=True, exist_ok=True)
        trainer.save_model(str(args.output_dir))
        tokenizer.save_pretrained(args.output_dir)
        chat_template = getattr(tokenizer, "chat_template", None)
        manifest = {
            "base_model_id": args.base_model_id,
            "base_model_revision": args.base_model_revision,
            "base_model_sha256": base_model_sha256,
            "tokenizer_chat_template_sha256": hashlib.sha256((chat_template or "").encode("utf-8")).hexdigest(),
            "base_model_license_id": args.base_model_license_id,
            "dataset_license_lineage": dataset_license_lineage(train + validation),
            "training_data": {
                "train_file_sha256": file_sha256(args.train_file),
                "validation_file_sha256": file_sha256(args.validation_file),
                "split_manifest_sha256": file_sha256(args.split_manifest),
                "train_records": len(train),
                "validation_records": len(validation),
                "teacher_provenance": sorted({
                    (row["provenance"].get("teacher_model"), row["provenance"].get("teacher_revision"), row["provenance"].get("prompt_version"))
                    for row in train + validation
                    if row["provenance"].get("teacher_model") is not None
                }),
            },
            "label_schema_sha256": file_sha256(SCHEMA_PATH),
            "training": {
                "method": "SFTTrainer + PEFT LoRA" if not args.qlora else "SFTTrainer + PEFT LoRA + explicit QLoRA",
                "learning_rate": args.learning_rate,
                "num_train_epochs": args.num_train_epochs,
                "train_batch_size": args.train_batch_size,
                "eval_batch_size": args.eval_batch_size,
                "gradient_accumulation_steps": args.gradient_accumulation_steps,
                "max_length": args.max_length,
                "seed": args.seed,
                "precision": precision,
            },
            "hardware": {
                "platform": platform.platform(),
                "machine": platform.machine(),
                "cuda_available": torch.cuda.is_available(),
                "cuda_device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
                "mps_available": torch.backends.mps.is_available(),
            },
            "package_versions": versions,
            "adapter_and_tokenizer_sha256": directory_sha256(args.output_dir),
        }
        (args.output_dir / "aura-sft-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"status": "complete", "output_dir": str(args.output_dir), "manifest": "aura-sft-manifest.json"}))
        return 0
    except (ContractError, RuntimeError, ImportError, OSError, ValueError) as exc:
        print(f"SFT aborted: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
