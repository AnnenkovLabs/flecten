# Built-In Tools

Canonical built-in definitions live in `src/tools/builtin.ts`. Models receive exact tool names, descriptions, and JSON Schemas from the active session registry: `task` dynamically lists available subagent roles, `skill` appears when skills are discovered, and external MCP tools register after workspace trust is granted.

## Catalog

| Tool | Arguments | Contract and limits |
|---|---|---|
| `memory` | `operation` plus operation-specific fields | Project memory (`topics`, `list`, `read`, `sources`, `save`, `forget`, `reconcile`): canonical `key`, CAS `expectedRevision`, verified quote evidence, and bounded auto-delivery. See below and [MEMORY.md](MEMORY.md). |
| `read` | `path`, `offset`, `characterOffset?`, `limit`, `focus?` | Reads UTF-8 text or images (`PNG`, `JPEG`, `WebP`, `GIF`, `AVIF` <= 10 MiB); 1-based line numbers, default 2,000 lines / 50,000 bytes, `limit` <= 10,000. Aligns slices to nearby symbol boundaries, lists remaining file symbols on truncation, and returns continuation `offset` plus UTF-8-safe `nextCursor` (`characterOffset`) on long lines. Delivers raw images to vision models or describes them via `vision` (`focus` asks a targeted question on non-vision models). Rejects directories and other binaries. |
| `write` | `path`, `content`, `why` | Creates a file (including parent directories) or overwrites an existing file; overwriting requires a current `read` in the session. |
| `edit` | `path`, `oldString`, `newString`, `replaceAll`, `edits`, `why` | Exact replacement or non-overlapping batch replacements against the original file, preserving line endings; requires a unique match unless `replaceAll: true`. |
| `apply_patch` | `patch`, `why` | `*** Begin Patch` / `*** End Patch` format supporting `Add`, `Update`, `Delete`, `Move`, and `@@` hunks; validated atomically before any disk write. |
| `delete` | `path`, `recursive`, `why` | Deletes a file or empty directory; non-empty directories require `recursive: true`. |
| `move` | `from`, `to`, `overwrite`, `why` | Moves/renames a regular file (directories and symlinks unsupported; existing destinations fail unless `overwrite: true`). |
| `todo` | `op`, `items`, `id`, `content`, `status`, `priority` | Session checklist (`list`, `set`, `add`, `update`, `remove`, `clear`) with statuses `pending`, `in_progress`, `completed`, `cancelled`; `set` replaces the list in one batch call and every call returns the full list. |
| `task` | `operation?: run / list / wait / stop`, `agent?`, `prompt?`, `context?`, `id?` | Spawns or manages isolated subagent sessions (`run` requires `agent` + `prompt`; `wait`/`stop` require `id`) sharing the worktree with a dedicated journal, budget, and 30-minute cap. Stopping the parent ends `wait` while child execution continues unless stopped via `stop`. |
| `grep` | `pattern`, `literal`, `path`, `glob`, `type`, `caseSensitive`, `multiline`, `context`, `hidden`, `count`, `filesWithMatches`, `maxResults` | Code-aware content search backed by `rg` with a bounded worker fallback; ranks symbol definitions and source files above call sites/tests/docs, auto-expands compact matching definitions, prepends enclosing signatures when `context > 0`, falls back to multi-term BM25 identifier search on zero exact regex hits (disabled when `literal: true`), and primes `ReadTracker` for direct `edit`. Default 200 matches, max 500, `context` <= 20 lines, respects `.gitignore`. |
| `glob` | `pattern`, `path`, `mode`, `hidden`, `includeGenerated`, `offset`, `maxResults` | `mode="entries"` lists immediate children non-recursively; `mode="files"` returns sorted paths (default 500, max 5,000; slash-free patterns match at any depth). Respects `.gitignore` and skips generated/service dirs unless `includeGenerated: true`; returns `total`, `nextOffset`, and completeness flag. |
| `ask` | `question`, `options`, `allowCustom` | Renders a structured question card and returns immediately without blocking or granting tool approvals; empty `options` requests free-form input. |
| `web_fetch` | `url` | Fetches public `http`/`https` URLs (10s timeout, 2 MiB cap) and extracts readable text from HTML without executing JavaScript. |
| `web_search` | `query` | Returns up to 8 DuckDuckGo results (`title`, `url`, `snippet`); verify claims by opening target pages with `web_fetch`. |
| `terminal` | `op`, `id`, `command`, `input`, `cwd`, `cols`, `rows`, `timeoutMs` | Persistent interactive PTY (`run`, `write`, `read`, `resize`, `kill`, `list`); waits up to 600s (timeout leaves process alive; non-zero exit on `run` reports an error). |
| `bash` | `command`, `cwd`, `timeoutMs`, `background`, `expectedOutputs` | Fresh shell per call (`cd` and env do not persist); default 120s timeout, max 600s. Foreground timeout kills the process tree; `background: true` returns a job ID. Foreground `expectedOutputs` verifies regular-file existence, min byte size, and optional SHA-256 separately from exit code `0`. |
| `jobs` | `op`, `id`, `lines`, `offset`, `timeoutMs` | Manages background `bash` jobs (`list`, `output`, `wait`, `stop`); tails 80 lines by default (max 2,000, character `offset`), `wait` up to 30 minutes without killing on timeout. |
| `done` | `summary`, `evidence`, optional `memoryCandidates` | Terminates the run explicitly with non-empty `evidence` and up to 3 piggybacked `memoryCandidates` (memory rejection is reported in tool output without aborting completion). |
| `skill` | `name`, `resource?` | Loads a trusted skill's full `SKILL.md` body and resource list on demand by catalog name, or reads one listed resource file via `resource`. |
| `tool_catalog` | `operation`, `names`, `offset`, `limit` | Lazy discovery for external MCP tools: `list` browses names and descriptions, and `activate` enables exact tool schemas starting on the next turn without altering execution permissions. |
| `module` | `operation` plus operation-specific fields | Session-scoped module gateway (`list`, `activate`, `deactivate`, `status`, `tools`, `call`, `read`) loading instructions, MCP/SDK tools, hooks, and surfaces without mutating provider tool definitions ([MODULES.md](MODULES.md)). |

