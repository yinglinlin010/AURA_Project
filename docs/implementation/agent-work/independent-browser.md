# Independent browser role development entry — 2026-10-04

## Scope and authority

Issue #9 extends the local, uncommitted integration worktree; remote GitHub
`f5b6d211a7d2a53cd33924e06a5a775f80332251` does not include this slice.
The coordinator approved the five-file plan through Orca question
`msg_45a58e0fd4f7`. Existing UI/CSS, images, task UI, and first-round
independent-client transport remain intact.

This is foundational browser role selection, not completion of the newer
AuraLink presentation plan. It adds no geometry perception, blind-spot handoff,
model/performance evidence, FastAPI migration, vehicle control, or safety-clear
semantics. Gateway remains the authority for enabled registrations, role policy,
consent, privacy projection, and task recovery/revalidation. URL selection is a
development entry, not authentication.

## Entry URLs

Use the existing web simulator origin with one exact registry display ID:

| Query | Rendered existing surface | Logical connections selected |
| --- | --- | --- |
| no `display` parameter | five-surface overview and engineering Console | five |
| `?display=cluster-main` | Cluster | one Cluster |
| `?display=center-main` | Center | one Center |
| `?display=front-passenger-main` | Passenger | one Passenger |
| `?display=rear-tablet` | Rear | one Rear |
| `?display=window-tablet` | Window | one Window |
| empty, unknown, or repeated `display` | error message | zero |

Selection is fixed for the mounted page; reload/remount to change role.
The shared header/footer and existing layout styles are preserved; this slice
changes which existing surfaces render, not their visual design.
Only overview/Center exposes Listen. The developer ControlConsole and local
AssistanceTimingPanel are overview-only. Rear retains its proposal UI;
Passenger retains discovery/proposal UI; approval stays on Center.

Each single-role page owns its hook, socket, ordering cursor, and state, and
never connects other registrations. Hidden registrations have disconnected
placeholder metadata, not live sockets. Overview intentionally retains its
existing engineering shared-state model; its cross-role aggregation is not
claimed as independent-client privacy evidence.

Outbound operations are checked against the selected registration before send.
Center alone can use voice, task commands, recommendation requests, consent,
and simulator telemetry/load/connectivity reports. Passenger discovery uses
only the selected Passenger socket. Center/Passenger/Rear can send their
existing proposals; Cluster/Window remain read-only. Gateway policy is still
required and cannot be bypassed by a query string.

Welcome must match protocol version, display ID, role, nonempty session, and
nonnegative integer sequence. It does not require invented presence/device
fields absent from the current Gateway welcome. A mismatching/duplicate welcome
closes and disables retries for that registration until page reload.
Other JSON messages are ignored until that socket receives its own welcome;
snapshots validate nested protocol/display identity and ordering/session,
and events validate socket session/sequence before application. Transport
reconnect does not replay commands or automatically resume/retry tasks.

React StrictMode in development can run setup/cleanup/setup, causing a closed
probe followed by a new socket for the same selected role. Connection failures
use the existing selected-role transport reconnect policy. These do not select
other roles or authorize action retries.

## Changed files

- `apps/web-simulator/src/core/browser-display-selection.ts` (new pure entry/permission/welcome helpers; existing registration list moved here and re-exported by hook).
- `apps/web-simulator/src/core/browser-display-selection.test.ts` (new directed tests).
- `apps/web-simulator/src/core/useAuraCommand.ts` (entry-scoped registration and guards).
- `apps/web-simulator/src/App.tsx` (entry selection and conditional rendering only; existing uncommitted UI preserved).
- `docs/implementation/agent-work/independent-browser.md` (this report).

## Actual verification

- Node v20.20.2: **9/9 helper tests passed**, covering overview, five one-role
  selections, invalid/duplicate entries, role permission boundaries, registry
  consistency, and valid/invalid current-contract welcomes.
- Web TypeScript check passed with `--noEmit` and temporary build-info path.
- Vite production bundle passed, with output exclusively under
  `/tmp/aura-browser-entry.7uL0HS/vite`; no shared `dist`/`dist-test` output.
- Chrome accessibility inspection of all five role URLs on a dedicated local
  Vite origin `127.0.0.1:5199` confirmed exactly the selected existing role
  surface; Center alone retained Listen and Rear retained REST STOP.
- Invalid URL showed only the error message, and overview retained all five
  surfaces, Listen, and engineering Console.
- Browser verification used `VITE_AURA_WS_URL=ws://127.0.0.1:18993/ws`, a port
  confirmed to have no listener before testing; no Gateway handshake was used
  as evidence and no microphone/provider controls were activated.

Reproduce from the repository root:

```sh
VERIFY_DIR=$(mktemp -d /tmp/aura-browser-entry.XXXXXX)
./node_modules/.bin/tsc --target es2022 --module commonjs --moduleResolution node \
  --esModuleInterop --skipLibCheck --strict --types node --rootDir . \
  --outDir "$VERIFY_DIR" apps/web-simulator/src/core/browser-display-selection.test.ts
node --test "$VERIFY_DIR/apps/web-simulator/src/core/browser-display-selection.test.js"
./apps/web-simulator/node_modules/.bin/tsc -p apps/web-simulator/tsconfig.app.json \
  --noEmit --tsBuildInfoFile "$VERIFY_DIR/web.tsbuildinfo"
(cd apps/web-simulator && ./node_modules/.bin/vite build \
  --outDir "$VERIFY_DIR/vite" --emptyOutDir)
```

For offline rendering inspection, first verify the proposed Gateway/preview
ports are unused, then start a dedicated preview:

```sh
cd apps/web-simulator
VITE_AURA_WS_URL=ws://127.0.0.1:18993/ws ./node_modules/.bin/vite \
  --host 127.0.0.1 --port 5199 --strictPort
```

## Remaining evidence and operating constraints

This round did **not** measure browser WebSocket registration counts against a
live Gateway, five simultaneous browser processes, Gateway replay/reconnect,
real task/consent round trips, provider discovery, real microphone/audio,
Android/physical devices, or cryptographic Gateway identity. The helper tests
plus selected-registration hook loop establish the intended socket selection;
Chrome inspection establishes render selection, not live transport success.

The coordinator must arrange an isolated local Gateway with current registry
and no paid/external adapters before live multi-browser verification. Do not
run overview and a single-role client with the same display IDs against a
Gateway serving active user sessions; registration changes connection state.
The first-round CLI smoke can supplement transport verification, but cannot
replace browser lifecycle/permission/privacy tests. This slice does not fix
all overview cross-role cursor/projection limitations or implement a trusted
resume data source; resume retains the existing explicit fail-closed policy.
