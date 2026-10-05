# Premium Journey competition recording readiness

## Scope

Complete replay and independent recording entries on the existing HMI. No five-screen redesign, overview optimization, Passenger feature, new HMI or video editing. The five display component bodies are unchanged from the start of this task. Original App.css remains an exact prefix; appended rules apply only to `.hmi-recording`. All prior Cluster, Center 29/71, map-label and vehicle-graphic changes remain.

## Files changed this task

- apps/web-simulator/src/App.tsx: recording entry class and control-only entry; existing HMI components untouched.
- apps/web-simulator/src/App.css: contain original single display in viewport, hide simulator header/footer/headings only in recording mode; preserve aspect ratio with letterboxing.
- apps/web-simulator/src/PremiumJourneyDirector.tsx: RESET begins at normal driver load, online, 40 km/h driving.
- packages/core-runtime/src/core-runtime.ts: attention increase re-evaluates awaiting Premium Journey consent and moves it to DEFER; low/normal reuses existing deferred-release flow and requires fresh consent.
- apps/core-host/src/hmi-gateway.ts: resync falls back to role-projected snapshot when replay contains role-private sequence gaps. Does not disclose filtered proposals.
- apps/core-host/test/hmi-gateway-proposal-privacy.test.ts: verify private-event gap resync advances sequence with current public state and zero leaked proposals.
- packages/core-runtime/test/premium-journey.test.ts: NORMAL request → HIGH invalidates consent → NORMAL asks again → ACCEPT → RESET regression.
- scenarios/competition-premium-journey.yaml: normal-drive opening and explicit HIGH after Add; 11 steps.
- this report, prior integration report recording note, artifacts/premium-journey-recording evidence.

## Recording URLs

Use browser fullscreen for recording. `record=1` fills browser content with one existing HMI and preserves its original aspect ratio without cropping. Letterboxing is expected on differing aspect ratios. Browser toolbar/OS fullscreen is controlled by the browser, not the route.

- Cluster: http://127.0.0.1:5178/?scenario=premium-journey&record=1&display=cluster-main
- Center: http://127.0.0.1:5178/?scenario=premium-journey&record=1&display=center-main
- Passenger: http://127.0.0.1:5178/?scenario=premium-journey&record=1&display=front-passenger-main
- Rear: http://127.0.0.1:5178/?scenario=premium-journey&record=1&display=rear-tablet
- Window: http://127.0.0.1:5178/?scenario=premium-journey&record=1&display=window-tablet
- Scenario control / RESET: http://127.0.0.1:5178/?scenario=premium-journey&control=1
- Developer Scenario Inspector: http://127.0.0.1:5178/?debug=premium-journey (legacy demo=premium-journey also retained)

All recording pages and controller connect to the same disposable competition CoreRuntime, port 8081. Start with `npm run start:competition`; preview uses `VITE_AURA_WS_PORT=8081 npm run dev --prefix apps/web-simulator -- --host 127.0.0.1 --port 5178`. No provider credentials or journey persistence used.

## States verified

Rear: online NORMAL preserves four tiles and shows journey intelligence; offline retains UI and journey, marks intelligence unavailable; Quiet hides non-critical media/call/intelligence, preserves journey; restore maintains Quiet and available_but_held; Rear Resume presents intelligence again.

Window: existing outside scene/status; spatial Donghu anchor → selection detail/+12/Add → brief request sent → accepted NEXT STOP; Quiet reduces non-essential overlays and retains essential time/route/accepted stop.

Center: no consent panel during HIGH/DEFER; normal shows Journey update available, Donghu · +12 min, ACCEPT / KEEP ROUTE; approval updates original timeline, next stop and route context.

Cluster: HIGH uses existing reduced presentation, normal restores concise; only accepted next-stop text; no passenger proposal card. Passenger unchanged.

A proposal submitted while load is normal is initially eligible for ASK under existing policy; raising load to HIGH retracts it into DEFER. Returning normal issues ASK again. No extra artificial delay/decision engine was added.

## Capability and simulation boundary

CLOUD OFFLINE/RESTORE report simulated connectivity to CoreRuntime. That connectivity controls cloud routing availability in the existing architecture and fixture Live Journey Intelligence presentation. It does not toggle OS network, terminate the local WebSocket, or connect/disconnect a real cloud provider. Local permissions, attention policy, consent, shared journey and Rear mode remain active. Cloud restored during Quiet means capability available but presentation held; Resume reveals the fixture information, not an actual newly fetched cloud payload.

Donghu POI, scene, +12 minutes, ETA/arrival, vehicle speed, driver load and connectivity are simulated. Shared state, role projection, policy decisions, consent and reset execute through real local CoreRuntime/Gateway. Real map geometry/routing, geolocated spatial anchoring, live cloud content and five physical vehicle displays remain unconnected.

## Repeatability evidence

Final code tested across five simultaneously open independent recording URLs plus separate controller. Three consecutive complete runs, no code changes or server restart between runs: Window requester, Rear requester, Window requester. Each used RESET NORMAL DRIVE → discover/select/Add → HIGH/DEFER → NORMAL/ASK → Center ACCEPT → role-specific shared updates → offline → local Rear Quiet command → restore held → original Rear Resume. All 3 passed.

Snapshots and assertions: artifacts/premium-journey-recording/three-runs.json. Each role rendered exactly one original device, simulator chrome hidden, device within viewport (1395×670 desktop). Screenshots cover each display, Window selection, Center ASK, Rear offline and Rear/Window HELD. Initial test exposed filtered-event resync gap; final three runs occurred after its fix.

Backend and web production builds passed. Full test suite: 177 Node, 14 Python, registry valid. One prior host-start test had a transient failure; the final full run passed all tests. Impeccable detector returned four warnings in pre-existing CSS; preserved per explicit visual freeze.

Stopped after integration, replay verification and recording routes. No redesign or editing of footage.
