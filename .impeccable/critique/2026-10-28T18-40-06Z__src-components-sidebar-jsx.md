---
target: erzberg interface and navigation
total_score: 32
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx"
target_fingerprint: "sha256:43030809ba81ea5b1f9d9b7b5a3e9737ba21168e9e58abe9a22ebd7ec9d43ce8"
target_path: /Users/geraldreisinger/git/private/erzberg/src/components/Sidebar.jsx
timestamp: 2026-10-28T18-40-06Z
slug: src-components-sidebar-jsx
---
# Critique round 5: erzberg panel (2026-10-28)

Method: dual-agent (A: design review · B: detector + browser). Score 32/40 (Good).

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | System status | 3 | Opening preset lands ~6 s after first paint; heavy rebuilds show no cue |
| 2 | Real world | 4 | Survey vocabulary with plain help |
| 3 | User control | 3 | History entries carry no detail |
| 4 | Consistency | 2 | Rail badge means "on" and "hits"; locked patterns differ between marks and other sections |
| 5 | Error prevention | 3 | No warning for a near-paper ink |
| 6 | Recognition | 3 | 62 marks need a name or family |
| 7 | Flexibility | 4 | Full keyboard model |
| 8 | Minimalist | 3 | Off marks show full dimmed control set |
| 9 | Error recovery | 3 | Some suggestions are noise |
| 10 | Help | 4 | Complete |

Priority issues:
1. [P1] First paint changes when the opening preset lands; long rebuilds show no status.
2. [P2] Off-state sections noisy and inconsistent.
3. [P2] Rail badge carries two meanings.
4. [P2] Slider rows cost about 3 Tab stops.
5. [P3] 62-tile wall; family count formats differ.

Detector: CLI clean. Browser: undersized rail and readout text real; locked low-contrast exempt (inert); nested-cards and stripes false positives; skipped-heading while filtering (fixed after the scan). No React errors.