`grep` defaults to regular-expression search with BM25 multi-term fallback on zero exact hits unless `literal: true` is passed, supports cross-line matching via `multiline: true`, and gives `filesWithMatches` precedence over line `count`. For `ask`, silence or elapsed time never implies user consent.

## Selection and Ordering

Use `glob` to locate paths, `grep` to search file contents, `read` to inspect files, and `edit` / `apply_patch` / `write` to modify them instead of running shell equivalents (`rg`, `grep`, `find`, `ls`, `cat`, `head`, `tail`, `sed`) through `bash` or `terminal`. Use `bash` for stateless builds, tests, git, and command execution, `terminal` only for stateful interactive PTYs, and `jobs` to monitor background `bash` runs.

Run independent reads in parallel, and chain dependent read -> edit -> verify steps sequentially. Obtaining a background job ID never proves command success: inspect terminal status and exit code first, and end runs explicitly via `done` rather than relying on prose cues.

## Agent Memory (`memory`)

`memory` runs inline during regular primary-model turns with no background observer, embeddings API, or extra save turn:

- `topics`: up to 12 active topics per page with `cursor` (untagged records appear under `Uncategorized`).
- `list`: up to 12 active non-expired records filtered by exact `topic`, `kind`, and NFKC case-folded substring `query` over `key`/`summary`/`cues`.
- `read`: 1-6 IDs returning bodies, evidence, and revisions (6,000-token batch cap with deferred IDs returned explicitly; already visible revisions return a short confirmation).
- `sources`: up to 12 eligible session user/tool sources (excluding summaries, notices, and `memory` outputs).
- `save`: creates (`expectedRevision: 0`) or updates a `key` with 1-4 verbatim quotes (8-1,200 chars; `preference` and `lesson` require user quotes), optional `cues`, `expiresAt`, up to 3 `topics`, and `appliesWhen`.
- `forget`: writes a logical tombstone at `expectedRevision`, removing active recall while keeping audit history.
- `reconcile`: commits up to 8 `save` and 8 `forget` operations atomically.
- `done.memoryCandidates`: commits up to 3 candidates alongside run completion.

Secrets are rejected before commit, corrupt memory files fail explicitly without wiping data, and permission checks map `topics`/`list`/`read`/`sources` to `read` and `save`/`forget`/`reconcile` to `write` on `.flecten/memory.json` ([MEMORY.md](MEMORY.md)).

