# Conventions

## Language and Runtime

- TypeScript in strict mode, ESM modules.
- Execution and testing via Bun.
- No `any` at module or external boundaries. Prefer `unknown` plus schema validation internally as well.

## Files and Naming

- TypeScript files use `kebab-case.ts`; Svelte components use `PascalCase.svelte`.
- Types and interfaces use `PascalCase`.
- Functions and variables use `camelCase`.
- One module, one role: `twin.ts` contains no agent loop; `context.ts` never calls a model.

## File Size

- Soft limit: 300 lines; hard limit: 500 lines.
- One file owns a single responsibility.
- Directories group domains; filenames name the concept.
- Re-exports are allowed for types only; runtime imports must point directly to the defining module.
- Importing from five distinct domains signals a leaky boundary.

## Boundary Validation

- Validate all inputs from models, files, and the web against schemas before use.
- Validate tool arguments prior to execution.
- Validate provider stream events at every step of the stream.
- Return validation failures as typed result values rather than throwing exceptions across boundaries.

## Error Handling

- Tool failures return `ToolResult` with `ok: false` and an actionable message.
- Programmer bugs throw exceptions.
- Model/provider failures emit typed events with a reason and retry only when safe.
- Never swallow errors silently.

## Async and Cancellation

- Every long-running operation accepts an `AbortSignal`.
- Cancellation propagates top-down: user -> orchestrator -> tool -> child OS process.
- Every tool enforces an explicit timeout.
- Background processes never outlive their session unless started with an explicit background flag.
- Subagents belong to the chat: stopping the parent run cancels awaiting them without killing their execution. A subagent terminates only on an explicit `stop` by ID, its child role budget/limit, or runtime shutdown.

## Logging

- Core never writes to `console`.
- Session events append to `events.jsonl`.
- Unabridged tool outputs live in `.flecten/sessions/<id>/logs/`.
- Redact secrets and tokens before any disk or IPC write.

## Testing

- Run via `bun test`.
- Include at least one smoke test per module.
- Maintain golden tests for assembled prompts and stream parsers.
- Do not mock core internals; test real services against local fixtures.
- Tests must fail when behavior breaks, not merely when imports break.

## Prompts

- Stored as Markdown files in `prompts/`.
- Contain zero user data.
- Versioned in git.
- Never embed multi-line prompts inline in TypeScript functions.

## Extensions

- Skills follow Agent Skills: `SKILL.md` with frontmatter, lenient discovery validation, and lazy body loading on activation.
- Keep the prompt's skill catalog compact; never inline full skill bodies or bundled resources up front.
- MCP tools take the `mcp_<server>_` prefix, validate through the SDK, and return untrusted data.
- MCP tool annotations confer zero trust: `readOnlyHint` never bypasses write blocks.
- Hooks execute strictly on declared events, read JSON on `stdin`, and never write to `console`.
- Hook exit code `2` blocks execution only on events permitted to block.
- Timeouts, cancellation (`AbortSignal`), and output size caps are mandatory for both hooks and MCP calls.

## Dependencies

- Every new dependency requires an entry in the decision log.
- Prefer Bun's standard library before adding third-party packages.
- Reject packages lacking Bun compatibility or TypeScript types.

## Comments

- Explain why, never what.
- Tag intentional simplifications that have known limits with `ponytail:`, stating both the limit and the upgrade path.
- Delete commented-out code rather than committing it.

## Git

- One logical change per commit.
- Imperative commit subjects: `add spec parsing`, `fix page boundary`.
- Never commit secrets or `.flecten/`.

## Documentation

- `ARCHITECTURE.md` documents system design and runtime invariants.
- Roadmap documents track planned work.
- `DECISIONS.md` records architectural decisions and trade-offs.
- `CONVENTIONS.md` defines engineering rules.

## UI Localization

English (`en`) is the default UI locale. Supported locales are `en`, `zh-Hans`, `pt-BR`, `es`, `ja`, `uk`, and `ru`. The selected locale persists in the window profile (`flecten.locale`) without altering the language of agent prompts or model responses.

UI strings resolve through `t()` in `ui/src/lib/i18n.svelte.ts`. Keys are plain English phrases; translations live under `ui/src/lib/i18n/messages/<locale>/`. Translate complete sentences and pass dynamic values as a positional array (numeric placeholders index the value array and are never parsed as prose). Never concatenate translated fragments. Format counts via `countLabel` and pass `i18n.locale` to `Intl` for dates and numbers.

Keep translations natural and idiomatic rather than word-for-word literal. Never translate user messages, model output, code, file paths, model IDs, or command output in the UI layer. Ship new UI keys across all seven locale catalogs simultaneously, and compute localized metadata labels on read so switching locales updates open screens immediately.
