"""Validate, review, and split the AURA teacher/student JSONL dataset."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path
from datetime import datetime, timezone

try:  # Supports both ``python path/to/dataset_cli.py`` and ``python -m ...``.
    from .records import RecordError, read_jsonl, validate_record, write_jsonl
except ImportError:  # pragma: no cover - direct script execution
    from records import RecordError, read_jsonl, validate_record, write_jsonl


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def cmd_validate(args: argparse.Namespace) -> None:
    records = read_jsonl(args.input)
    print(json.dumps({"valid": True, "records": len(records), "approved": sum(r["provenance"]["review_status"] == "human_approved" for r in records)}, sort_keys=True))


def cmd_review(args: argparse.Namespace) -> None:
    source = Path(args.queue).resolve()
    if not args.reviewer_id.strip() or len(args.reviewer_id) > 128:
        raise RecordError("reviewer-id must be non-empty and at most 128 characters")
    records = read_jsonl(source)

    def persist() -> None:
        fd, tmp_name = tempfile.mkstemp(prefix=f".{source.name}.", dir=source.parent)
        os.close(fd)
        try:
            write_jsonl(tmp_name, records)
            os.replace(tmp_name, source)
        finally:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)

    pending = [r for r in records if r["provenance"]["review_status"] == "pending"]
    if not pending:
        print("No pending records.")
        return
    print(f"Human review queue: {len(pending)} pending record(s). Reviewer: {args.reviewer_id}")
    for row in pending:
        print("\n" + json.dumps(row, ensure_ascii=False, indent=2))
        action = input("[a]pprove, [r]eject, [e]dit then decide, [q]uit: ").strip().lower()
        if action == "q":
            break
        if action == "e":
            utterance = input("Edited utterance (Enter keeps current): ")
            if utterance:
                row["input"]["utterance"] = utterance
            label_text = input("Edited label JSON (Enter keeps current): ")
            if label_text:
                try:
                    row["label"] = json.loads(label_text)
                except json.JSONDecodeError as e:
                    raise RecordError(f"invalid edited label JSON: {e}") from e
            validate_record(row)
            action = input("Decision after edit, [a]pprove, [r]eject, or [q]uit: ").strip().lower()
            if action == "q":
                break
        if action not in {"a", "r"}:
            raise RecordError(f"invalid review action {action!r}; queue remains unchanged for this row")

        # 10% Deterministic Double-Check (Maker-Checker)
        is_sampled = int(hashlib.md5(row["record_id"].encode()).hexdigest(), 16) % 10 == 0
        final_reviewer_id = args.reviewer_id

        if is_sampled:
            print("\n🎲 [抽樣複審] 這筆資料被系統隨機抽中！必須由第二位審查員進行覆核 (Maker-Checker)。")
            second_reviewer = input("請輸入第二位審查員的 ID (或輸入 [q] 暫停審查這筆資料): ").strip()
            if second_reviewer.lower() == 'q' or not second_reviewer:
                print("已跳過此筆資料，狀態保留為 pending。")
                continue
            if second_reviewer == args.reviewer_id:
                print("⚠️ 警告：第二位審查員不能與第一位相同！已跳過此筆資料。")
                continue

            second_action = input(f"[{second_reviewer}] 請覆核第一位審查員的決定 ({'approve' if action == 'a' else 'reject'}) - [y]es 同意, [n]o 拒絕: ").strip().lower()
            if second_action != 'y':
                print("兩位審查員意見不一致，已退回 pending 狀態。")
                continue

            final_reviewer_id = f"{args.reviewer_id}+{second_reviewer}"
            print("✅ 雙重複審通過！")

        validate_record(row)
        row["provenance"]["review_status"] = "human_approved" if action == "a" else "human_rejected"
        row["provenance"]["reviewer_id"] = final_reviewer_id
        row["provenance"]["reviewed_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        validate_record(row)
        persist()
        print(f"Saved {row['record_id']}: {row['provenance']['review_status']} (Reviewer: {final_reviewer_id})")


def cmd_review_rights(args: argparse.Namespace) -> None:
    """Collect a separate human decision about internal-training source rights."""
    source = Path(args.queue).resolve()
    if not args.reviewer_id.strip() or len(args.reviewer_id) > 128:
        raise RecordError("reviewer-id must be non-empty and at most 128 characters")
    records = read_jsonl(source)

    def persist() -> None:
        fd, tmp_name = tempfile.mkstemp(prefix=f".{source.name}.", dir=source.parent)
        os.close(fd)
        try:
            write_jsonl(tmp_name, records)
            os.replace(tmp_name, source)
        finally:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)

    pending = [r for r in records if r["provenance"]["source_rights_review_status"] == "pending"]
    if not pending:
        print("No source-rights-pending records.")
        return
    print(f"Rights review queue: {len(pending)} pending record(s). Reviewer: {args.reviewer_id}")
    print("Internal-training approval is not redistribution clearance.")
    for row in pending:
        provenance = row["provenance"]
        print("\n" + json.dumps({
            "record_id": row["record_id"], "source_type": provenance["source_type"],
            "utterance": row["input"]["utterance"], "label": row["label"],
            "source_id": provenance["source_id"], "source_group": provenance["source_group"],
            "source_license_id": provenance["source_license_id"],
            "source_rights_review_status": provenance["source_rights_review_status"],
            "review_status": provenance["review_status"],
            "teacher_model": provenance["teacher_model"],
            "teacher_revision": provenance["teacher_revision"],
            "teacher_model_license_id": provenance["teacher_model_license_id"],
        }, ensure_ascii=False, indent=2))
        decision = input("[a]pprove for internal training only, [r]eject rights, [q]uit: ").strip().lower()
        if decision == "q":
            break
        if decision not in {"a", "r"}:
            raise RecordError(f"invalid rights review decision {decision!r}; queue unchanged for this record")
        provenance["source_rights_review_status"] = "approved_internal_training" if decision == "a" else "rejected"
        provenance["source_rights_reviewer_id"] = args.reviewer_id
        provenance["source_rights_reviewed_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        validate_record(row)
        persist()
        print(f"Saved {row['record_id']}: {provenance['source_rights_review_status']}")


def cmd_split(args: argparse.Namespace) -> None:
    source = Path(args.input).resolve()
    outdir = Path(args.output_dir).resolve()
    if outdir.exists():
        raise RecordError("output directory must be new")
    ratios = {"train": args.train_ratio, "validation": args.validation_ratio, "test": args.test_ratio}
    if any(x <= 0 or x >= 1 for x in ratios.values()) or abs(sum(ratios.values()) - 1) > 1e-9:
        raise RecordError("split ratios must be positive and sum to 1")
    all_records = read_jsonl(source)
    content_approved = [r for r in all_records if r["provenance"]["review_status"] == "human_approved"]
    records = [r for r in content_approved if r["provenance"]["source_rights_review_status"] == "approved_internal_training"]
    exclusions = {
        "content_pending": sum(r["provenance"]["review_status"] == "pending" for r in all_records),
        "content_rejected": sum(r["provenance"]["review_status"] == "human_rejected" for r in all_records),
        "rights_pending": sum(r["provenance"]["source_rights_review_status"] == "pending" for r in all_records),
        "rights_rejected": sum(r["provenance"]["source_rights_review_status"] == "rejected" for r in all_records),
        "content_approved_rights_pending": sum(r["provenance"]["review_status"] == "human_approved" and r["provenance"]["source_rights_review_status"] == "pending" for r in all_records),
        "content_approved_rights_rejected": sum(r["provenance"]["review_status"] == "human_approved" and r["provenance"]["source_rights_review_status"] == "rejected" for r in all_records),
        "content_approved_rights_not_cleared": sum(r["provenance"]["review_status"] == "human_approved" and r["provenance"]["source_rights_review_status"] != "approved_internal_training" for r in all_records),
        "rights_approved_content_not_cleared": sum(r["provenance"]["source_rights_review_status"] == "approved_internal_training" and r["provenance"]["review_status"] != "human_approved" for r in all_records),
    }
    if not records:
        print(json.dumps({"eligible_records": 0, "excluded_by_gate": exclusions}, sort_keys=True))
        raise RecordError("no records passed both human content approval and internal-training source-rights approval")
    groups: dict[str, list[dict]] = {}
    for r in records:
        groups.setdefault(r["provenance"]["source_group"], []).append(r)
    if len(groups) < 3:
        print(json.dumps({"eligible_records": len(records), "eligible_source_groups": len(groups), "excluded_by_gate": exclusions}, sort_keys=True))
        raise RecordError("at least three source_group values must pass both content and rights gates to populate all splits without leakage")
    total = len(records)
    targets = {name: total * ratio for name, ratio in ratios.items()}
    assigned: dict[str, list[dict]] = {name: [] for name in ratios}
    group_map: dict[str, str] = {}
    ranked = sorted(groups.items(), key=lambda pair: hashlib.sha256(f"{args.seed}\0{pair[0]}".encode()).hexdigest())
    # Greedy whole-group assignment minimizes the current largest normalized deficit.
    for group, items in ranked:
        choice = max(ratios, key=lambda name: ((targets[name] - len(assigned[name])) / targets[name], -list(ratios).index(name)))
        assigned[choice].extend(items)
        group_map[group] = choice
    outdir.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{outdir.name}.", dir=outdir.parent))
    try:
        files = {}
        for name, subset in assigned.items():
            subset.sort(key=lambda r: r["record_id"])
            file_path = staging / f"{name}.jsonl"
            write_jsonl(file_path, subset)
            files[name] = {"path": file_path.name, "records": len(subset), "sha256": digest(file_path), "record_ids": [r["record_id"] for r in subset]}
        license_rows = [{"record_id": r["record_id"], "review_status": r["provenance"]["review_status"],
                         "reviewer_id": r["provenance"]["reviewer_id"], "reviewed_at": r["provenance"]["reviewed_at"],
                         "source_license_id": r["provenance"]["source_license_id"],
                         "source_rights_review_status": r["provenance"]["source_rights_review_status"],
                         "source_rights_reviewer_id": r["provenance"]["source_rights_reviewer_id"], "source_rights_reviewed_at": r["provenance"]["source_rights_reviewed_at"],
                         "teacher_model": r["provenance"]["teacher_model"], "teacher_revision": r["provenance"]["teacher_revision"],
                         "teacher_model_license_id": r["provenance"]["teacher_model_license_id"]} for r in sorted(records, key=lambda item: item["record_id"])]
        license_states = sorted({(row["source_license_id"], row["source_rights_review_status"]) for row in license_rows})
        model_licenses = sorted({(row["teacher_model"], row["teacher_revision"], row["teacher_model_license_id"])
                                 for row in license_rows if row["teacher_model"] is not None})
        manifest = {"format": "aura-grouped-split-v1", "source_sha256": digest(source), "seed": args.seed, "ratios": ratios, "eligible_records": total,
                    "content_approved_records": len(content_approved), "excluded_by_gate": exclusions,
                    "group_assignment": dict(sorted(group_map.items())), "files": files,
                    "dataset_license_lineage": {"records": license_rows,
                        "source_license_rights_states": [{"source_license_id": license_id, "source_rights_review_status": status} for license_id, status in license_states],
                        "teacher_model_license_declarations": [{"model": model, "revision": revision, "license_id": license_id} for model, revision, license_id in model_licenses],
                        "notice": "approved_internal_training is not redistribution clearance. Teacher model license declarations do not assign or imply a license for generated records or authorize redistribution."}}
        body = json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
        (staging / "manifest.json").write_text(body, encoding="utf-8")
        (staging / "manifest.sha256").write_text(hashlib.sha256(body.encode()).hexdigest() + "  manifest.json\n", encoding="ascii")
        staging.rename(outdir)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    print(json.dumps({"output_dir": str(outdir), "eligible_records": total, "excluded_by_gate": exclusions, "groups": len(groups), "splits": {k: len(v) for k, v in assigned.items()}}, sort_keys=True))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="command", required=True)
    p = subs.add_parser("validate", help="validate a JSONL file")
    p.add_argument("input"); p.set_defaults(func=cmd_validate)
    p = subs.add_parser("review", help="interactively review pending rows in the consolidated queue")
    p.add_argument("queue"); p.add_argument("--reviewer-id", required=True); p.set_defaults(func=cmd_review)
    p = subs.add_parser("review-rights", help="separately review pending source rights for internal training")
    p.add_argument("queue"); p.add_argument("--reviewer-id", required=True); p.set_defaults(func=cmd_review_rights)
    p = subs.add_parser("split", help="create deterministic source_group-isolated splits")
    p.add_argument("input"); p.add_argument("--output-dir", required=True); p.add_argument("--seed", type=int, default=20261002)
    p.add_argument("--train-ratio", type=float, default=.70); p.add_argument("--validation-ratio", type=float, default=.15); p.add_argument("--test-ratio", type=float, default=.15)
    p.set_defaults(func=cmd_split)
    args = parser.parse_args()
    try:
        args.func(args)
    except (RecordError, OSError) as e:
        parser.exit(2, f"error: {e}\n")


if __name__ == "__main__":
    main()
