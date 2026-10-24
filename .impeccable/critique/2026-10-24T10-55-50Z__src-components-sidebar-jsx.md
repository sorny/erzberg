---
target: erzberg interface and navigation
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx"
target_fingerprint: "sha256:465eaa34c4fcbb5655599b05654cd93afe49f871f89546e5162909c636f0bdba"
target_path: /Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx
timestamp: 2026-10-24T10-55-50Z
slug: src-components-sidebar-jsx
---
# Critique: erzberg panel after the fixes (2026-10-24)

Method: dual-agent (A: design review · B: detector + browser). Score 29/40 (Good).

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | System status | 3 | Preset toast fires before the rebuild; a half-swapped frame shows |
| 2 | Real world | 3 | Panel words leak: pip, PNG α |
| 3 | User control | 3 | History menu ignores Escape; its backdrop blocks the next click |
| 4 | Consistency | 3 | Paper in two stages; `·` separators render flush |
| 5 | Error prevention | 3 | Good |
| 6 | Recognition | 2 | Find a control misses control labels (azimuth finds 1 of 6) |
| 7 | Flexibility | 3 | 124 Tab stops in Marks; no list of the marks that are on |
| 8 | Minimalist | 3 | Blurbs on every shut section |
| 9 | Error recovery | 3 | exportFailure copy good |
| 10 | Help | 3 | Family gloss only in a tooltip |

Priority issues:
1. [P1] Find a control indexes section terms, not control labels (sectionTerms.js, filter.js).
2. [P1] Preset toast before the swap renders; replaced marks not named (App.jsx notify, Sidebar.jsx preset tile).
3. [P2] Marks that are on are scattered across the 62-tile sheet (ModeSheet.jsx).
4. [P2] History menu and mark drill-in have no Escape; sheet has no roving tabindex (Sidebar.jsx HistoryMenu, ModeSheet.jsx).
5. [P2] Every export is named after the raster only.
6. [P3] export-extent button reads as caption text to a screen reader.

Detector: CLI 1 false positive (comment). Browser: undersized/tiny text (9–10 px rail, version, preset tile labels — real), low-contrast on dimmed off-mark controls (inert, so exempt) and preset tile labels on pale thumbnails (real), ore "occluder" summary at 2.6:1 (real); stripes, nested-cards, flat hierarchy false positives. React setState-during-render warning from Histogram → Sidebar seen once.
