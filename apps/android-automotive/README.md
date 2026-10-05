# AURA Android Automotive baseline

> **2026-10-05 更新：PACT 離線 Demo 已完成 APK 建置與 Automotive 模擬器驗證。** 新增 `PactActivity`，內嵌本機介面，不需要開發伺服器。原 BaselineActivity 行為保留。操作、隔離工具路徑與驗證證據見 [PACT_MVP.md](../../docs/implementation/PACT_MVP.md)。下方 preflight-only 與未驗證敘述是先前 dispatch 的歷史紀錄。

This is platform and build plumbing for an Android Automotive API 34 target. `BaselineActivity` implements a debug-only WebView container loading `http://127.0.0.1:5173`. Product UI, layout, styling, and interaction decisions belong to the UI designers and their handoff.

## Build

The pinned preflight baseline uses JDK 17 and Gradle 8.9, with Android SDK Platform 34 and Build Tools 34.0.0 installed. From this directory, run:

```sh
gradle assembleDebug
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

> **Current preflight**: Android Studio provides JDK 25.0.3 and an existing local Gradle distribution provides metadata for 9.3.0; the required JDK 17 / Gradle 8.9 pair was not found in the inspected locations. The command above is a build reference, not permission to run it. APK build, install and device execution remain unverified; this dispatch permits preflight only.

## Local Loopback Execution

Once built and installed on a debug device or emulator, execute:

```sh
adb reverse tcp:5173 tcp:5173
adb reverse tcp:8080 tcp:8080
```

This maps the container's WebView requests (which target localhost) to the development host's Web UI instance.

## Limitations & Future HMI client boundary

This phase implements a container for the existing interactive UI (it is not static-only) but does **not** implement Android Voice or any microphone interaction yet. Note that this single container does not represent 5 independent clients, nor does it imply real-device sign-off or hardware validation.

The container strictly prevents external navigation, does not auto-grant Web permissions, disables file/content access, and restricts cleartext traffic to the localhost domain exclusively in debug mode. In a release build, the WebView is intentionally uninitialized, and a "Development container is unavailable" placeholder is shown to prevent accidental load.

When a product UI is eventually integrated into production, it may host a Kotlin transport/repository that implements the existing Core Host HMI WebSocket protocol. The contract source of truth is [`contracts/protocol/src/types.ts`](../../contracts/protocol/src/types.ts) and [`contracts/protocol/schemas/protocol.schema.json`](../../contracts/protocol/schemas/protocol.schema.json); the Core Host serves the WebSocket gateway at `/ws`. A future host should own connection, protocol-version registration, snapshot/event delivery, resynchronization, and lifecycle cleanup, then expose typed state/events to whichever UI the designers specify. Keep protocol handling independent of views and do not bypass the protocol for Core Host state changes.

## Historical Validation record

Validation commands and results:

- From `apps/android-automotive`, `gradle assembleDebug` — exit 127: `gradle: command not found`.
- From the workspace root, `java -version` — exit 1: the operating system reports that it cannot locate a Java Runtime.
- From the workspace root, `/Users/yinglin/Library/Android/sdk/platform-tools/adb devices -l` — no connected devices.
- From the workspace root, `/Users/yinglin/Library/Android/sdk/emulator/emulator -list-avds` — lists `AURA_Automotive_API34`; it is configured but not booted and was not started.

Android SDK Platform 34 and Build Tools 34.0.0 are installed. The missing Gradle executable and Java runtime prevent the requested build; install/launch, HMI, and hardware validation are not claimed.


## Read-only reproducible environment preflight (2026-10-04)

Issue [#12](https://github.com/yinglinlin010/AURA_Project/issues/12) adds
[`check-android-environment.py`](../../scripts/check-android-environment.py) and
[`test_check_android_environment.py`](../../scripts/test_check_android_environment.py).
The baseline is the local uncommitted `codex/aura-v1-integration` working tree;
GitHub HEAD `f5b6d211a7d2a53cd33924e06a5a775f80332251` does not contain all first-round work.
Existing UI and Android container changes are retained.
This slice supplies environment evidence only, not the complete AuraLink presentation,
geometry perception, blind-spot handoff, model or performance claims.

From the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/check-android-environment.py
# JSON is printed to stdout; select an external evidence path if needed:
PYTHONDONTWRITEBYTECODE=1 python3 scripts/check-android-environment.py > /tmp/aura-android-preflight.json
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts -p test_check_android_environment.py -v
```

