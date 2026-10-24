---
target: erzberg interface and navigation
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx"
target_fingerprint: "sha256:45bb24dd752abce1c6f4b00c6e6784effa4389f8c88a79ad99b506e3ce0a0706"
target_path: /Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx
timestamp: 2026-10-23T16-54-58Z
slug: src-components-sidebar-jsx
---
# Critique: erzberg panel, navigation and feedback (2026-10-23)

Method: dual-agent (A: design review · B: detector + browser). Score 27/40 (Acceptable).

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | System status | 3 | Preset click: no toast; history says "8 sections" |
| 2 | Real world | 3 | "Format" means orientation; "0 inks · 1 mixed" header |
| 3 | User control | 3 | "Computing geometry…" overlay: no Cancel, blocks undo |
| 4 | Consistency | 2 | Ore means on, selected, modified, focus and busy |
| 5 | Error prevention | 2 | Preset click overwrites tuned work; bare 1–5 exports |
| 6 | Recognition | 3 | An off mark opens an empty pane |
| 7 | Flexibility | 3 | No preset search; 124 Tab stops in the Marks sheet |
| 8 | Minimalist | 3 | Redundant "Draw Modes" header in Marks |
| 9 | Error recovery | 2 | "export failed — see the console" |
| 10 | Help | 3 | Sheet hint below 62 tiles |

Priority issues:
1. [P1] Bundled preset click discards tuned work silently; history unlabeled (Sidebar.jsx:1279).
2. [P1] Tier-2 computing overlay blocks everything, no Cancel (App.jsx:2552).
3. [P1] Opening an off mark shows no controls or description (ModeSections.jsx:34, ModeSheet.jsx:237).
4. [P2] Ore overloaded (theme.js:26-27, ui.jsx:1050/1291/1521).
5. [P2] Collapsed sections stay in the Tab order (height:0 only, not inert).
6. [P2] Export failure copy points to the console (App.jsx:1165).
7. [P2] Default preset meets export with a mixed-ink warning; "0 inks" reads as broken.
8. [P2] Sheet setup split across Frame › Paper and Output › Export; "Format" label.
9. [P3] Bare 1–5 export keys; computing pill overlaps panel; "Show all 56 styles" stale.

Detector: CLI 1 finding (false positive, comment at Sidebar.jsx:968). Browser 20–39 per state; undersized text (9 px rail labels) partly valid; stripes, nested-cards, flat hierarchy, dark-glow are false positives.
