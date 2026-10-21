---
target: the control panel
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx"
target_fingerprint: "sha256:9fbd5687146c7d09dbd61d5dd0769ca318b722c4d9a0e02312313ea072ff1490"
target_path: /Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx
timestamp: 2026-10-21T13-18-53Z
slug: src-components-sidebar-jsx
closed: true
---
Method: dual-agent (A: design review · B: detector + browser evidence). Parent verified A's claims against source; two were corrected.

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Standing line, rail badges, tile pips; no ink/pen readout in an open mode |
| 2 | Match system / real world | 3 | Survey terms + help work; rail abbreviations Terr/Surf/Over/Out/Pre are neither |
| 3 | User control and freedom | 3 | Undo, history menu, Reset all toast with Undo; Surprise-me roll history is not restored by that Undo |
| 4 | Consistency and standards | 2 | On/off said three ways (tile pip, Enabled toggle, ore bar); ore fills every slider track |
| 5 | Error prevention | 2 | Eight equal export buttons; SVG one misclick from STL/WebM |
| 6 | Recognition over recall | 3 | Tile glyphs, thumbnails, keys on export buttons; no stage keys |
| 7 | Flexibility and efficiency | 3 | / 1–5 \ ? exist; no stage hotkeys, rail ignores arrows, no filter in Marks sheet |
| 8 | Aesthetic and minimalist | 3 | Tested type scale and radii; open mode section ~25 controls in one column |
| 9 | Error recovery | 3 | Export status toasts, Undo on reset |
| 10 | Help and documentation | 3 | ? per control, shortcuts card |
| Total | | 28/40 | Good |

## Design Specificity Verdict
Authored for erzberg: contour watermark, numbered pipeline rail with scale-bar rule, mono standing line, iron/paper/ore with ore = on, 62 glyph tiles, survey labels. Generic part: inner controls (standard slider/toggle grid). Ore on every slider track dilutes "ore means on".
Detector: CLI 1 finding (broken-image Sidebar.jsx:937, false positive: code comment). URL 26: 23 undersized-ui-text (deliberate 9/10 px scale; "Reset all" and "Hypso. Integral" sit below the scale's own 11 px rule for buttons/labels), 1 placeholder contrast 4.47:1, 1 glass-button contrast 3.4:1 (App.jsx viewport hint, out of scope), 1 repeating-stripes (false positive: scale-bar rule). Overlay injected in headless Playwright only.

## Priority Issues
1. [P1] Output does not centre on SVG — eight equal buttons; no pen/layer/plot-length summary before export; Preflight buried. Fix: SVG primary full-width with summary line; PNG/STL/WebM secondary; preset save/open to Presets.
2. [P1] Pen assignment is invisible inside a mode — inks derive from colour source/gradient in Surface; no per-mode pen row; "2 inks" not openable. Fix: Pen/Ink row at top of each mode; standing-line inks open an ink list.
3. [P2] Mode sections are dense and say "on" three ways — ~25 controls; "Mode:" prefix; Enabled toggle duplicates the pip. Fix: drop prefix and Enabled row; sub-disclosures with summaries.
4. [P2] Rail labels and keyboard model — clipped 9 px words; aria-pressed buttons, no arrows, no stage keys; focus ring looks like selection. Fix: full words or number-only; tablist + roving tabindex; [ ] keys; distinct focus style.
5. [P2] Ore on every slider track — zero-value bipolar sliders (Height scale, Pan) look half on. Fix: iron fills, centre-origin fill for bipolar sliders.

## Persona Red Flags
Alex: no stage keys; scroll 62 tiles to reach Stereonet.
Sam: rail ignores arrows; pip labels phrase the action ("switch off") not state; help behind 14 px glyph.
Plotter artist: no per-mode pen; no ink list; no layer count before export; Plotter order/Preflight below WebM length; sheet size single slider, no A-series presets.

## Minor Observations
"Edit heightmap E" shortcut letter lacks keycap styling; collapse handle overlaps rail at stage 05; Roughness tile label truncated; Landforms 10 unlabeled swatches; "Draw Modes" adds a third heading level; stats block repeats in Frame and Output; undo/redo icons faint in light theme; Reset all sits next to the theme toggle.

## Questions to Consider
Should Output be a print dialog with a pen-layer preview? Is a flat 62-tile sheet a feature or a menu — would "marks in this look" + searchable "add a mark" serve better? If ore means on, why is every slider track ore?