## File Reading and Mutation

Overwriting with `write` and editing with `edit` fail if an existing file has not been read in the current session or if its content hash (tracked for files <= 20 MiB even on partial reads) changed on disk since the last read (`apply_patch`, `delete`, and `move` still expect prior inspection even without read-tracker enforcement).

`edit` preserves per-line `LF`/`CRLF` endings across unchanged and replaced lines, applying the region's dominant newline to inserted lines within bounded line-diff limits; missing, ambiguous, or overlapping batch spans fail cleanly before touching disk so the model can re-read and fix arguments. File tools record undo/redo checkpoints and `bash` snapshots into shadow Git; `why` documents out-of-workspace intent without expanding permissions.

## Argument Validation and Deterministic Repair

The registry resolves tool names (supporting explicit recovery aliases like `read_file` -> `read` while giving canonical names priority) and validates arguments against Zod schemas. On validation failure, up to three deterministic repair passes run before re-validating:

- recovering truncated JSON or wrapping bare primary string arguments;
- mapping known field aliases, stripping unknown keys, and unwrapping Markdown path backticks;
- dropping `null` on optional fields and `{}` where an optional array is expected;
- parsing stringified JSON arrays/objects or wrapping scalars into single-element arrays;
- coercing numeric strings and `"true"`/`"false"` only where flagged by schema type errors (`timeoutMs` is always interpreted in milliseconds regardless of magnitude).

Successful repairs attach `<repair_note>` and canonicalize the tool name; unrecoverable inputs return structured field errors without executing the tool.

## Permissions, Retries, and Cancellation

Permissions, OS sandboxing, hooks, and active skill `allowedTools` enforce at the loop boundary (child subagents intersect permissions with the parent and fail immediately on `ask`).

Automatic retries run only on structured transient failures (`ToolFailure`, transient network codes, or retryable HTTP status codes), never via error-message substring matching: read-only tools retry up to 3 attempts, mutating tools run once by default (up to 2 attempts with an explicit `idempotencyKey`), and permission, validation, timeout, or abort errors never auto-retry. Every call receives an `AbortSignal` and timeout; verify external state before re-running any timed-out mutating tool.

## Output Truncation, Provenance, and Logs

Internal `ToolResult` objects (`ok`, `output`, `error`, `fullOutputPath`, `durationMs`, `provenance`, `data`, notices, trailers) format into readable model messages truncated first by line count and then by byte budget (preserving head + tail generally, or requested start + continuation cursor for `read`). Full redacted outputs stream to `.flecten/sessions/<id>/logs/` (`bash` caps inline collection at 2 MiB while streaming full output to disk).

Outputs from `read`, `grep`, web tools, MCP, and `bash` are wrapped inside fenced `Untrusted data` sections with `Source`, `Source reference`, and `Trust` headers while keeping exit codes, durations, and log paths outside the untrusted fence. Having a `fullOutputPath` never implies the model has read the truncated portion.

## Skills and MCP

`skill` caches loaded `SKILL.md` bodies per file revision and enforces `allowedTools` dynamically. External MCP schemas activate lazily via `tool_catalog` (persisted via typed calls and `contextSummary.activeMcpTools` per chat), using normalized names `mcp_<server>_<tool>` (<= 64 chars, description <= 2,000 chars, input JSON Schema <= 24,000 chars) plus optional `read_resource` and `use_prompt` (outputs capped at 2,000,000 chars). Upstream `outputSchema` mismatches on completed `stdio` calls do not mark an already executed action as failed, whereas `isError` and transport errors propagate as failures.

## Scratch Directory and Remote SSH

`TMPDIR` and `FLECTEN_SCRATCH` point to `.flecten-scratch/<sessionId>/`, shared across foreground `bash`, background `jobs`, and `terminal` PTYs across app restarts (use `FLECTEN_SCRATCH` rather than sandbox `/tmp` when reading scratch files via file tools; scratch moves to trash with its session and is excluded from `glob`, `grep`, and checkpoints).

Remote SSH jobs preflight live `SSH_AUTH_SOCK` and verified per-host `known_hosts` entries (distinguishing `auth_unavailable`, `host_key_unavailable`, and `remote_environment_unavailable`), keeping private keys and `~/.ssh` unmounted and disabling remote agent forwarding.
