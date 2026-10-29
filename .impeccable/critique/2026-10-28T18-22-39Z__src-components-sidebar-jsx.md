---
target: erzberg interface and navigation
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx"
target_fingerprint: "sha256:662a6c14c984b4d6528430efb79e70c41da2b7db52351fd1d862979aee52472a"
target_path: /Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx
timestamp: 2026-10-28T18-22-39Z
slug: src-components-sidebar-jsx
---
# Critique round 4: erzberg panel (2026-10-28)

Method: dual-agent (A: design review · B: detector + browser). Score 29/40 (Good).

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | System status | 3 | Levels histogram empty box; rail badge means two things |
| 2 | Real world | 3 | Ramp names |
| 3 | User control | 3 | No origin row in history |
| 4 | Consistency | 2 | On/off five ways; ramp editor live with Fill off |
| 5 | Error prevention | 3 | Good |
| 6 | Recognition | 3 | Pens by hex only |
| 7 | Flexibility | 3 | Filter finds controls, not actions |
| 8 | Minimalist | 3 | Count repeated; two off notes stacked |
| 9 | Error recovery | 3 | Suggestion ranking; empty pane on miss |
| 10 | Help | 3 | Good |

Priority issues:
1. [P1] Sheet hint unmounts on first toggle; grid jumps 55 px under the pointer (ModeSheet.jsx).
2. [P2] Ramp editor live while Fill is off (Sidebar.jsx Terrain Style).
3. [P2] suggestTerms ranks "colour" above "contour" for "contur"; plurals take slots (filter.js).
4. [P2] Tile on/off state silent to screen readers (ModeSheet.jsx).
5. [P3] Pens identified by hex only (PenStrip.jsx).

Detector: CLI clean. Browser: undersized text real; locked low-contrast exempt (inert); fold label dimmed contrary to intent; nested-cards and stripes false positives; skipped-heading while filtering. No React errors.