Optional `--jdk-home`, `--gradle-home`, `--sdk-root`, and `--android-studio`
arguments point only to existing installations; they never install or persist configuration.
The first three explicit paths are authoritative: an invalid explicit path cannot silently
fall back to a different discovered installation.
The Android Studio argument specifies an app/installation root whose bundled runtime
is inspected alongside other candidates.
Discovery is bounded to those arguments, relevant environment variables, PATH,
standard system/user JDK, Homebrew/Sdkman, existing Gradle distribution cache,
Android Studio runtime and usual SDK locations; it is not a full-disk search.

The stdlib-only script reads JDK `release`, Gradle distribution jar filename metadata,
SDK `source.properties`, platform `android.jar`, build-tool launcher files and required
D8/apksigner jars. For discovered executable JVM tools it runs only `java -version`
and `javac -version`, using argument lists without a shell and a five-second timeout
per probe. Ambient JVM agent/options variables are omitted from these child processes
only; no persistent environment or permission is changed.
It never executes Gradle (including wrapper bootstrap), sdkmanager, adb or emulator,
never starts an AVD, and never downloads, installs or builds an APK.
Gradle version evidence is explicitly **metadata only**, not executable validation.
Tests use temporary fixtures and mocked JVM subprocess results, not Gradle/JDK execution.

JSON contains the exact paths, discovery sources, versions/probe outcomes, candidate
rejection reasons, SDK missing files and selected baseline components.
`status: ready` / exit 0 means only the pinned path/version preconditions are present;
`status: blocked` / exit 1 reports a missing or mismatched baseline component.
A filesystem inspection error emits `status: error` / exit 1; invalid CLI arguments exit 2.
All statuses keep `build_attempted: false` and `apk_verified: false`.
No plugin-cache completeness, SDK licensing, plugin compatibility, binary integrity,
APK compilation, UI rendering or physical-device result is inferred from ready.

### Actual inspected environment

| Component | Actual path / evidence | Pinned preflight result |
| --- | --- | --- |
| PATH Java | `/usr/bin/java` and `/usr/bin/javac` version probes exit 1 | OS launchers do not provide a usable JDK |
| Android Studio runtime | `/Applications/Android Studio.app/Contents/jbr/Contents/Home`; `release`, java and javac probes report `25.0.3` | Present, but not JDK 17 |
| Cached Gradle | `/Users/yinglin/.gradle/wrapper/dists/gradle-9.3.0-bin/79n14ral3mx1ozqr3csh2u872/gradle-9.3.0`; `gradle-launcher-9.3.0.jar`, core jar and launcher present | Present, but not Gradle 8.9; Gradle not executed |
| SDK Platform | `/Users/yinglin/Library/Android/sdk/platforms/android-34`; API 34, revision 3, android.jar present | Baseline files present |
| SDK Build Tools | `/Users/yinglin/Library/Android/sdk/build-tools/34.0.0`; revision 34.0.0, aapt2/zipalign/d8/apksigner and required jars present | Baseline files present |

No JDK 17 or Gradle 8.9 distribution was found in the bounded inspected locations.
This is not a claim that none could exist in an uninspected custom directory.
The existing newer JDK/Gradle pair is recorded rather than substituted into the pinned baseline.
[AGP 8.7 documentation](https://developer.android.com/build/releases/agp-8-7-0-release-notes)
lists Gradle 8.9, Build Tools 34.0.0 and JDK 17 as its baseline defaults/minima.
[Gradle's Java compatibility matrix](https://docs.gradle.org/current/userguide/compatibility.html)
places Java 25 runtime support at Gradle 9.1 or later; JDK 25 must not be assumed to run Gradle 8.9.
These facts do not prove this app builds with the cached newer pair.

### Verification record for this dispatch

- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts -p test_check_android_environment.py -v`: 11 fixture tests passed, including version mismatch, missing compiler/jars, bounded JVM probe failure, explicit invalid selection, and the ready-with-APK-unverified case.
- `PYTHONDONTWRITEBYTECODE=1 python3 scripts/check-android-environment.py > /tmp/aura-android-preflight-79f844df.json`: exit 1, `status: blocked`, SDK root selected and missing baseline components `jdk_home`, `gradle_home`.
- Initial fixture testing exposed a macOS `/var` → `/private/var` canonical-path expectation mismatch; only the test expectation was corrected.
- No Gradle invocation, build, download, AVD startup, installation or new APK validation was performed.

If a matching pair is later supplied via existing paths, rerun the preflight and submit
its evidence plus the exact isolated build command to the coordinator for separate approval.
Do not treat exit 0 as build authorization or a successful APK result.
