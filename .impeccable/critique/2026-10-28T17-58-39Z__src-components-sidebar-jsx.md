---
target: erzberg interface and navigation
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx"
target_fingerprint: "sha256:f1bf86304a854020ebbc75818845ea51e33a15921ae96180f9f57404af1abdf1"
target_path: /Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx
timestamp: 2026-10-28T17-58-39Z
slug: src-components-sidebar-jsx
---
# Critique round 2: erzberg panel (2026-10-28)

Method: dual-agent (A: design review · B: detector + browser). Score 30/40 (Good).

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | System status | 3 | Filter hit does not mark the control |
| 2 | Real world | 3 | "pip" internal word |
| 3 | User control | 4 | Good |
| 4 | Consistency | 2 | Shut sections: switch, dash or blurb; primary fill overloaded |
| 5 | Error prevention | 3 | Good |
| 6 | Recognition | 3 | On strip helps |
| 7 | Flexibility | 3 | Enter in filter does nothing |
| 8 | Minimalist | 3 | Permanent hint paragraph |
| 9 | Error recovery | 3 | Filter miss is a dead end |
| 10 | Help | 3 | Good |

Priority issues:
1. [P1] Filter finds the section, not the control; Enter does nothing (ui.jsx Section, Sidebar.jsx panel-filter).
2. [P1] Shut sections use three treatments (ui.jsx Section header).
3. [P2] Filter miss is a dead end (Sidebar.jsx "No section matches").
4. [P2] Off mark: two on-switches, inert controls look only dim.
5. [P3] Primary fill overloaded (selected segment).

Detector: CLI clean. Browser: undersized rail and readout text real; nested-cards and stripes false positives. React error: setState in render from theme toggle (Sidebar.jsx applyTheme inside updater → Histogram).
