#!/usr/bin/env python3
"""Validate the versioned AURA evaluation registry without running a model."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main() -> int:
    try:
        import jsonschema

        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        schema = json.loads((ROOT / "manifest.schema.json").read_text(encoding="utf-8"))
        jsonschema.Draft202012Validator.check_schema(schema)
        jsonschema.validate(manifest, schema)
        tool_version, tool_hash = manifest["tool_schema_version"].split("@sha256:", 1)
        if tool_version != "protocol-v1":
            raise ValueError(f"unsupported tool schema version: {tool_version}")
        protocol_schema = (ROOT.parent / "contracts/protocol/schemas/protocol.schema.json").resolve()
        if not protocol_schema.is_file() or hashlib.sha256(protocol_schema.read_bytes()).hexdigest() != tool_hash:
            raise ValueError("tool schema version/hash does not match contracts/protocol/schemas/protocol.schema.json")
        seen_ids: set[str] = set()
        seen_paths: set[str] = set()
        total = 0
        for suite in manifest["suites"]:
            if suite["suite_id"] in seen_ids or suite["path"] in seen_paths:
                raise ValueError(f"duplicate suite id or path: {suite['suite_id']}")
            seen_ids.add(suite["suite_id"])
            seen_paths.add(suite["path"])
            path = (ROOT / suite["path"]).resolve()
            if ROOT not in path.parents or not path.is_file():
                raise ValueError(f"suite file missing or escapes evaluation/: {suite['path']}")
            raw = path.read_bytes()
            actual_hash = hashlib.sha256(raw).hexdigest()
            actual_count = sum(bool(line.strip()) for line in raw.splitlines())
            if actual_hash != suite["sha256"]:
                raise ValueError(f"SHA-256 mismatch for {suite['path']}: expected {suite['sha256']}, got {actual_hash}")
            if actual_count != suite["case_count"]:
                raise ValueError(f"case count mismatch for {suite['path']}: expected {suite['case_count']}, got {actual_count}")
            total += actual_count
        print(json.dumps({"valid": True, "dataset_version": manifest["dataset_version"], "suites": len(seen_ids), "cases": total, "status": manifest["status"], "benchmark_claim_allowed": False}, sort_keys=True))
        return 0
    except Exception as exc:
        print(f"Registry validation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
