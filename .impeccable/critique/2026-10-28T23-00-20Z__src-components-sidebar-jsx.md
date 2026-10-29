---
target: erzberg interface and navigation
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx"
target_fingerprint: "sha256:844d6dbaadf9cd698353dc1d88aa93ae6e86a422342a29c246efc665fc766b39"
target_path: /Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx
timestamp: 2026-10-28T23-00-20Z
slug: src-components-sidebar-jsx
---
# Critique round 9: erzberg panel (2026-10-29)

Method: dual-agent (A: design review · B: detector + browser). Score 30/40 (Good).

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | System status | 3 | Surface badge ignores Terrain Style |
| 2 | Real world | 3 | Readout boxed like an input |
| 3 | User control | 3 | History button disabled without reason |
| 4 | Consistency | 2 | Four state signals per section; three names for Marks |
| 5 | Error prevention | 3 | Good |
| 6 | Recognition | 3 | Surface: 14 look-alike rows |
| 7 | Flexibility | 4 | Full keyboard model, one stop per slider |
| 8 | Minimalist | 3 | Surface wall; filter count wraps |
| 9 | Error recovery | 3 | Miss leaves pane blank |
| 10 | Help | 3 | ? on a control without help opens the card |

Priority issues:
1. [P1] Each section shows its state differently (ui.jsx Section, sectionSummary.js, history labels).
2. [P2] Off sections outside Marks give no idea of what they do.
3. [P2] One collection, three names (Marks / Draw Modes / draw modes).
4. [P2] Surface is an ungrouped wall of 14 switch rows.
5. [P3] Filter miss and count copy.

Detector: CLI clean. Browser: 10–11 px text (systemic scale); low-contrast only inside inert block; nested-cards and stripes false positives. No React errors.
