#!/usr/bin/env python3
"""Preflight readiness check for AURA model evaluation."""
import argparse
import io
import json
import sys
from pathlib import Path
import contextlib

ROOT = Path(__file__).resolve().parent

REQUIRED_SUITES = {
    "intent_zh_tw",
    "parking_assistance",
    "journey_recommendation",
    "unsafe_action",
    "conversation_interruption",
}

def check_readiness(model_path: str, model_revision: str) -> list[str]:
    blockers = []

    # 1. Reuse existing registry validator for schema/hash/count checks
    import validate_registry

    f = io.StringIO()
    with contextlib.redirect_stdout(f), contextlib.redirect_stderr(f):
        ret = validate_registry.main()

    if ret != 0:
        blockers.append(f"Registry schema/hash/count validation failed: {f.getvalue().strip()}")

    # 2. Check for empty data, required suites, status, and pending review gates
    try:
        manifest_path = ROOT / "manifest.json"
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

            status = manifest.get("status")
            if status != "sealed_approved":
                blockers.append(f"Registry status is '{status}', expected 'sealed_approved'.")

            found_suites = set()
            for suite in manifest.get("suites", []):
                suite_id = suite.get("suite_id")
                if suite_id:
                    found_suites.add(suite_id)
                if suite.get("case_count", 0) <= 0:
                    blockers.append(f"Suite '{suite_id}' is empty or invalid (case_count <= 0).")

            missing_suites = REQUIRED_SUITES - found_suites
            if missing_suites:
                blockers.append(f"Missing required suites: {', '.join(sorted(missing_suites))}")

            review_gates = manifest.get("review_gates", {})
            if review_gates.get("content") != "approved":
                blockers.append(f"Content review gate is not approved (current: {review_gates.get('content')}).")
            if review_gates.get("rights") != "approved":
                blockers.append(f"Rights review gate is not approved (current: {review_gates.get('rights')}).")
        else:
            blockers.append("manifest.json not found.")
    except Exception as e:
        blockers.append(f"Failed to parse manifest for readiness checks: {e}")

    # 3. Model path checks
    model_path_stripped = (model_path or "").strip()
    if model_path_stripped:
        model_dir = Path(model_path_stripped)
        if not model_dir.is_dir():
            blockers.append(f"Model directory not found: {model_path_stripped}")
        else:
            if not (model_dir / "config.json").is_file():
                blockers.append(f"Missing config.json in model path: {model_path_stripped}")

            if not list(model_dir.glob("*.safetensors")) and not list(model_dir.glob("*.bin")):
                blockers.append(f"Missing model weights (*.safetensors or *.bin) in model path: {model_path_stripped}")
    else:
        blockers.append("Model path not provided or empty.")

    model_revision_stripped = (model_revision or "").strip()
    if not model_revision_stripped:
         blockers.append("Model revision is required but not provided or empty.")

    return blockers

def main(args_list=None):
    parser = argparse.ArgumentParser(description="Preflight check for AURA evaluation readiness.")
    parser.add_argument("--model-path", default="", help="Local directory path to the model artifacts.")
    parser.add_argument("--model-revision", default="", help="Explicit revision hash for the model.")
    args = parser.parse_args(args=args_list)

    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))

    blockers = check_readiness(args.model_path, args.model_revision)

    if blockers:
        print(json.dumps({"ready": False, "blockers": blockers}, indent=2))
        return 1

    print(json.dumps({"ready": True, "blockers": []}, indent=2))
    return 0

if __name__ == "__main__":
    sys.exit(main())
