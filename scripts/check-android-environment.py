#!/usr/bin/env python3
"""Read-only Android baseline preflight; never run Gradle, install, or build."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

BASELINE = {"jdk_major": 17, "gradle": "8.9", "sdk_api": "34", "build_tools": "34.0.0"}


def properties(path):
    """Read Java release / Android properties without executing configuration."""
    try:
        contents = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return {}
    values = {}
    for line in contents.splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"')
    return values


def java_major(version):
    match = re.match(r"(?:1\.)?(\d+)(?:[.\-+]|$)", version or "")
    return int(match.group(1)) if match else None


def java_probe(binary):
    # Prevent ambient JVM agent/options injection; only this child env is changed.
    env = dict(os.environ)
    for key in ("JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS"):
        env.pop(key, None)
    try:
        result = subprocess.run([str(binary), "-version"], capture_output=True,
                                text=True, timeout=5, shell=False, env=env)
        output = result.stderr + result.stdout
        match = re.search(r'(?:openjdk|java) version "([^"\n]+)"|javac\s+(\S+)', output)
        return {"command": [str(binary), "-version"], "exit_code": result.returncode,
                "version": (match.group(1) or match.group(2)) if match else None,
                "error": None if result.returncode == 0 else "JVM_VERSION_PROBE_FAILED"}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"command": [str(binary), "-version"], "exit_code": None,
                "version": None, "error": type(error).__name__}


def executable(path):
    return path.is_file() and os.access(path, os.X_OK)


def inspect_jdk(home, sources, probe=java_probe):
    home = Path(home).expanduser().resolve()
    java = home / "bin" / ("java.exe" if os.name == "nt" else "java")
    javac = home / "bin" / ("javac.exe" if os.name == "nt" else "javac")
    version = properties(home / "release").get("JAVA_VERSION")
    measured = probe(java) if executable(java) else {"version": None, "exit_code": None, "error": "JAVA_EXECUTABLE_MISSING"}
    compiler = probe(javac) if executable(javac) else {"version": None, "exit_code": None, "error": "JAVAC_EXECUTABLE_MISSING"}
    reasons = []
    if java_major(version) != BASELINE["jdk_major"]:
        reasons.append("JDK_RELEASE_NOT_17")
    if measured["exit_code"] != 0 or java_major(measured["version"]) != BASELINE["jdk_major"]:
        reasons.append("JAVA_RUNTIME_NOT_VERIFIED_17")
    if compiler["exit_code"] != 0 or java_major(compiler["version"]) != BASELINE["jdk_major"]:
        reasons.append("JAVAC_NOT_VERIFIED_17")
    return {"home": str(home), "sources": sources, "release_version": version,
            "runtime_probe": measured, "javac_probe": compiler, "javac": str(javac), "javac_present": executable(javac),
            "matches_baseline": not reasons, "reasons": reasons}


def inspect_gradle(home, sources):
    home = Path(home).expanduser().resolve()
    binary = home / "bin" / ("gradle.bat" if os.name == "nt" else "gradle")
    jars = sorted((home / "lib").glob("gradle-launcher-*.jar"))
    versions = [m.group(1) for path in jars
                if (m := re.fullmatch(r"gradle-launcher-(\d+(?:\.\d+)+(?:-[\w.]+)?)\.jar", path.name))]
    version = versions[0] if len(versions) == 1 else None
    core = home / "lib" / f"gradle-core-{version}.jar"
    present = binary.is_file() if os.name == "nt" else executable(binary)
    reasons = []
    if not present:
        reasons.append("GRADLE_EXECUTABLE_MISSING")
    if version != BASELINE["gradle"]:
        reasons.append("GRADLE_METADATA_NOT_8_9")
    if not core.is_file():
        reasons.append("GRADLE_CORE_JAR_MISSING")
    return {"home": str(home), "sources": sources, "executable": str(binary),
            "version": version, "version_evidence": [str(path) for path in jars],
            "evidence_kind": "filename_metadata_only; Gradle was not executed",
            "matches_baseline": not reasons, "reasons": reasons}


def inspect_sdk(root, sources):
    root = Path(root).expanduser().resolve()
    platform = root / "platforms" / "android-34"
    tools = root / "build-tools" / "34.0.0"
    platform_properties = properties(platform / "source.properties")
    tools_properties = properties(tools / "source.properties")
    required = [platform / "android.jar", tools / "lib" / "d8.jar", tools / "lib" / "apksigner.jar"]
    for name in ("aapt2", "zipalign", "d8", "apksigner"):
        suffix = (".bat" if name in ("d8", "apksigner") else ".exe") if os.name == "nt" else ""
        required.append(tools / (name + suffix))
    missing = [str(path) for path in required if not path.is_file()]
    unavailable = [str(path) for path in required[3:] if not executable(path)] if os.name != "nt" else []
    reasons = []
    if platform_properties.get("AndroidVersion.ApiLevel") != "34":
        reasons.append("SDK_PLATFORM_METADATA_NOT_34")
    if tools_properties.get("Pkg.Revision") != "34.0.0":
        reasons.append("BUILD_TOOLS_METADATA_NOT_34_0_0")
    if missing or unavailable:
        reasons.append("SDK_REQUIRED_FILES_MISSING_OR_NOT_EXECUTABLE")
    return {"root": str(root), "sources": sources, "platform_properties": platform_properties,
            "build_tools_properties": tools_properties, "required_files": [str(path) for path in required],
            "missing_files": missing, "not_executable": unavailable,
            "matches_baseline": not reasons, "reasons": reasons}


def add(candidates, path, source, explicit=False):
    if not path:
        return
    path = Path(path).expanduser().resolve()
    if explicit or path.exists():
        candidates.setdefault(path, []).append(source)


def discover(args, env=None, home=None):
    env = os.environ if env is None else env
    home = Path.home() if home is None else Path(home)
    jdk, gradle, sdk = {}, {}, {}
    add(jdk, args.jdk_home, "--jdk-home", True)
    add(jdk, env.get("JAVA_HOME"), "JAVA_HOME", True)
    java = shutil.which("java", path=env.get("PATH", ""))
    if java:
        add(jdk, Path(java).resolve().parent.parent, "PATH java")
    studio_paths = [Path(args.android_studio)] if args.android_studio else [
        Path("/Applications/Android Studio.app"), home / "Applications/Android Studio.app",
        Path("/opt/android-studio"), Path(env.get("LOCALAPPDATA", str(home))) / "Programs/Android/Android Studio"]
    for studio in studio_paths:
        for relative in ("Contents/jbr/Contents/Home", "Contents/jbr", "jbr"):
            add(jdk, studio / relative, "Android Studio bundled runtime")
    for directory in (Path("/Library/Java/JavaVirtualMachines"), home / "Library/Java/JavaVirtualMachines",
                      home / ".sdkman/candidates/java", Path("/usr/lib/jvm")):
        if directory.is_dir():
            for child in sorted(directory.iterdir()):
                add(jdk, child / "Contents/Home" if (child / "Contents/Home").is_dir() else child, "installed JDK directory")
    for prefix in (Path("/opt/homebrew/opt"), Path("/usr/local/opt")):
        for child in sorted(prefix.glob("openjdk*")):
            add(jdk, child / "libexec/openjdk.jdk/Contents/Home", "Homebrew existing JDK")
    add(gradle, args.gradle_home, "--gradle-home", True)
    add(gradle, env.get("GRADLE_HOME"), "GRADLE_HOME", True)
    binary = shutil.which("gradle", path=env.get("PATH", ""))
    if binary:
        add(gradle, Path(binary).resolve().parent.parent, "PATH gradle")
    gradle_user_home = Path(env.get("GRADLE_USER_HOME", str(home / ".gradle")))
    for distribution in sorted((gradle_user_home / "wrapper/dists").glob("*/*/gradle-*")):
        if distribution.is_dir():
            add(gradle, distribution, "existing cached Gradle distribution")
    for directory in (home / ".sdkman/candidates/gradle", Path("/opt/homebrew/opt/gradle/libexec"), Path("/usr/local/opt/gradle/libexec")):
        if directory.name == "libexec":
            add(gradle, directory, "Homebrew existing Gradle")
        elif directory.is_dir():
            for child in sorted(directory.iterdir()):
                add(gradle, child, "Sdkman existing Gradle")
    add(sdk, args.sdk_root, "--sdk-root", True)
    for key in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        add(sdk, env.get(key), key, True)
    for directory in (home / "Library/Android/sdk", home / "Android/Sdk", Path(env.get("LOCALAPPDATA", str(home))) / "Android/Sdk"):
        add(sdk, directory, "default existing SDK")
    return jdk, gradle, sdk


def select(entries, explicit, path_key):
    if explicit:
        entries = [item for item in entries if item[path_key] == str(Path(explicit).expanduser().resolve())]
    return next((item[path_key] for item in entries if item["matches_baseline"]), None)


def preflight(args, probe=java_probe, env=None, home=None):
    jdks, gradles, sdks = discover(args, env, home)
    candidates = {"jdk": [inspect_jdk(path, sources, probe) for path, sources in jdks.items()],
                  "gradle": [inspect_gradle(path, sources) for path, sources in gradles.items()],
                  "sdk": [inspect_sdk(path, sources) for path, sources in sdks.items()]}
    selected = {"jdk_home": select(candidates["jdk"], args.jdk_home, "home"),
                "gradle_home": select(candidates["gradle"], args.gradle_home, "home"),
                "sdk_root": select(candidates["sdk"], args.sdk_root, "root")}
    missing = [key for key, value in selected.items() if value is None]
    return {"baseline": BASELINE, "status": "ready" if not missing else "blocked",
            "ready_meaning": "path/version preconditions only, not build or APK validation",
            "selected": selected, "missing_baseline_components": missing, "candidates": candidates,
            "build_attempted": False, "apk_verified": False,
            "limitations": ["Gradle version uses local distribution metadata; Gradle was not executed",
                            "No downloads, installs, SDK manager, adb, AVD, or persistent environment changes",
                            "Plugin/dependency cache completeness, SDK licenses and build compatibility are not verified",
                            "Discovery is bounded to explicit/environment/PATH and standard local installation directories"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jdk-home", help="Existing JDK home (must be JDK 17)")
    parser.add_argument("--gradle-home", help="Existing Gradle distribution home (must be 8.9)")
    parser.add_argument("--sdk-root", help="Existing Android SDK root")
    parser.add_argument("--android-studio", help="Existing Android Studio app/installation root to inspect")
    args = parser.parse_args()
    try:
        report = preflight(args)
    except OSError as error:
        report = {"status": "error", "error": str(error), "build_attempted": False, "apk_verified": False}
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["status"] == "ready" else 1


if __name__ == "__main__":
    sys.exit(main())
