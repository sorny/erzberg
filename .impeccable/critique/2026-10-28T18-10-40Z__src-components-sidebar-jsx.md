---
target: erzberg interface and navigation
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx"
target_fingerprint: "sha256:56ab0bb2d7eab683cf9cf55b6296eba8645b70a2920b202065e3c9a735865770"
target_path: /Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx
timestamp: 2026-10-28T18-10-40Z
slug: src-components-sidebar-jsx
---
# Critique round 3: erzberg panel (2026-10-28)

Method: dual-agent (A: design review · B: detector + browser). Score 28/40 (Good).

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | System status | 3 | Levels histogram empty box; "edited" after a self-cancelling change |
| 2 | Real world | 3 | Jet/Cyber/Halloween ramp names |
| 3 | User control | 3 | No origin row in history |
| 4 | Consistency | 2 | Fill off leaves its controls live; on/off said four ways; pen-name casing |
| 5 | Error prevention | 3 | Good |
| 6 | Recognition | 3 | Pens by hex only |
| 7 | Flexibility | 3 | Enter bugs undercut accelerators |
| 8 | Minimalist | 3 | Permanent pip hint; count stated thrice |
| 9 | Error recovery | 2 | Enter fails silently on locked hits |
| 10 | Help | 3 | Good |

Priority issues:
1. [P1] Filter Enter does nothing when the first hit is inside an off mark (inert).
2. [P1] Enter on a mark tile drops focus to body.
3. [P2] Fill off leaves its gradient controls live.
4. [P2] Locked labels ~2.4:1; light ore count text ~3.8:1.
5. [P3] Pen-name casing; permanent pip hint; ramp names.

Detector: CLI clean. Browser: undersized text (rail, readouts) real; low-contrast only inside inert off-controls; nested-cards false positive; skipped-heading while filtering (h1 → h3) real. No React errors.
