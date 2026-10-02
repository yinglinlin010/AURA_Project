# AURA UI/UX Developer Handoff

**Attention Codex / UI Implementing Agents:**
This folder contains the definitive, frozen UI/UX specification for the AURA Project. This fulfills the requirement specified in Section 61.29 of the `AURA_MASTER_SPEC_2026-10-02.md` ("UI / Visual Design Freeze Boundary").

## 🔴 CRITICAL PRIORITY RULE 🔴
**The 5 images inside the `images/` folder are the ABSOLUTE HIGHEST PRIORITY reference for UI implementation.** 
When generating UI code (CSS, Tailwind, Flutter, Android XML), you MUST strictly follow the layouts, grid proportions, and color logic shown in these specific images. 

If there is any conflict between your generic understanding of a "car dashboard" and these images, **THESE IMAGES ALWAYS WIN.**

**Conflict rule within this handoff:** if written visual descriptions disagree with the five final images about visible layout, proportion, color, material, or hierarchy, follow the images. Use the HMI spec for interaction behavior and states the images do not show, as long as that behavior fits the final visual system.

## Design System: Tactile Slate
Read `AURA_Visual_System_Tactile_Slate.md` for exact color hex codes (Matte Charcoal, Slate Gray, Bone White, Industrial Orange) and structural rules (1px hairline grids, no drop shadows, no glowing neon).

## Display Layout Architecture
Read `AURA_Display_Grid_Layouts.md` for the exact percentage splits and component roles for all 5 displays (e.g., the 35/65 split on the Center Display).

## UX Logic & Scenarios
Read `AURA_HMI_Design_Spec.md` for the interaction logic, specifically the State Machines for cognitive-load deferral and safety interventions.
