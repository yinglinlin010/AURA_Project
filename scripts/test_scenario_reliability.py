"""Unit tests for the fresh-process scenario reliability harness."""
from __future__ import annotations

import unittest

from scenario_reliability import parse_cli_result, stable_observation


class ScenarioReliabilityTests(unittest.TestCase):
    def test_cli_result_skips_structured_trace_lines(self) -> None:
        stdout = '{"component":"voice-runtime","traceId":"t"}\n{\n  "result": {"scenarioId":"m3","completedSteps":1,"expectationResults":[{"path":"voice.state","expected":"IDLE","actual":"IDLE","passed":true}]}\n}\n'
        parsed = parse_cli_result(stdout)
        self.assertEqual(parsed["result"]["scenarioId"], "m3")

    def test_runtime_uuids_are_normalized_but_assertions_are_preserved(self) -> None:
        first = {"result": {"scenarioId": "m3", "completedSteps": 1, "expectationResults": [{"path": "proposal.id", "expected": "proposal:abc-123e4567-e89b-12d3-a456-426614174000", "actual": "ignored", "passed": True}]}}
        second = {"result": {"scenarioId": "m3", "completedSteps": 1, "expectationResults": [{"path": "proposal.id", "expected": "proposal:abc-123e4567-e89b-12d3-a456-426614174001", "actual": "ignored", "passed": True}]}}
        self.assertEqual(stable_observation(first), stable_observation(second))

    def test_failed_or_missing_expectations_are_rejected(self) -> None:
        failed = {"result": {"scenarioId": "s", "completedSteps": 1, "expectationResults": [{"path": "state", "expected": "online", "actual": "offline", "passed": False}]}}
        empty = {"result": {"scenarioId": "s", "completedSteps": 1, "expectationResults": []}}
        with self.assertRaisesRegex(ValueError, "failed or malformed"):
            stable_observation(failed)
        with self.assertRaisesRegex(ValueError, "no declared expectation"):
            stable_observation(empty)


if __name__ == "__main__":
    unittest.main()
