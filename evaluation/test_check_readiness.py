#!/usr/bin/env python3
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
import sys
import io
import contextlib

# Mock jsonschema globally before any imports
mock_jsonschema = MagicMock()
sys.modules['jsonschema'] = mock_jsonschema

import check_readiness

class TestCheckReadinessDirectPatch(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.root_dir = Path(self.temp_dir).resolve()
        self.eval_dir = self.root_dir / "evaluation"
        self.eval_dir.mkdir()
        self.contracts_dir = self.root_dir / "contracts" / "protocol" / "schemas"
        self.contracts_dir.mkdir(parents=True)

        self.orig_eval_dir = Path(__file__).resolve().parent
        self.orig_contracts_dir = self.orig_eval_dir.parent / "contracts" / "protocol" / "schemas"

        shutil.copy(self.orig_eval_dir / "manifest.schema.json", self.eval_dir / "manifest.schema.json")
        if self.orig_contracts_dir.exists():
            shutil.copy(self.orig_contracts_dir / "protocol.schema.json", self.contracts_dir / "protocol.schema.json")

        self.model_path = self.root_dir / "model"
        self.model_path.mkdir()
        (self.model_path / "config.json").write_text("{}")
        (self.model_path / "model.safetensors").write_text("dummy")

        import hashlib
        self.dummy_case = b'{"dummy": "data"}\n'
        self.dummy_hash = hashlib.sha256(self.dummy_case).hexdigest()

        self.suites = [
            "intent_zh_tw",
            "parking_assistance",
            "journey_recommendation",
            "unsafe_action",
            "conversation_interruption"
        ]

        manifest_suites = []
        for suite_id in self.suites:
            suite_path = f"{suite_id}.jsonl"
            (self.eval_dir / suite_path).write_bytes(self.dummy_case)
            manifest_suites.append({
                "suite_id": suite_id,
                "path": suite_path,
                "case_count": 1,
                "sha256": self.dummy_hash
            })

        tool_hash = hashlib.sha256((self.contracts_dir / "protocol.schema.json").read_bytes()).hexdigest()

        self.valid_manifest = {
            "manifest_version": "aura-evaluation-registry-v1",
            "dataset_version": "test-v1",
            "status": "sealed_approved",
            "review_gates": {
                "content": "approved",
                "rights": "approved"
            },
            "tool_schema_version": f"protocol-v1@sha256:{tool_hash}",
            "suites": manifest_suites,
            "required_comparison_dimensions": [
                "intent_accuracy"
            ]
        }

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def write_manifest(self, data):
        (self.eval_dir / "manifest.json").write_text(json.dumps(data))

    def run_check(self, model_path=None, model_revision="rev1"):
        if model_path is None:
            model_path = str(self.model_path)

        import validate_registry
        import check_readiness

        old_val_root = validate_registry.ROOT
        old_cr_root = check_readiness.ROOT

        validate_registry.ROOT = self.eval_dir
        check_readiness.ROOT = self.eval_dir

        try:
            blockers = check_readiness.check_readiness(model_path, model_revision)
            return blockers
        finally:
            validate_registry.ROOT = old_val_root
            check_readiness.ROOT = old_cr_root

    def test_complete_qualified_fixture(self):
        self.write_manifest(self.valid_manifest)
        blockers = self.run_check()
        self.assertEqual(len(blockers), 0, f"Expected 0 blockers, got: {blockers}")

    def test_missing_suite(self):
        manifest = json.loads(json.dumps(self.valid_manifest))
        manifest["suites"].pop()
        self.write_manifest(manifest)
        blockers = self.run_check()
        self.assertTrue(any("Missing required suites" in b for b in blockers))

    def test_draft_status(self):
        manifest = json.loads(json.dumps(self.valid_manifest))
        manifest["status"] = "draft_pending_review"
        self.write_manifest(manifest)
        blockers = self.run_check()
        self.assertTrue(any("Registry status is 'draft_pending_review'" in b for b in blockers))

    def test_blank_revision(self):
        self.write_manifest(self.valid_manifest)
        blockers = self.run_check(model_revision="   ")
        self.assertTrue(any("Model revision is required but not provided or empty" in b for b in blockers))

    def test_empty_pending(self):
        manifest = json.loads(json.dumps(self.valid_manifest))
        manifest["suites"][0]["case_count"] = 0
        (self.eval_dir / manifest["suites"][0]["path"]).write_bytes(b"")
        import hashlib
        manifest["suites"][0]["sha256"] = hashlib.sha256(b"").hexdigest()
        manifest["review_gates"]["content"] = "pending_human_review"
        self.write_manifest(manifest)

        blockers = self.run_check()
        self.assertTrue(any("case_count <= 0" in b for b in blockers) or any("Registry schema/hash/count validation failed" in b for b in blockers) or any("case count mismatch" in b for b in blockers))
        self.assertTrue(any("Content review gate is not approved" in b for b in blockers))

    def test_missing_model(self):
        self.write_manifest(self.valid_manifest)
        blockers = self.run_check(model_path=str(self.root_dir / "non_existent"))
        self.assertTrue(any("Model directory not found" in b for b in blockers))

        (self.model_path / "config.json").unlink()
        blockers = self.run_check()
        self.assertTrue(any("Missing config.json" in b for b in blockers))

    def test_schema_hash_error(self):
        manifest = json.loads(json.dumps(self.valid_manifest))
        manifest["suites"][0]["sha256"] = "wronghash"
        self.write_manifest(manifest)

        blockers = self.run_check()
        self.assertTrue(any("Registry schema/hash/count validation failed" in b for b in blockers))

    def test_missing_cli_params_json(self):
        self.write_manifest(self.valid_manifest)
        import validate_registry
        import check_readiness

        old_val_root = validate_registry.ROOT
        old_cr_root = check_readiness.ROOT

        validate_registry.ROOT = self.eval_dir
        check_readiness.ROOT = self.eval_dir

        try:
            f = io.StringIO()
            with contextlib.redirect_stdout(f):
                ret = check_readiness.main([])
            self.assertEqual(ret, 1)
            output = json.loads(f.getvalue())
            self.assertFalse(output["ready"])
            blockers = output["blockers"]
            self.assertTrue(any("Model path not provided or empty" in b for b in blockers))
            self.assertTrue(any("Model revision is required but not provided or empty" in b for b in blockers))
        finally:
            validate_registry.ROOT = old_val_root
            check_readiness.ROOT = old_cr_root

if __name__ == "__main__":
    unittest.main()
