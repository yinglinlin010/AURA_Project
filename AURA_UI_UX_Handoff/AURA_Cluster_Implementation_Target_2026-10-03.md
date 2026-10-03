# AURA Cluster implementation target — 2026-10-03

## Purpose and scope

Carry the current conversation's Cluster reference into repository-based Codex work. The user requested a demonstration based on the repository's final Cluster image, asked to include both side information areas, corrected tire pressure to four independent wheel readings, requested driving motion, and explicitly removed left/right swaying. This document records those concrete requirements; it does not claim the complete prototype was approved as a final design or integrated into the app.

## References and authority

- Primary visible reference: `images/01_cluster_display_final.jpg` (relative to this folder).
- Working motion/content demonstrator: `previews/cluster-reference.html`. Open it in a browser via the project/local static server; its image reference resolves to the original JPG in this repository. The original-reference button permits comparison.
- Runtime, safety and display behavior: Master Spec Sections 61 and 64.
- Existing supporting handoff: `CODEX_INSTRUCTIONS.md` and `AURA_Visual_System_Tactile_Slate.md`.

Keep original layout, typography, matte appearance and restrained orange/gray instruments. Apply the four-wheel and no-sway corrections below instead of copying the original image's ambiguous combined pressure readout. Do not redesign the other four HMI displays for this task.

## Visible content

| Region | Required information |
|---|---|
| Top | Time, ambient temperature, drive/gear state and applicable vehicle telltales |
| Left outer area | Trip distance, average energy use, elapsed driving time, estimated range |
| Left instrument | Original reference's RPM instrument, precise arc and radially positioned ticks |
| Center | Large speed, km/h unit, road/lane view and rear-view vehicle graphic |
| Right instrument | Power output percentage; this is not battery state of charge |
| Right outer area | Top-view vehicle with FL, FR, RL, RR independent tire pressure values, units, and the existing temperature field with its actual signal meaning clarified |

Do not substitute Unicode symbols for precise telltales or an approximate CSS block for the reference vehicle. Implement instruments as vector components with accurate arc geometry and ticks. Original vehicle imagery may be reused for this prototype; a 3D asset is only needed if actual viewpoint/door animation is required.

## Four-wheel tire pressure

- Show **left front (FL), right front (FR), left rear (RL), right rear (RR)** separately.
- Place each reading near its wheel on the top-view vehicle where space permits; always retain explicit position labels and `bar` units.
- Preview fixtures: FL 2.4 bar, FR 2.4 bar, RL 2.5 bar, RR 2.5 bar. These are illustrative assignments, not measured data or confirmed wheel assignments from the original image.
- Production presentation must support four independent values. Changing one must not overwrite the other three. Missing readings should be shown as unavailable, not copied from a neighboring wheel.
- Do not invent four independent sensor streams if the runtime currently supplies fewer: identify the contract gap, extend the simulator/protocol through the existing architecture as needed, and clearly mark simulated provenance.

## Driving motion

- Keep the car anchored at the lane center: **no left/right oscillation, yaw wiggle, or decorative bobbing**.
- Convey forward travel through restrained perspective road markers moving toward the bottom of the display. The demonstrator uses center road markers for this effect.
- Marker travel rate responds to the speed signal. Speed zero freezes marker movement. Pausing the demonstrator also freezes motion.
- Keep frame-to-frame motion time-based and clean up animation loops on component unmount; respect reduced-motion settings.
- Do not animate the whole display or let motion obscure speed, warnings or essential navigation. Existing high/critical-load and safety suppression rules remain authoritative.

## Data and unresolved choices

- Competition V11 does not name a vehicle brand/model or require a fuel/EV/hybrid powertrain. No powertrain selection was made in this conversation.
- Retain RPM and Power for this visual task; do not silently convert the design to an EV-only layout. Their physical meaning and availability must be resolved before claiming an actual vehicle integration.
- The demonstrator derives RPM and Power from speed only to demonstrate visual updates. **Do not copy those formulas into production.** Speed, RPM and Power must use their own provided signals, or show unavailable/simulated state.
- Trip 24.8 km, average 16.1 kWh/100km, elapsed 0:42 h, range 412 km, time 14:38, ambient 21°C, and the source graphic's Temp 19°C are static example fixtures. They are not project observations or live sensor outputs.
- Keep all source/freshness labels consistent with Master Spec. The source graphic does not establish whether Temp is a tire, battery or other temperature; clarify the signal before assigning a production label.

## Layout and integration

- Production/reference Cluster aspect ratio is **8:3**. Keep all side information visible at intended display resolution.
- A narrow browser preview may move trip and four-wheel information below the instruments for readability; this is preview reflow, not a change to physical display ratio or another HMI.
- Cluster is read-only. Speed sliders, play/pause and original-image toggles are preview/developer controls; do not put them into the driver's production Cluster.
- Refactor existing `Cluster` in `apps/web-simulator/src/App.tsx` into focused components as appropriate. Retain existing gateway state, presentation resolver and safety behavior. Use JSON/shared state contracts rather than screen-to-screen calls.

## Acceptance checks

1. Compare a normal-load 8:3 screenshot against the final JPG's display area. Ignore the photographed steering wheel/dashboard exterior when measuring the display layout.
2. Confirm trip, consumption, elapsed time, range, four labeled tire values, temperature, speed, RPM and Power are visible and readable.
3. With speed positive, road markers move while car x-position/orientation stay fixed. At speed zero and paused state, markers stop.
4. Independently change FL/FR/RL/RR in fixtures and verify only the corresponding readout changes. Missing or stale inputs remain explicit.
5. Confirm safety warnings and high/critical-load presentation continue to suppress/defer information according to existing policy.
6. Run the relevant existing TypeScript/build checks and inspect a rendered desktop and narrow screenshot. Report checks actually run and remaining gaps.

## Demonstrator validation limits

The chat preview received script-syntax, state/input/toggle, motion/pause and field-presence checks. Browser screenshot QA could not run in that environment because a browser executable was unavailable. Do not describe the demonstrator as pixel-perfect, production-ready, or visually verified. Use it to communicate target behavior and verify the integrated app locally.
