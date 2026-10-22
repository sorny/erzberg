---
target: the control panel
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx"
target_fingerprint: "sha256:5f83428099bb658ef9693515b2725a3c7f66590c2929eaac7854f8419690c2d1"
target_path: /Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx
timestamp: 2026-10-22T08-24-37Z
slug: src-components-sidebar-jsx
---
Method: dual-agent (A: design review · B: detector and browser evidence)

# Critique: erzberg control panel (working tree) — 30/40 (Good)
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Status | 3 | Stats footer repeats on every stage |
| 2 | Real world | 3 | "Hypso. Integral", "PNG α" shorthand |
| 3 | Control | 3 | Two undo pairs on Presets |
| 4 | Consistency | 2 | Header "2 inks" vs strip "3" layers vs "mixed" |
| 5 | Error prevention | 2 | Opening plate exports a mixed Contours layer; warning only in a tooltip |
| 6 | Recognition | 3 | Stage location must be remembered |
| 7 | Flexibility | 4 | Full key set; keys work after slider drag |
| 8 | Minimalist | 3 | Stats footer repeated; Terrain Style dense |
| 9 | Error recovery | 2 | Disabled Class/Plate reason in title only (colourSource.js:19) |
| 10 | Help | 3 | Long help texts in 272 px |

Detector: CLI 1 false positive (broken-image in a comment, Sidebar.jsx:945). Browser 18-26 per stage. Real: Alpine Survey jump button 10px (Sidebar.jsx:1763). Partly real: 9px rail tab words (kept on purpose), h1 = h2 = 13px, 6px ore glow on section dot. False positives: meta/readouts at 10px, 11px sentences, scale-bar stripes, SegGroup nested-cards.

## Priority issues
1. [P1] Mixed layer reaches export with no visible warning (PenStrip.jsx:83). Fix: warn line + "One ink" action. harden.
2. [P1] Three counts for pens (sectionSummary.js:176 inks vs pensOf layers). Fix: name one unit in both places. clarify.
3. [P2] Disabled-option reasons tooltip-only (colourSource.js:19). Fix: aria-disabled + aria-describedby or inline note. harden.
4. [P2] Overlay stage reads as broken (three "–" rows, floating stats). Fix: one-line invitations; stats footer only in Output. onboard.
5. [P3] Alpine Survey button 10px; h1=h2 13px; radio-looking pip on multi-select. typeset, polish.

## Persona red flags
Alex: two undo systems; Inks as picked twice; no "on only" grid view.
Sam: reasons and "mixed" in title only; swatches aria-hidden; Undo toast keyboard reach unverified.
Plotter artist: mixed trap; ink/layer mismatch; near-white #c0d5db ink; Minor/Major same-ink hint.

## Minor
Mode name three times on a sheet; GREEN token/comment naming; Hypso. Integral styled as control; Heightmap/save tile pattern; Preflight text pushes SVG down; Presets title repeated by section header.
