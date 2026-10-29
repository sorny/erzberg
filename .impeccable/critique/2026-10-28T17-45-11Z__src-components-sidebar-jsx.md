---
target: erzberg interface and navigation
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx"
target_fingerprint: "sha256:13debdb047ab310cb20e4032ff42ab34b601439c2507c9172c94cf66cce538a3"
target_path: /Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx
timestamp: 2026-10-28T17-45-11Z
slug: src-components-sidebar-jsx
---
# Critique: erzberg panel (2026-10-28)

Method: dual-agent (A: design review · B: detector + browser). Score 30/40 (Good).

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | System status | 3 | Sheet does not show which marks are on |
| 2 | Real world | 3 | Jet/Cyber/Halloween ramp names |
| 3 | User control | 4 | Undo, history, Escape everywhere |
| 4 | Consistency | 3 | Picked preset = focus ring; export-extent reads as caption |
| 5 | Error prevention | 3 | Good |
| 6 | Recognition | 2 | Recall which of 62 tiles are on; ? card lacks sheet keys |
| 7 | Flexibility | 3 | 66 Tab stops in Presets; substring filter noise |
| 8 | Minimalist | 3 | Marks pane 1,749 px |
| 9 | Error recovery | 3 | Good |
| 10 | Help | 3 | 9 px help glyphs |

Priority issues:
1. [P1] Marks that are on scattered across the sheet (ModeSheet.jsx). Fix: On strip, on/total counts.
2. [P1] Exports named after the raster only (App.jsx exportBaseName). Fix: add preset slug, show name under SVG.
3. [P2] Presets grid is 66 Tab stops (Sidebar.jsx preset grid). Fix: roving tabindex.
4. [P2] Picked preset indistinguishable from focus, no aria-pressed; export-extent caption styling.
5. [P3] Filter matches inside words (filter.js); ? card lacks Marks keys.

Detector: CLI clean. Browser: undersized/tiny text (rail, version, fold summaries, status line) real; flat type scale real; nested-cards (pip) and stripes (stage ruler) false positives; low-contrast only on disabled controls.
