# AURA UI/UX Developer Handoff

**Attention Codex / UI Implementing Agents:**
The consolidated, written Competition V1 HMI specification is in Section 64 of `../docs/product/AURA_MASTER_SPEC_2026-10-02.md`. This folder preserves the five final image assets and supporting handoff material. Section 61.29 establishes the authority boundary; Section 64 contains the complete written UI/HMI rules.

## 🔴 CRITICAL PRIORITY RULE 🔴
**The 5 images inside the `images/` folder are the ABSOLUTE HIGHEST PRIORITY reference for UI implementation.** 
When generating UI code (CSS, Tailwind, Flutter, Android XML), you MUST strictly follow the layouts, grid proportions, and color logic shown in these specific images. 

If there is any conflict between your generic understanding of a "car dashboard" and these images, **THESE IMAGES ALWAYS WIN.**

**Conflict rule within this handoff:** if written visual descriptions disagree with the five final images about visible layout, proportion, color, material, or hierarchy, follow the images. Use Section 64 of the Master Spec for the consolidated HMI rules; supporting handoff text may clarify behavior only where it does not conflict with the Master Spec or final images.

## Design System: Tactile Slate
Read `AURA_Visual_System_Tactile_Slate.md` for exact color hex codes (Matte Charcoal, Slate Gray, Bone White, Industrial Orange) and structural rules (1px hairline grids, no drop shadows, no glowing neon).

## Display Layout Architecture
Read `AURA_Display_Grid_Layouts.md` for the exact percentage splits and component roles for all 5 displays (e.g., the 35/65 split on the Center Display).

## UX Logic & Scenarios
Read `AURA_HMI_Design_Spec.md` for the interaction logic, specifically the State Machines for cognitive-load deferral and safety interventions.
