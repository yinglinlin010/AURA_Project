# Premium Journey integration into existing production HMI

Production preview: http://127.0.0.1:5178/?scenario=premium-journey
Developer inspector: http://127.0.0.1:5178/?debug=premium-journey
Legacy ?demo=premium-journey remains the explicitly labelled inspector.

## Architecture and bindings

Scenario `journey.point` signal → CoreRuntime/Event Bus → existing Gateway role projection → useAuraCommand snapshot/event bindings → resolvePresentation → existing App/ClusterDisplay components. No parallel set of screens or new decision engine.

- Rear: existing communication/settings areas receive journey, rearExperience and connectivity. Offline disables Live Journey Intelligence availability while preserving the four existing areas and shared journey. Quiet hides non-critical media/call content and intelligence; cloud restoration keeps available_but_held until explicit Rear Resume.
- Window: original photograph/status spatial surface receives a minimal POI anchor, selection detail, request feedback and accepted next stop. Quiet hides the POI before acceptance and reduces ambient overlays while retaining time, route and accepted next stop.
- Center: existing proposal panel receives ASK; existing attention policy suppresses it during DEFER. Acceptance updates original timeline, next-stop and simulated ETA summary. Map geometry unchanged.
- Cluster: existing reduced density supplies Focus at HIGH. Receives only accepted next-stop navigation text; no passenger POI card. Safety warning/critical density suppresses that text.
- Passenger: original component unchanged. Existing shared journey subscription retained; no new feature.

## Files changed in this integration

- apps/web-simulator/src/App.tsx, App.css
- apps/web-simulator/src/ClusterDisplay.tsx, ClusterDisplay.css
- apps/web-simulator/src/core/useAuraCommand.ts
- apps/web-simulator/src/main.tsx
- apps/web-simulator/src/PremiumJourneyDemo.tsx (developer label/route)
- apps/web-simulator/src/PremiumJourneyDirector.tsx (engineering controls outside HMI)
- apps/core-host/src/competition.ts (seed/reseed simulated context through runtime signal)
- packages/core-domain/src/premium-journey.ts (fixture signal validation/proposal mapping)
- packages/core-domain/src/presentation-resolver.ts
- packages/core-runtime/test/presentation-resolver.test.ts
- scenarios/competition-premium-journey.yaml (explicit spatial signal)
- this report and artifacts/premium-journey-hmi evidence

All pre-existing edits, including Center 29/71, map labels, Cluster scale/ticks and vehicle graphics, retained. Original CSS preserved as byte-identical prefix. RouteMap and PassengerDisplay remain identical to the start-of-integration baseline. See preservation.json.

## Verification

Backend build and web production build passed. Full suite: 176 Node tests, 14 Python tests, registry validation passed.

Three consecutive browser runs on the same live fixture host without intervening code edits: Window request, Rear request, Window request. Each run used RESET → original five HMIs → POI selection/Add → HIGH/DEFER (no Center prompt, Cluster reduced) → NORMAL/ASK in existing Center → ACCEPT → shared stop and existing summary → CLOUD OFFLINE (Rear unavailable, local socket/commands active) → QUIET (Rear/Window simplified) → CLOUD RESTORE (quiet preserved, held intelligence hidden) → original Rear RESUME (information visible). All 3 passed. Exact DOM observations are in three-runs.json. An earlier three-run verification was repeated after correcting clipping of the new Cluster next-stop text.

Rear single-route reconnect while Quiet confirmed available_but_held snapshot and hidden intelligence; Resume from that role restored availability. All five original single-display routes rendered one existing HMI each.

## Routes and screenshots

Prefix: http://127.0.0.1:5178/?scenario=premium-journey&display=

| Existing HMI | display value | Screenshot in artifacts/premium-journey-hmi |
|---|---|---|
| Cluster | cluster-main | cluster-main.jpg |
| Center | center-main | center-main.jpg |
| Passenger | front-passenger-main | front-passenger-main.jpg |
| Rear | rear-tablet | rear.jpg, rear-held.jpg |
| Window | window-tablet | window-tablet.jpg |

Additional screenshots: five-production-hmis.jpg, quiet-held.jpg, poi-selected.jpg, center-ask.jpg.

## Simulation and remaining connections

POI, +12 minute impact, Live Journey Intelligence arrival, connectivity and driver load remain explicitly simulated fixtures. Acceptance updates shared journey and existing HMI context; there is no real route geometry/distance recomputation, cloud data recovery payload/provider, map POI geolocation or vehicle/sensor/hardware connection. The original Munich–Stuttgart map and Window outside-view illustration remain unchanged. Five logical role sockets in one simulator are not five physical production devices. No requested scenario-state binding remains disconnected; Passenger intentionally has no new hero feature.

No visual redesign, deployment, commit or push performed.

Recording follow-up: see [premium-journey-recording-readiness.md](premium-journey-recording-readiness.md). RESET now starts NORMAL DRIVE; role-private resync gaps recover via projected snapshot; five chrome-free recording routes and separate controller verified in three consecutive multi-page runs.
