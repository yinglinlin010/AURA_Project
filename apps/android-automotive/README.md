# AURA Android Automotive baseline

This is platform and build plumbing for an Android Automotive API 34 target. `BaselineActivity` is a clearly labeled empty packaging entry point; it is not a product screen. Product UI, layout, styling, and interaction decisions belong to the UI designers and their handoff.

## Build

Use JDK 17 and Gradle 8.9 or a compatible Gradle installation, with Android SDK Platform 34 and Build Tools 34.0.0 installed. From this directory, run:

```sh
gradle assembleDebug
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

## Future HMI client boundary

When a product UI is added, it may host a Kotlin transport/repository that implements the existing Core Host HMI WebSocket protocol. The contract source of truth is [`contracts/protocol/src/types.ts`](../../contracts/protocol/src/types.ts) and [`contracts/protocol/schemas/protocol.schema.json`](../../contracts/protocol/schemas/protocol.schema.json); the Core Host serves the WebSocket gateway at `/ws`. A future host should own connection, protocol-version registration, snapshot/event delivery, resynchronization, and lifecycle cleanup, then expose typed state/events to whichever UI the designers specify. Keep protocol handling independent of views and do not bypass the protocol for Core Host state changes. This baseline contains no HMI client, network behavior, or requested permissions.

## Validation record

Validation commands and results:

- From `apps/android-automotive`, `gradle assembleDebug` — exit 127: `gradle: command not found`.
- From the workspace root, `java -version` — exit 1: the operating system reports that it cannot locate a Java Runtime.
- From the workspace root, `/Users/yinglin/Library/Android/sdk/platform-tools/adb devices -l` — no connected devices.
- From the workspace root, `/Users/yinglin/Library/Android/sdk/emulator/emulator -list-avds` — lists `AURA_Automotive_API34`; it is configured but not booted and was not started.

Android SDK Platform 34 and Build Tools 34.0.0 are installed. The missing Gradle executable and Java runtime prevent the requested build; install/launch, HMI, and hardware validation are not claimed.
