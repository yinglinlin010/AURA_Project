#!/usr/bin/env python3
"""Replay every maintained YAML scenario in fresh processes and record local evidence.

This measures deterministic simulator reproducibility only. It does not measure
product reliability, vehicle behavior, provider/model capability, or latency.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SCENARIO_ROOT = ROOT / "scenarios"
CLI = ROOT / "dist/adapters/simulator/src/cli.js"
UUID_PATTERN = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.IGNORECASE)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def repository_state() -> dict[str, Any]:
    revision = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=False
    )
    status = subprocess.run(
        ["git", "status", "--porcelain"], cwd=ROOT, text=True, capture_output=True, check=False
    )
    return {
        "revision": revision.stdout.strip() if revision.returncode == 0 else None,
        "working_tree_clean": status.returncode == 0 and not status.stdout.strip(),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repetitions", type=int, default=3, help="Fresh-process replays per scenario (1-50).")
    parser.add_argument("--scenario", action="append", default=[], help="Optional scenario path, relative to repository root; repeat to select several.")
    parser.add_argument("--report", type=Path, help="Optional JSON report path; omitted writes the report to stdout.")
    args = parser.parse_args()
    if not 1 <= args.repetitions <= 50:
        parser.error("--repetitions must be between 1 and 50")
    return args


def discover_scenarios(selected: list[str]) -> list[Path]:
    if selected:
        paths = [(ROOT / value).resolve() for value in selected]
        for path in paths:
            if SCENARIO_ROOT not in path.parents or path.suffix != ".yaml" or not path.is_file():
                raise ValueError(f"scenario must be an existing YAML beneath scenarios/: {path}")
        return sorted(set(paths))
    paths = sorted(SCENARIO_ROOT.rglob("*.yaml"))
    if not paths:
        raise ValueError("no maintained scenarios/*.yaml files found")
    return paths


def stable_observation(result: dict[str, Any]) -> dict[str, Any]:
    scenario = result.get("result")
    if not isinstance(scenario, dict):
        raise ValueError("scenario CLI output has no result object")
    expectations = scenario.get("expectationResults")
    if not isinstance(expectations, list) or not expectations:
        raise ValueError("scenario returned no declared expectation results")
    failed = [item for item in expectations if not isinstance(item, dict) or item.get("passed") is not True]
    if failed:
        raise ValueError("scenario output contains failed or malformed expectations")

    def normalize_generated_ids(value: Any) -> Any:
        if isinstance(value, str):
            return UUID_PATTERN.sub("<runtime-uuid>", value)
        if isinstance(value, list):
            return [normalize_generated_ids(item) for item in value]
        if isinstance(value, dict):
            return {key: normalize_generated_ids(item) for key, item in value.items()}
        return value

    return {
        "scenario_id": scenario.get("scenarioId"),
        "completed_steps": scenario.get("completedSteps"),
        "expectations": [
            {"path": item["path"], "expected": normalize_generated_ids(item.get("expected")), "passed": item["passed"]}
            for item in expectations
        ],
    }


def parse_cli_result(stdout: str) -> dict[str, Any]:
    # Mock voice emits one-line structured trace records before the CLI's final
    # pretty-printed JSON result. Select that final result block explicitly.
    start = stdout.rfind('\n{\n  "')
    if start >= 0:
        stdout = stdout[start + 1 :]
    return json.loads(stdout)


def main() -> int:
    args = parse_args()
    if not CLI.is_file():
        print("Scenario CLI is missing. Run `npm run build` first.", file=sys.stderr)
        return 2
    try:
        scenarios = discover_scenarios(args.scenario)
        run_rows: list[dict[str, Any]] = []
        failures = 0
        for scenario_path in scenarios:
            relative = scenario_path.relative_to(ROOT).as_posix()
            scenario_hash = sha256(scenario_path.read_bytes())
            fingerprints: set[str] = set()
            for repetition in range(1, args.repetitions + 1):
                started = time.perf_counter_ns()
                completed = subprocess.run(
                    ["node", str(CLI), str(scenario_path), "--fast"],
                    cwd=ROOT,
                    text=True,
                    capture_output=True,
                    check=False,
                )
                elapsed_ms = (time.perf_counter_ns() - started) / 1_000_000
                row: dict[str, Any] = {
                    "scenario_path": relative,
                    "scenario_sha256": scenario_hash,
                    "repetition": repetition,
                    "process_elapsed_ms": round(elapsed_ms, 3),
                    "command": ["node", "dist/adapters/simulator/src/cli.js", relative, "--fast"],
                    "data_mode": "simulated; mock voice where declared",
                    "passed": False,
                }
                if completed.returncode == 0:
                    try:
                        cli_result = parse_cli_result(completed.stdout)
                        observation = stable_observation(cli_result)
                        fingerprint = sha256(json.dumps(observation, sort_keys=True, separators=(",", ":")).encode())
                        fingerprints.add(fingerprint)
                        row.update({
                            "passed": True,
                            "scenario_id": observation["scenario_id"],
                            "completed_steps": observation["completed_steps"],
                            "expectations_passed": len(observation["expectations"]),
                            "stable_outcome_sha256": fingerprint,
                        })
                    except (json.JSONDecodeError, ValueError, KeyError, TypeError) as exc:
                        row["failure"] = f"INVALID_SCENARIO_RESULT: {exc}"
                else:
                    row["failure"] = completed.stderr.strip()[-2000:] or f"scenario exit code {completed.returncode}"
                if not row["passed"]:
                    failures += 1
                run_rows.append(row)
            if len(fingerprints) > 1:
                failures += 1
                run_rows.append({
                    "scenario_path": relative,
                    "scenario_sha256": scenario_hash,
                    "passed": False,
                    "failure": "NONDETERMINISTIC_EXPECTATION_OUTCOME",
                    "distinct_stable_outcomes": len(fingerprints),
                })

        report = {
            "report_version": "aura-scenario-reliability-v1",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "repository": repository_state(),
            "repetitions_per_scenario": args.repetitions,
            "scenario_count": len(scenarios),
            "execution_count": len(scenarios) * args.repetitions,
            "failed_checks": failures,
            "checks_passed": failures == 0,
            "evidence_scope": {
                "claim": "local fresh-process simulator replay reproducibility only",
                "excludes": ["product reliability", "first-response latency", "barge-in latency", "device behavior", "live provider behavior", "model quality", "physical vehicle behavior"],
                "process_elapsed_ms_is_product_latency": False,
            },
            "runs": run_rows,
        }
        encoded = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        if args.report:
            destination = args.report if args.report.is_absolute() else ROOT / args.report
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(encoded, encoding="utf-8")
            print(json.dumps({"report_path": str(destination), "checks_passed": report["checks_passed"], "scenario_count": report["scenario_count"], "execution_count": report["execution_count"], "failed_checks": failures}, sort_keys=True))
        else:
            sys.stdout.write(encoded)
        return 0 if failures == 0 else 1
    except (OSError, ValueError) as exc:
        print(f"Scenario reliability run failed: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
