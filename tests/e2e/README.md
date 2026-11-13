# E2E

Visual snapshots live in `visual.spec.ts-snapshots/`. Playwright appends the platform
(`-linux`) to every file name. Tests cover 1480x940, 1180x640, reduced motion and empty states;
timestamps, live indicators, durations, cost and usage, paths and the greeting are masked.

Regenerate after an intended UI change (the built `ui/dist` and `dist` must be current):

```bash
bunx playwright test tests/e2e/visual.spec.ts --update-snapshots
```

Review the changed PNGs before committing. Do not update snapshots to silence an unrelated failure.
