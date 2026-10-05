#!/usr/bin/env python3
"""Build the bundled PACT debug APK with existing, explicitly selected tools."""
import argparse
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--jdk-home', type=Path, required=True)
parser.add_argument('--gradle-home', type=Path, required=True)
parser.add_argument('--sdk-root', type=Path, required=True)
args = parser.parse_args()
java = args.jdk_home.resolve()
gradle = args.gradle_home.resolve() / 'bin' / 'gradle'
sdk = args.sdk_root.resolve()
for required in (java / 'bin' / 'java', gradle, sdk / 'platforms/android-34/android.jar'):
    if not required.exists(): parser.error(f'Missing: {required}')
preflight = subprocess.run(['python3', str(ROOT / 'scripts/check-android-environment.py'), '--jdk-home', str(java), '--gradle-home', str(gradle.parent.parent), '--sdk-root', str(sdk)], capture_output=True, text=True)
if preflight.returncode:
    print(preflight.stdout or preflight.stderr)
    raise SystemExit(preflight.returncode)
env = dict(os.environ, JAVA_HOME=str(java), ANDROID_HOME=str(sdk))
env['PATH'] = str(java / 'bin') + os.pathsep + env['PATH']
result = subprocess.run([str(gradle), '--no-daemon', 'assembleDebug', 'lintDebug'], cwd=ROOT / 'apps/android-automotive', env=env)
raise SystemExit(result.returncode)
