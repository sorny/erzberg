---
target: the control panel
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx"
target_fingerprint: "sha256:b33de3047bd6b844456f28bb75f82dc93eb18558b61deefd982ab088b77d35f2"
target_path: /Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx
timestamp: 2026-10-22T07-44-10Z
slug: src-components-sidebar-jsx
---
Method: dual-agent (A: design review · B: detector and browser evidence)

# Critique: erzberg control panel (src/components/Sidebar.jsx)

## Design health score — 27/40 (Acceptable)
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 3 | Pen count only after Preflight |
| 2 | Match real world | 3 | Weight in px; "Hypso. Integral" abbreviated |
| 3 | User control | 3 | Undo/redo/history, per-section reset, Undo on Reset all |
| 4 | Consistency | 2 | Ore carries ~7 meanings; two key-hint styles |
| 5 | Error prevention | 2 | Inks as picked (SVG colours) lives in Surface, off by default |
| 6 | Recognition | 3 | Family glosses only in title attributes |
| 7 | Flexibility | 3 | Shortcuts dead while a range slider has focus |
| 8 | Minimalist | 3 | Surface > Terrain Style wall (~20 controls) |
| 9 | Error recovery | 2 | No warning for tone-curved inks or frame cuts |
| 10 | Help | 3 | Help texts with changelog history; Depth tolerance repeats label |

## Specificity
Authored: iron/paper/ore, contour header, survey-tick ruler, numbered stages, mono readouts, engraved glyph tiles. Skeleton is the standard rail+sections pattern.
Detector: CLI 1 false positive (broken-image in a comment, Sidebar.jsx:938). Browser 22-105 per view: undersized/tiny text mostly the chosen scale, real for 9px tile names, 10px interactive controls, 10px sentences in Output; flat hierarchy mostly false positive (h2 = h3 = 12px real); stripes, dark-glow, nested-cards false positives. No overlay (headless).

## Priority issues
1. [P1] Plot-critical facts far from the plot: pen count/inks only after Preflight; Inks as picked in Surface. Fix: live pen strip under SVG button (see surfaces/pens.md). shape, layout.
2. [P1] Ore no longer means only "on": modified bar (ui.jsx:1181), primary buttons, badges. Particles shows ore bar while off. Fix: modified bar in iron, primary buttons paper-on-iron. colorize.
3. [P2] Shortcuts die after slider use: handler returns for every INPUT (Sidebar.jsx:964). Fix: exempt only text-entry inputs. harden.
4. [P2] Projection controls nested under Centre guides (Sidebar.jsx:2910); Orthographic/Plan oblique mutually exclusive switches. Fix: Projection group, 3-way segment. layout.
5. [P2] Small text on the wrong things: 9px tile names, 10px clickable segments/buttons, 10px sentences. Fix: 11px for interactive labels and sentences; stage title a step above 12px. typeset.

## Persona red flags
Alex: shortcuts dead after slider; no grid on/off key path; standing line not linked.
Sam: no tabpanel role; 2 tab stops x 62 tiles; glosses title-only; 20px pip target.
Plotter artist: no ink-to-layer preview; Height gradient pen count unclear; tone curve default; px weight.

## Minor
Collapse handle overlaps rail; Overlay empty; Reset in view row; "Roughness" truncated; history in help texts; stats footer on every stage; stale comments in stages.js and --hm-green-glow name; panel opens on Terrain not Presets.

## Questions
Output opens with pen layers? Open on Presets? Modified with no colour, ↺ only?
