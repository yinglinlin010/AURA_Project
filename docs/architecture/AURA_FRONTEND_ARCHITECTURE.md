# AURA Frontend Architecture (Current Web Simulator)

## Scope and current status

`apps/web-simulator` is a Vite + React visual simulator. [`src/App.tsx`](../../apps/web-simulator/src/App.tsx) renders the five Section 64 role previews: Cluster, Center, Front Passenger, Rear, and Interactive Window. A separate Developer Control Console sits outside those display previews. The five compositions are visual references in one browser page, not five independent HMI clients or proof that five physical displays are connected. The final visual authority remains Section 64 of [`AURA_MASTER_SPEC_2026-10-02.md`](../product/AURA_MASTER_SPEC_2026-10-02.md) and the supplied [`AURA_UI_UX_Handoff/`](../../AURA_UI_UX_Handoff/).

Two live gateway connections are opened from this page using enabled registry identities `center-main` / `main-computer` and `front-passenger-main` / `main-computer`. Each connection registers independently and has its own session identity. Shared Core state is received through snapshots and events; the two connections do not make the other three visual previews into registered clients.

## Gateway connection and shared state

The hook is [`apps/web-simulator/src/core/useAuraCommand.ts`](../../apps/web-simulator/src/core/useAuraCommand.ts). It uses `VITE_AURA_WS_URL`, or the page host with `VITE_AURA_WS_PORT` (default `8080`) and `/ws`. Client registration uses protocol version 1. Commands use the protocol's nested shape: `{ kind: "command", envelope: { ... , sender, command } }`; the sender display/device identity and runtime session ID must match the connection.

Both connections consume the shared snapshots and relevant events. The Cluster speed and Control Console display use shared vehicle state, while driver cognitive-load reports update shared load state. The Control Console sends `vehicle.telemetry.report` and `driver.cognitive_load.report` through the Center registration and displays its gateway status and last receipt/message.

The Front Passenger **Propose stop** interaction sends `action.propose` for `ADD_TRIP_STOP`, with `targetRole: "center"`, `priority: "secondary"`, and `requiresConsent: true`. The proposal ID, place label, and category are carried in the nested proposal request. Center renders proposal status from gateway snapshots/events and sends `action.consent` with `approve` or `decline` over its own registered connection. Deferred state and release after driver load falls are rendered from shared proposal status/reason events. An accepted `journey.stop.added` event adds the stop to the visible Center journey; the UI does not treat a click or command send as acceptance.

Connection, registration, receipt, and gateway error feedback are surfaced for both roles. If a connection is not registered, its corresponding actions are disabled or report the connection problem; an acknowledgement alone represents command receipt and is not proof of completed domain work.

## Center browser voice path

The simulator header's Center voice control starts a user-initiated browser capture flow through the Center gateway connection. The browser requests microphone permission, then uses an `AudioWorklet` processor to mix/resample to mono 16 kHz and encode signed 16-bit little-endian PCM. It sends `voice.start` / `voice.stop` protocol messages and binary PCM frames to the Gateway. The UI consumes `voice.status`, `voice.transcript`, `error`, and `voice.audio` markers, shows input/output transcript and error feedback, and plays returned provider PCM in the browser. Microphone access requires browser support for `getUserMedia`, `AudioContext`, and `AudioWorklet` in a secure context.

The host constructs a Voice Runtime and selects mock speech by default; live Gemini speech requires explicit live mode and a Gemini API key. This is a browser simulator integration, not validated vehicle microphone/speaker integration, wake-word detection, VAD, audio quality, or latency. The Center microphone feature does not implement camera/perception.

## Preview boundaries

The five display layouts and static route/place/weather details remain illustrative where not explicitly driven by shared gateway state. Rear and Interactive Window controls are local preview state. Do not represent their content as live provider data.

The host's `Gemma2BOfflineSimulator` is deterministic text matching, not local model inference. Places, routing, weather, and SQLite journey adapter implementations exist, but the host does not start the external adapter stack; these adapters are not the source of preview data. Offline/cloud continuity is a product direction and is not demonstrated as an integrated runtime capability.

Styling lives in [`apps/web-simulator/src/App.css`](../../apps/web-simulator/src/App.css) and [`apps/web-simulator/src/index.css`](../../apps/web-simulator/src/index.css). The backend registration and protocol sources are [`apps/core-host/src/main.ts`](../../apps/core-host/src/main.ts), [`apps/core-host/src/hmi-gateway.ts`](../../apps/core-host/src/hmi-gateway.ts), and [`apps/core-host/config/display-registry.json`](../../apps/core-host/config/display-registry.json).
