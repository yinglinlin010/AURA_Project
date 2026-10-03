# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users

Drivers are the primary users. AURA supports novice drivers and experienced drivers when they face unfamiliar roads, difficult maneuvers, uncertainty, or high cognitive load. Front-seat passengers and rear passengers are collaborators who can explore information, participate in trip planning, and propose journey changes for the driver to govern.

## Product Purpose

AURA is a local-first, context-aware AI layer for a multi-display automotive cockpit. It uses driver, vehicle, journey, environment, occupant, and connectivity context to decide when to help, how much assistance to provide, which intelligence capability to use, and where information should appear. It aims to reduce uncertainty and cockpit information overload while preserving useful capability and task continuity through network loss.

## Positioning

AURA is one context-aware cabin assistant that helps people find and understand vehicle capabilities, coordinates authorized existing vehicle functions, and resumes tasks after interruption. Its first integrated scenario is finding a place where a passenger can get out conveniently with charging nearby. AURA asks only questions that change feasibility or ranking, preserves unknown facts, and does not infer age or mobility needs from “Mom.” Parking guidance is supplementary; AURA does not generate executable steering, braking, or acceleration control. See Section 61.31 of the Master Spec for the confirmed flow and acceptance boundaries.

## Operating Context

Competition V1 targets the Implementation Track and an Android HMI on Android 14+ with Target SDK 34, while preserving a path toward AAOS / CDC portability. The intended deployment maps five logical display roles across two physical devices. The current repository includes a browser-based web simulator and a registry describing those five roles; it does not establish two physical devices or independently running display clients. The intended experience spans driving, navigation, trip planning, parking, passenger collaboration, changing connectivity, and parked use.

The five roles have distinct information responsibilities:

- Cluster: immediate driving information, essential navigation, and concise high-priority guidance; never general chat.
- Center: primary driver interaction, journey and vehicle information, navigation, parking guidance, and governed action confirmation.
- Front Passenger: richer conversation, discovery, comparison, and trip planning without overloading the driver.
- Rear: passenger experience and proposals that may require driver approval.
- Interactive Window: ambient time and weather, contextual information, AURA presence, and lightweight interaction or handoff.

## Capabilities and Constraints

- Product direction: hybrid AI is Offline First, Cloud Enhanced. The repository implements connectivity state, a router with local fallback paths, deterministic safety logic, and simulated offline transitions. Optional Ollama inference can be configured. These do not establish complete task recovery, successful live-provider recovery, a trained AURA model, or target-device performance.
- AURA adapts assistance to capability, maneuver, road and environmental context, risk, and interaction load. Assistance ranges from silence or awareness through help and guidance to warnings.
- Cross-display actions pass through shared state, events, policy, and experience orchestration. A display must not directly control another display.
- Generative AI may propose structured actions; policy, consent, deterministic safety supervision, and domain execution govern them. Immediate safety warnings cannot depend on cloud latency.
- Competition V1 is guidance, HMI, and cognitive assistance. It does not control real steering, braking, or acceleration and must not claim autonomous driving, collision avoidance guarantees, production ADAS, or automotive certification.
- Vehicle and sensor signals such as CAN data, speed, gear, steering, pedals, and obstacle distance are simulated in the competition prototype. Maps, places, traffic, parking, and weather may be real, simulated, or mixed and must be represented accurately.
- The integrated HMI visual system and interaction rules are in Section 64 of `AURA_MASTER_SPEC_2026-10-02.md`. The five Antigravity images in [`../../AURA_UI_UX_Handoff/images/`](../../AURA_UI_UX_Handoff/images/) remain the highest authority for visible layout, proportion, color, material, and hierarchy. The Vite/React simulator presents all five visual role previews in one browser page; the Section 64 compositions remain the display references, while much of the displayed route and provider content remains illustrative.
- The TypeScript Core Runtime and WebSocket HMI Gateway are connected in `apps/core-host/src/main.ts`. One browser page opens five logical gateway sockets matching the enabled registry display/device/role pairs; these are simulation registrations, not five physical displays or independent hardware clients. The front passenger can propose an `ADD_TRIP_STOP` for Center, Center can approve or decline through protocol commands, and shared proposal/status/journey events drive the visible result. The Developer Control Console reports shared vehicle speed and driver cognitive load plus all five logical connection states; shared telemetry updates the Cluster speed preview.
- The Center browser UI has a user-started microphone path using `AudioWorklet` to send mono 16 kHz PCM through gateway voice start/stop messages. It displays gateway voice status, transcripts, and errors and can play returned provider audio. This browser path does not establish a production in-vehicle audio integration or prove end-to-end speech quality or latency.
- Driver cognitive load has four canonical levels (`low`, `normal`, `high`, `critical`); an unobserved value is represented by absent state metadata, with confidence separate. Secondary proposals defer at high/critical load and are reevaluated at normal/low.
- The host constructs its voice/intelligence stack. The `Gemma2BOfflineSimulator` is deterministic command matching; optional Ollama proposal inference is a separate candidate path. The speech adapter defaults to mock mode unless another explicit mode is configured. Core Host conditionally constructs Mapbox search/routing and SQLite journey adapters when `MAPBOX_ACCESS_TOKEN` is configured; Gateway has search and route-preview paths, but provider success and live ranking remain unverified. The web simulator's sample content is not live provider data. Camera capture, complete task recovery, existing-vehicle parking integration, and target-device behavior remain unverified.

## Brand Commitments

AURA is a configurable working codename, not the final brand. The assistant name and wake word are also configurable. The assistant should feel like one continuous identity across local and cloud intelligence; any character is a state-communication layer, not a verbose chatbot persona. The integrated UI visual system and tokens are in Section 64 of `AURA_MASTER_SPEC_2026-10-02.md`, with final image assets and supporting handoff material in `AURA_UI_UX_Handoff/`; no final product name or logo has been approved.

## Evidence on Hand

[`AURA_MASTER_SPEC_2026-10-02.md`](AURA_MASTER_SPEC_2026-10-02.md) is the product, architecture, and HMI source of truth. Section 61.31 records the 2026-10-04 product direction; Sections 61–64 retain the safety, architecture, and visual rules unless that amendment explicitly updates product positioning. [`../../AURA_UI_UX_Handoff/images/`](../../AURA_UI_UX_Handoff/images/) contains the user-designated final HMI images. The repository has five visual role previews and five logical Gateway registrations opened by one browser, plus telemetry, proposal/consent/journey, voice, connectivity, and optional local-model paths with the limits described above. This does not establish independent physical displays. The repository does not contain a completed Android HMI, independent hardware display clients, a trained AURA model, camera capture/perception integration, complete offline task recovery, verified existing-vehicle parking integration, measured benchmark results, user-study findings, or completed competition-demo evidence. See the [2026-10-04 execution audit](../implementation/AURA_COMPETITION_V1_REQUIREMENTS_AUDIT.md) for detailed evidence boundaries.

## Product Principles

- Help when context and expected benefit justify interruption; silence is a valid response.
- Adapt assistance and information density to the driver's capability, current task, and cognitive load.
- Keep one coherent assistant across role-specific displays and govern shared actions centrally.
- Keep safety- and latency-sensitive behavior local and deterministic; cloud intelligence enhances the experience.
- Preserve task continuity and be clear about simulated, cached, stale, and live information.
