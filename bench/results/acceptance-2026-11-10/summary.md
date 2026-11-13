# Benchmark summary

Generated 2026-11-10T18:22:01.593Z. Commit c980ad7 (dirty worktree). Bun 1.4.2, linux-x64.

20/20 tasks passed, 0 failed (0 errors), 558 ms, 219,232 input / 8,826 output tokens, $0.0382 estimated.

| Group | Passed | Total | Duration | Tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| read | 3 | 3 | 13 ms | 46,163 | $0.0070 |
| edit | 2 | 2 | 15 ms | 30,968 | $0.0048 |
| grep | 2 | 2 | 21 ms | 20,427 | $0.0031 |
| glob | 2 | 2 | 16 ms | 20,396 | $0.0031 |
| bash | 3 | 3 | 159 ms | 35,749 | $0.0055 |
| apply_patch | 3 | 3 | 15 ms | 35,967 | $0.0056 |
| checkpoints | 2 | 2 | 34 ms | 25,787 | $0.0040 |
| compaction | 3 | 3 | 285 ms | 12,601 | $0.0051 |

Codex baseline: 2/9 scored task(s) passed, 11 unscored

Failures: none

Pricing source: default. Cost is an estimate from tokens times the configured price table.
