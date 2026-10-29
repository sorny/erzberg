---
target: erzberg interface and navigation
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx"
target_fingerprint: "sha256:43030809ba81ea5b1f9d9b7b5a3e9737ba21168e9e58abe9a22ebd7ec9d43ce8"
target_path: /Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx
timestamp: 2026-10-28T19-48-53Z
slug: src-components-sidebar-jsx
---
# Critique round 6: erzberg panel (2026-10-28)

Method: dual-agent (A: design review · B: detector + browser). Score 28/40 (Good).

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | System status | 3 | Viewport hint never dismisses itself |
| 2 | Real world | 3 | Developer prose (CORS, node command) in Terrain |
| 3 | User control | 3 | History has no origin anchor |
| 4 | Consistency | 2 | Off section: switch + Turn on button + Show; Inks as picked twice |
| 5 | Error prevention | 3 | Good |
| 6 | Recognition | 3 | Good |
| 7 | Flexibility | 3 | Filter misses two-word labels; two Tab stops per slider |
| 8 | Minimalist | 2 | Heavy copy; on-count four times |
| 9 | Error recovery | 3 | Suggestions score first word only |
| 10 | Help | 3 | ? on control opens help |

Priority issues:
1. [P1] Filter cannot find multi-word labels (filter.js sectionMatches).
2. [P2] Off sections offer three controls for one decision (ui.jsx off-note).
3. [P2] Same on-count four times; permanent hint (ModeSheet.jsx).
4. [P2] Infrastructure prose in Terrain (Land Cover, Masks, Extent).
5. [P3] Tab cost per slider; Enter hint wording.

Detector: CLI clean. Browser: undersized/tiny text real (rail 9 px, readouts 10 px); flat type scale real; nested-cards, stripes, low-contrast (inert) false positives. No React errors.
