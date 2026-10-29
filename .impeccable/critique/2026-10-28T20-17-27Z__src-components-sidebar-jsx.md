---
target: erzberg interface and navigation
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx"
target_fingerprint: "sha256:a0acf7597769e6fa6873497b7ec17159c4dfb939e5ed97161e5809a6cd91bc0e"
target_path: /Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx
timestamp: 2026-10-28T20-17-27Z
slug: src-components-sidebar-jsx
---
# Critique round 7: erzberg panel (2026-10-28)

Method: dual-agent (A: design review · B: detector + browser). Score 29/40 (Good).

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | System status | 3 | Tab-through logs a bare "Change" |
| 2 | Real world | 3 | Opaque family gloss on off marks |
| 3 | User control | 3 | Tabbing through value fields writes history, marks preset edited |
| 4 | Consistency | 2 | Four header state grammars; off mark asks three ways |
| 5 | Error prevention | 3 | Blur commit can snap a value |
| 6 | Recognition | 3 | 62 marks |
| 7 | Flexibility | 3 | Two Tab stops per slider |
| 8 | Minimalist | 3 | Line style repeats per mark |
| 9 | Error recovery | 3 | Good |
| 10 | Help | 3 | Contextual ? works |

Priority issues:
1. [P1] ValueField commits on blur without a change (ui.jsx).
2. [P2] Filter keeps a stale scroll position (Sidebar.jsx).
3. [P2] Section headers use four state grammars (ui.jsx Section).
4. [P2] Off mark asks one question three ways; Show too loud.
5. [P3] Opening style trips its own faint-ink warning.

Detector: CLI clean. Browser: 10–11 px text real (systemic scale); low-contrast on locked Almanac exempt; nested-cards and stripes false positives. No React errors.
