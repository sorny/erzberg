---
target: erzberg interface and navigation
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx"
target_fingerprint: "sha256:99205d013f0c10b6deb2c6768bb5b8debda9ba882249c37849dd1732224b1c65"
target_path: /Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx
timestamp: 2026-10-28T20-26-56Z
slug: src-components-sidebar-jsx
---
# Critique round 8: erzberg panel (2026-10-28)

Method: dual-agent (A: design review · B: detector + browser). Score 30/40 (Good).

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | System status | 3 | Locked filter hits look nearly live |
| 2 | Real world | 3 | Cryptic family gloss |
| 3 | User control | 4 | Undo, history, Esc, Clear |
| 4 | Consistency | 2 | Off shown as text or switch; four on-paths; two locked wordings |
| 5 | Error prevention | 3 | Good |
| 6 | Recognition | 3 | Good |
| 7 | Flexibility | 3 | No focus ring on switches; two Tab stops per slider |
| 8 | Minimalist | 3 | Some redundancy |
| 9 | Error recovery | 3 | Faint-ink warning has no action |
| 10 | Help | 3 | Contextual ? |

Priority issues:
1. [P1] Switches show no focus ring (inline box-shadow overrides the rule); slider focus faint (ui.jsx).
2. [P1] Opening preset trips the faint-ink warning, which offers no action (PenStrip.jsx).
3. [P2] Filter returns sections, not controls; weak hit mark.
4. [P2] Inconsistent state vocabulary.
5. [P3] Two Tab stops per slider.

Detector: CLI clean. Browser: 10–11 px text (systemic scale); low-contrast only inside inert block; nested-cards and stripes false positives. No React errors.
