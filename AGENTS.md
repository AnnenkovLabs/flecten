# AGENTS

## Before You Start

Read `docs/ARCHITECTURE.md`, `docs/STRUCTURE.md`, `docs/CONVENTIONS.md`, and `design.md`.

## Commands

```bash
bun test
bun run check
bun run lint
bun run build:ui
bun run build:agent
bun run app:dev
```

A change is not done until all relevant checks pass. UI changes additionally require `bun run build:ui` and visual inspection at 1480x940 and 1180x640.

## Verification

- Do not loop on tests. Run the relevant check once per completed change, then stop.
- Do not re-run the full E2E suite, `bun run verify`, or already-passing tests after every minor edit.
- Re-run a check only after an actual change in the tested path, or to diagnose a new failure.
- Once a check is green on the current code, do not run it again for reassurance.
- E2E runs stay off-screen: the fixture sets `FLECTEN_HEADLESS=1`, and the window is created hidden and immediately minimized.

## Rules

- One file, one responsibility. Soft limit: 300 lines; hard limit: 500 lines.
- Never drive behavior with regexes, string patterns, or heuristics. Regexes are allowed only for format validation at boundaries, such as filenames. Continuation, completion, retries, intent, tool selection, and UX behavior must be driven by state, schemas, typed events, or explicit APIs.
- Dead code is forbidden. Every module must be wired into a real production path and covered by a test exercising that path, or deleted. Never keep scaffolding tested in isolation from production.
- Model context is standardized. Everything sent to the model must match standard training formats: plain Markdown, standard tool calls, full field names, and predictable headings. No custom shorthand or ad-hoc encodings.
- Never expose raw JSON in primary settings. Raw JSON belongs in a hidden advanced mode.
- `core` never imports `ui`, `shell`, or `store`.
- Any new dependency requires an entry in the decision log.
- Validate all data from models, files, and the web against a schema at the boundary.
- Core never writes to `console`. Emit events through the event bus.
- Keep prompts in `prompts/`, never inline in code.
- Store raw user messages verbatim.
- Redact secrets before writing logs.
- Never use em dashes (`U+2014`) in documentation or UI copy.
- Mark deliberate simplifications that have known limits with `ponytail:` and note the upgrade path.
- UI uses Svelte 5 and Vite: components in `ui/src/components`, state and pure functions in `ui/src/lib`, tokens in `ui/src/app.css`.
- Screen data comes from `run.svelte.ts` and props. Components never import core.
- `ui` never imports `core`, `store`, or `tools`. `shell` contains no harness logic.

## What Not to Do

- Do not add an ORM.
- Do not add an agent framework.
- Do not call models from the UI.
- Do not read files from the UI.
- Do not mix responsibilities in a single file for speed.
- Do not add a second token set, font, or decorative effect.
- Do not call core directly from a component.
