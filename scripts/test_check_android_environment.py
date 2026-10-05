"""Preflight decision tests with isolated fixtures, no real JVM/Gradle execution."""
import argparse
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("android_environment", Path(__file__).with_name("check-android-environment.py"))
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class AndroidEnvironmentTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="aura-android-preflight-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def file(self, path, text=""):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def tool(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        # Reuse an executable via symlink; do not chmod any file or execute it.
        path.symlink_to(sys.executable)

    def jdk(self, version="17.0.12"):
        home = self.root / "jdk"
        self.file(home / "release", f'JAVA_VERSION="{version}"\n')
        for name in ("java", "javac"):
            self.tool(home / "bin" / (name + (".exe" if sys.platform == "win32" else "")))
        return home

    def gradle(self, version="8.9"):
        home = self.root / "gradle"
        self.tool(home / "bin" / ("gradle.bat" if sys.platform == "win32" else "gradle"))
        for name in ("launcher", "core"):
            self.file(home / "lib" / f"gradle-{name}-{version}.jar")
        return home

    def sdk(self):
        home = self.root / "sdk"
        self.file(home / "platforms/android-34/source.properties", "AndroidVersion.ApiLevel=34\nPkg.Revision=3\n")
        self.file(home / "platforms/android-34/android.jar")
        tools = home / "build-tools/34.0.0"
        self.file(tools / "source.properties", "Pkg.Revision=34.0.0\n")
        for name in ("d8", "apksigner"):
            self.file(tools / "lib" / f"{name}.jar")
        for name in ("aapt2", "zipalign", "d8", "apksigner"):
            suffix = (".bat" if name in ("d8", "apksigner") else ".exe") if sys.platform == "win32" else ""
            self.tool(tools / (name + suffix))
        return home

    @staticmethod
    def probe(version="17.0.12", code=0):
        return lambda _: {"exit_code": code, "version": version, "error": None}

    def test_ready_requires_matching_baseline_and_never_claims_apk(self):
        jdk, gradle, sdk = self.jdk(), self.gradle(), self.sdk()
        args = argparse.Namespace(jdk_home=str(jdk), gradle_home=str(gradle), sdk_root=str(sdk), android_studio=None)
        with patch.object(preflight, "discover", return_value=({jdk: ["fixture"]}, {gradle: ["fixture"]}, {sdk: ["fixture"]})):
            report = preflight.preflight(args, probe=self.probe())
        self.assertEqual(report["status"], "ready")
        self.assertEqual(report["missing_baseline_components"], [])
        self.assertFalse(report["apk_verified"])
        self.assertFalse(report["build_attempted"])

    def test_jdk25_and_gradle93_are_not_silently_accepted(self):
        jdk = preflight.inspect_jdk(self.jdk("25.0.3"), ["Android Studio"], self.probe("25.0.3"))
        gradle = preflight.inspect_gradle(self.gradle("9.3.0"), ["cache"])
        self.assertFalse(jdk["matches_baseline"])
        self.assertEqual(jdk["release_version"], "25.0.3")
        self.assertFalse(gradle["matches_baseline"])
        self.assertEqual(gradle["version"], "9.3.0")

    def test_release_metadata_cannot_override_runtime_mismatch(self):
        report = preflight.inspect_jdk(self.jdk(), ["fixture"], self.probe("25.0.3"))
        self.assertIn("JAVA_RUNTIME_NOT_VERIFIED_17", report["reasons"])
        self.assertIn("JAVAC_NOT_VERIFIED_17", report["reasons"])

    def test_missing_compiler_is_not_a_complete_jdk(self):
        home = self.jdk()
        (home / "bin" / ("javac.exe" if sys.platform == "win32" else "javac")).unlink()
        self.assertIn("JAVAC_NOT_VERIFIED_17", preflight.inspect_jdk(home, ["fixture"], self.probe())["reasons"])

    def test_java_timeout_is_bounded_and_failed(self):
        with patch.object(preflight.subprocess, "run", side_effect=subprocess.TimeoutExpired("java", 5)):
            report = preflight.java_probe(self.root / "java")
        self.assertIsNone(report["exit_code"])
        self.assertEqual(report["error"], "TimeoutExpired")

    def test_java_probes_version_only_and_removes_ambient_agents(self):
        completed = subprocess.CompletedProcess([], 0, "", 'openjdk version "17.0.12"\n')
        with patch.dict(preflight.os.environ, {"JAVA_TOOL_OPTIONS": "-javaagent:unknown.jar"}), \
             patch.object(preflight.subprocess, "run", return_value=completed) as run:
            self.assertEqual(preflight.java_probe(Path("/fixture/java"))["version"], "17.0.12")
            self.assertEqual(run.call_args.args[0], ["/fixture/java", "-version"])
            self.assertFalse(run.call_args.kwargs["shell"])
            self.assertNotIn("JAVA_TOOL_OPTIONS", run.call_args.kwargs["env"])
        compiler = subprocess.CompletedProcess([], 0, "javac 17.0.12\n", "")
        with patch.object(preflight.subprocess, "run", return_value=compiler):
            self.assertEqual(preflight.java_probe(Path("/fixture/javac"))["version"], "17.0.12")

    def test_sdk_metadata_without_required_jars_is_blocked(self):
        home = self.sdk()
        (home / "build-tools/34.0.0/lib/d8.jar").unlink()
        report = preflight.inspect_sdk(home, ["fixture"])
        self.assertFalse(report["matches_baseline"])
        self.assertIn(str((home / "build-tools/34.0.0/lib/d8.jar").resolve()), report["missing_files"])

    def test_sdk_wrong_api_or_build_tools_revision_is_blocked(self):
        home = self.sdk()
        self.file(home / "platforms/android-34/source.properties", "AndroidVersion.ApiLevel=33\n")
        self.file(home / "build-tools/34.0.0/source.properties", "Pkg.Revision=36.0.0\n")
        report = preflight.inspect_sdk(home, ["fixture"])
        self.assertIn("SDK_PLATFORM_METADATA_NOT_34", report["reasons"])
        self.assertIn("BUILD_TOOLS_METADATA_NOT_34_0_0", report["reasons"])

    def test_partial_gradle_distribution_and_ambiguous_version_are_blocked(self):
        home = self.gradle()
        (home / "lib/gradle-core-8.9.jar").unlink()
        self.assertFalse(preflight.inspect_gradle(home, ["fixture"])["matches_baseline"])
        self.file(home / "lib/gradle-core-8.9.jar")
        self.file(home / "lib/gradle-launcher-9.3.0.jar")
        self.assertFalse(preflight.inspect_gradle(home, ["fixture"])["matches_baseline"])

    def test_explicit_invalid_path_does_not_fallback_to_other_candidate(self):
        good, bad = str(self.root / "good"), str(self.root / "missing")
        candidates = [{"home": good, "matches_baseline": True}, {"home": bad, "matches_baseline": False}]
        self.assertEqual(preflight.select(candidates, None, "home"), good)
        self.assertIsNone(preflight.select(candidates, bad, "home"))

    def test_missing_candidates_reports_each_missing_component(self):
        args = argparse.Namespace(jdk_home=None, gradle_home=None, sdk_root=None, android_studio=None)
        with patch.object(preflight, "discover", return_value=({}, {}, {})):
            report = preflight.preflight(args, probe=self.probe())
        self.assertEqual(report["status"], "blocked")
        self.assertEqual(report["missing_baseline_components"], ["jdk_home", "gradle_home", "sdk_root"])


if __name__ == "__main__":
    unittest.main()
