# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users

Drivers are the primary users. AURA supports novice drivers and experienced drivers when they face unfamiliar roads, difficult maneuvers, uncertainty, or high cognitive load. Front-seat passengers and rear passengers are collaborators who can explore information, participate in trip planning, and propose journey changes for the driver to govern.

## Product Purpose

AURA is a local-first, context-aware AI layer for a multi-display automotive cockpit. It uses driver, vehicle, journey, environment, occupant, and connectivity context to decide when to help, how much assistance to provide, which intelligence capability to use, and where information should appear. It aims to reduce uncertainty and cockpit information overload while preserving useful capability and task continuity through network loss.

## Positioning

AURA is one adaptive assistant across five role-differentiated HMI surfaces, not five independent apps or a chatbot confined to one screen. Its distinguishing mechanism combines contextual intervention, governed actions, adaptive assistance, multi-display orchestration, and offline-first continuity. Novice-driver parking is an entry scenario; the product also serves any driver in an unfamiliar, uncertain, demanding, or risky moment.

## Operating Context

Competition V1 targets the Implementation Track and an Android HMI on Android 14+ with Target SDK 34, while preserving a path toward AAOS / CDC portability. The intended deployment maps five logical display roles across two physical devices. The current repository includes a browser-based web simulator and a registry describing those five roles; it does not yet establish that two physical devices or five live HMI clients are running. The intended experience spans driving, navigation, trip planning, parking, passenger collaboration, changing connectivity, and parked use.

The five roles have distinct information responsibilities:

- Cluster: immediate driving information, essential navigation, and concise high-priority guidance; never general chat.
- Center: primary driver interaction, journey and vehicle information, navigation, parking guidance, and governed action confirmation.
- Front Passenger: richer conversation, discovery, comparison, and trip planning without overloading the driver.
- Rear: passenger experience and proposals that may require driver approval.
- Interactive Window: ambient time and weather, contextual information, AURA presence, and lightweight interaction or handoff.

## Capabilities and Constraints

- Product direction: hybrid AI is Offline First, Cloud Enhanced. This is not an implementation claim: the current repository does not demonstrate offline/cloud continuity or local model inference. Deterministic priority and safety logic are implemented in the TypeScript core; cloud services and local capabilities remain subject to the integration boundaries below.
- AURA adapts assistance to capability, maneuver, road and environmental context, risk, and interaction load. Assistance ranges from silence or awareness through help and guidance to warnings.
- Cross-display actions pass through shared state, events, policy, and experience orchestration. A display must not directly control another display.
- Generative AI may propose structured actions; policy, consent, deterministic safety supervision, and domain execution govern them. Immediate safety warnings cannot depend on cloud latency.
- Competition V1 is guidance, HMI, and cognitive assistance. It does not control real steering, braking, or acceleration and must not claim autonomous driving, collision avoidance guarantees, production ADAS, or automotive certification.
- Vehicle and sensor signals such as CAN data, speed, gear, steering, pedals, and obstacle distance are simulated in the competition prototype. Maps, places, traffic, parking, and weather may be real, simulated, or mixed and must be represented accurately.
- The integrated HMI visual system and interaction rules are in Section 64 of `AURA_MASTER_SPEC_2026-10-02.md`. The five Antigravity images in [`../../AURA_UI_UX_Handoff/images/`](../../AURA_UI_UX_Handoff/images/) remain the highest authority for visible layout, proportion, color, material, and hierarchy. The Vite/React simulator presents all five visual role previews in one browser page; the Section 64 compositions remain the display references, while much of the displayed route and provider content remains illustrative.
- The TypeScript Core Runtime and WebSocket HMI Gateway are connected in `apps/core-host/src/main.ts`. The browser opens two registered gateway connections (`center-main` and `front-passenger-main`), not five separately running display clients. The front passenger can propose an `ADD_TRIP_STOP` for Center, Center can approve or decline through protocol commands, and shared proposal/status/journey events drive the visible result. The Developer Control Console reports vehicle speed and driver cognitive load; shared telemetry updates the Cluster speed preview.
- The Center browser UI has a user-started microphone path using `AudioWorklet` to send mono 16 kHz PCM through gateway voice start/stop messages. It displays gateway voice status, transcripts, and errors and can play returned provider audio. This browser path does not establish a production in-vehicle audio integration or prove end-to-end speech quality or latency.
- Driver cognitive load has four canonical levels (`low`, `normal`, `high`, `critical`); an unobserved value is represented by absent state metadata, with confidence separate. Secondary proposals defer at high/critical load and are reevaluated at normal/low.
- The host constructs its voice/intelligence stack. The local `Gemma2BOfflineSimulator` is deterministic command matching, not local model inference; the speech adapter defaults to mock mode unless live voice is explicitly configured. Places, routing, weather, and SQLite journey adapter implementations exist, but the external adapter stack is not started by the host entry point; preview content should not be described as live provider data. Camera/perception and offline/cloud continuity are product directions, not demonstrated integrated runtime capabilities.

## Brand Commitments

AURA is a configurable working codename, not the final brand. The assistant name and wake word are also configurable. The assistant should feel like one continuous identity across local and cloud intelligence; any character is a state-communication layer, not a verbose chatbot persona. The integrated UI visual system and tokens are in Section 64 of `AURA_MASTER_SPEC_2026-10-02.md`, with final image assets and supporting handoff material in `AURA_UI_UX_Handoff/`; no final product name or logo has been approved.

## Evidence on Hand

[`AURA_MASTER_SPEC_2026-10-02.md`](AURA_MASTER_SPEC_2026-10-02.md) is the product, architecture, and HMI source of truth; its Sections 61–64 contain the latest frozen decisions and supersede conflicting earlier wording. [`../../AURA_UI_UX_Handoff/images/`](../../AURA_UI_UX_Handoff/images/) contains the user-designated final Antigravity UI images. The repository contains five visual role previews and two registered browser gateway connections with telemetry, proposal/consent/journey, and Center voice paths. Core Host conditionally constructs Mapbox search/routing adapters when configured, but the gateway, recommendation flow, and UI do not call them yet. It does not contain a completed Android HMI, five live display clients, locally trained model inference, camera/perception integration, integrated offline/cloud continuity, measured benchmark results, user-study findings, or completed competition-demo evidence. Future work must not invent those claims or represent simulated signals as real.

## Product Principles

- Help when context and expected benefit justify interruption; silence is a valid response.
- Adapt assistance and information density to the driver's capability, current task, and cognitive load.
- Keep one coherent assistant across role-specific displays and govern shared actions centrally.
- Keep safety- and latency-sensitive behavior local and deterministic; cloud intelligence enhances the experience.
- Preserve task continuity and be clear about simulated, cached, stale, and live information.
