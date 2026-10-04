# AURA project guidance

For HMI work, read `docs/product/AURA_MASTER_SPEC_2026-10-02.md` Sections 61 and 64 and `AURA_UI_UX_Handoff/CODEX_INSTRUCTIONS.md` before implementing. Inspect the relevant final image; do not implement from a generic dashboard description.

For Cluster work, also read `AURA_UI_UX_Handoff/AURA_Cluster_Implementation_Target_2026-10-03.md` and inspect `AURA_UI_UX_Handoff/previews/cluster-reference.html`. This supplement records the user's four independent tire-pressure readings and centered, non-swaying car. The original image remains the visual reference for other details; Master Spec safety, policy, provenance and display contracts still apply.

The preview is a design demonstrator, not production code or a vehicle dynamics model. Reuse existing React and gateway architecture. Keep demonstration controls in the Developer / Simulation Console, outside the production read-only Cluster.

After visual changes, compare screenshots to the reference, check both the 8:3 Cluster and a narrow preview, and run the relevant existing build/checks. Report any visual verification that could not run; do not call an unrendered UI visually verified.

For Center, Passenger, Rear and Window work, also read `AURA_UI_UX_Handoff/AURA_Four_Display_Implementation_Target_2026-10-03.md` and open `AURA_UI_UX_Handoff/previews/four-display/index.html`. Reuse the existing simulator and gateway; the preview's shared local state demonstrates consent and load policy but is not a replacement ActionGate. Keep original display ratios and inspect each final image. Window energy fixtures do not select a vehicle powertrain.
