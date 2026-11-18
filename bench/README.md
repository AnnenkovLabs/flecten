# Bench

Real DeepSWE evaluations with private mutations and the production sidecar run through the [Pier adapter](deepswe/README.md). The local mock runner below verifies harness mechanics.

`tasks/` holds 20 tasks, one per file. Task schema, checks, metrics, and baseline methodology are documented in internal notes.

## Running

```bash
bun scripts/bench.ts
bun scripts/bench.ts --filter read-config,edit-version
bun test tests/unit/bench.test.ts
```

By default, the mock provider runs locally without network access. Output is written to `results/<timestamp>/` as `report.json` and `summary.md`.

## Baseline

Codex runs only when explicitly enabled:

```bash
BENCH_CODEX_CLI=1 bun scripts/bench.ts
```

When the flag or binary is absent, the baseline is marked `skipped` with an explicit reason rather than fabricated numbers.

## Rules

- Each task exercises one harness scenario.
- Fixtures and scripted mock-provider turns live inside the task JSON.
- Checks are deterministic, offline, and time-independent.
- Baseline failures are never masked: unavailable checks are marked `unscored`.
