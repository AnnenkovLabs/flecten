# Architecture

## 1. Overview

Flecten keeps three questions strictly separate: what the user wants, what the worker executes, and what the model sees. User persona (Twin), Jev, project memory, and context pages operate as services around those three boundaries rather than standalone bolt-on features.

Goal: higher engineering quality at lower token cost - achieved through context discipline, verified memory, and deterministic gates rather than prompt magic.

Contracts governing streams, working context, persisted outcomes, shared chat budgets, and remote jobs following the Physicss audit live in [EXECUTION-CONTRACTS.md](EXECUTION-CONTRACTS.md).

## 2. Non-Goals

- Does not replace the underlying model; providers attach via protocol adapters.
- Makes no recursive self-improvement claims.
- Is not a general-purpose agent framework.
- Never stuffs full session history into a single context window.
- Never mixes core runtime logic with the UI or window shell.

## 2a. Current Baseline

Storage migration executes before acquiring the project lock, loading config, initializing modules, or recovering sessions. `StorageBootstrap` enumerates the active folder, desktop profile, and accessible saved workspaces. Pre-existing `.liquid` data triggers a mandatory blocking migration screen, while fresh storage initializes directly. Runtime startup proceeds only after migration verification and a separate durable acceptance record. Migration state and untouched originals live in `.flecten-migration/v1/`, which is hidden from models and excluded from the IDE, search, and checkpoints. Wire details and failure bounds live in [PROTOCOL.md](PROTOCOL.md).

A confirmed event write guarantees `fsync` on `events.jsonl` prior to index publication. Atomic updates to config and message queues `fsync` the temporary file before `rename` and `fsync` the parent directory afterward. IO failures propagate directly to callers rather than masquerading as successful saves. These guarantees rely on OS filesystem and drive contracts; physical media loss and filesystems lacking directory `fsync` remain outside scope.

Implemented subsystems:

- **Twin.** Dedicated user persona and background delegate sitting between Talker and Worker: provides pre-run direction, answers subjective taste questions, reviews stage outputs, and requests up to four revision passes before final reporting. Learning from user frustration, approval, and delight applies editable persona traits without polluting project memory. See [TWIN.md](TWIN.md).
- **Term Dictionary.** Public JSON term categories in `src/dictionary/data/` sync from `AnnenkovLabs/flecten` into a verified offline cache, while project-local definitions in memory take precedence. Matching terms inject bounded Markdown reference definitions alongside the turn while preserving the raw user prompt verbatim. See [DICTIONARY.md](DICTIONARY.md).
- **Talker and Worker.** Default dual-session architecture with independent per-role models: Talker owns user conversation, skills, and HTML summaries; Worker receives a structured task brief with completion criteria and returns a Markdown summary. Runtime provenance checks distinguish tool-backed evidence from unverified model claims, and unresolved checklist items block final completion. Delegations and reviews share one durable journal while steering, continuation, and stop commands route to the active target session. Role, subagent, and vision models are configured in **Models**. See [TALKER-WORKER.md](TALKER-WORKER.md).
- **Agent Language.** A dedicated translation model translates user prompts and system context into English for execution and translates responses and summaries back into the user's language. Model-facing history and localized display text stay separate in the event log; code blocks and external tool outputs pass through untouched. Translation streams in chunks with a bounded cache, cancellation support, and separate cost accounting.
- **Module Marketplace.** Settings browse and install packages from configured HTTPS catalog feeds. The compiled-in catalog (`src/marketplace/index.json`) is intentionally empty so removed remote listings never resurrect from binary defaults; legacy sample modules remain solely under `tests/fixtures/modules/`. Before installation, the sidecar verifies schemas, SHA-256 digests, and dependency graphs, keeping code trust and UI surface activation as explicit lifecycle steps. Catalogs never inject prompt context or invoke models. See [MODULE-MARKETPLACE.md](MODULE-MARKETPLACE.md).
- **Platform Modules.** Trusted `platform.entry` bundles provide, wrap, or replace typed runtime services across the agent driver, primary model streams, guarded tool execution, compaction, and session storage/indexing. Custom services validate contracts via Zod schemas. Session-scoped modules activate within a single chat; project-scoped modules boot after workspace trust and prior to session replay. Atomic generation swaps and active leases keep superseded service graphs alive until in-flight promises and streams settle, while the UI surfaces native privileges and active overrides. There is no separate Host/Client split package system. See [MODULES.md](MODULES.md).
- **Providers.** Four wire protocols: OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and Gemini. Each provider entry in `flecten.config.json` declares its protocol, `baseUrl`, `headers`, `proxy`, `transportTimeoutMs`, and credential source (`apiKeyEnv`, `apiKey`, or `auth.command`), allowing compatible gateways to be added with zero code changes. Adding a model fetches API and catalog capabilities via `model.metadata` (leaving unknown limits blank); manual card refreshes mutate only the unsaved settings draft.

  In each provider's **Advanced** tab, `modelAutoRefresh.enabled` schedules hourly metadata syncs while the app is open. `overwriteManual` defaults to `false`: `modelMetadataBaseline` tracks prior automated field values so user-edited fields stay intact even if the upstream API temporarily matches them; enabling `overwriteManual` refreshes manual fields too. Custom headers, variants, and hidden-model flags always survive syncs. Background refresh never runs test completions or deletes a missing active model, and legacy entries without a baseline keep existing values while backfilling missing fields. Saving a settings draft opened before a background sync merges model edits cleanly via `shared/model-draft.ts` against schema-validated `settings.save.baseline`.
- **Execution Loop.** Streams model output, assembles tool calls, runs read-safe tools in parallel while serializing file mutations behind a shared mutex, returns results, and loops until `done` or stream end. Handles automatic continuation after `max_tokens`, empty turns, or mid-thought cutoffs. `RetryPolicy` and stream recovery retry transient failures on the active model; `src/providers/failover.ts` wraps providers with error classification, fallback plans, and a circuit breaker to route exhausted requests to configured backup models.
- **Settings.** General settings cover messaging and task behavior, with Terminal and History in dedicated tabs and no manual turn-cap sliders in the UI. Config schema v3 removes artificial turn ceilings (`maxTurns: 0`) and derives output token caps automatically (`maxOutputTokens: 0`), while `context.reserve` guarantees headroom for the response after accounting for the system prompt, history, attachments, and active tool schemas. `ui.sendShortcut` and `ui.followUpBehavior` flow through runtime `status` to the composer.
- **Tools.** 18 built-in tools (`memory`, `read`, `write`, `edit`, `apply_patch`, `delete`, `move`, `todo`, `task`, `grep`, `glob`, `ask`, `web_fetch`, `web_search`, `terminal`, `bash`, `jobs`, `done`) plus `skill` and MCP tools. Enforces content-hash read-before-edit, atomic writes, bounded inline output, and full disk logs under `.flecten/sessions/<id>/logs/`. Outputs from `read`, `grep`, web tools, and MCP arrive inside fenced Markdown `Untrusted data` blocks tagged with provenance, keeping exit codes and timing metadata separate from payload text.
- **Argument Repair.** Runs schema validation first, then applies deterministic coercions for field aliases, `null` values, stringified JSON, single-element arrays, numeric strings, Markdown-wrapped paths, and truncated JSON - returning structured repair notices or actionable schema errors to the model.
- **Sessions and History.** The Bun sidecar reads JSONL commands from `stdin` and emits sequenced envelopes (`seq`, `ts`, `schemaVersion`, `sessionId`) to `stdout` and `events.jsonl`. `DurableEventLog` serializes writes through a single queue, tolerant readers skip corrupted tail lines, `replayMessages` rebuilds model context per `sessionId`, and `sessions.list` / `sessions.get` serve history to the UI. Exhaustive coverage in `src/store/events/envelope.ts` (`Record<EventType, true>`) fails `tsc` if a new core event omits persistence rules, backed by `stored-events` round-trip tests covering context meters, budgets, approvals, background jobs, interrupted runs, and failover badges.
- **Dialogue Branches.** Clicking edit on a user message loads it into the main composer with a dedicated edit frame while keeping model selection, reasoning, file/screenshot attachments, and voice input available. Existing attachments render as removable chips, and any unsent new-message draft stays isolated and restores on cancel. Submitting appends a new branch (`history.edited`, `history.selected`) in the same chat while keeping prior turns and branches switchable via `src/store/events/branches.ts`, recreating Talker/Worker handles and scoping page archives to the selected branch. Active runs and non-empty queues block history mutation.
- **Concurrent Sessions.** `SessionPool` (`src/app/session-pool.ts`) runs up to `sessions.maxConcurrent` tasks in parallel (default `4`), each with isolated queues, approvals, background jobs, and budgets. Commands omitting `sessionId` target the focused chat; approval replies route by request `id`. `src/app/event-journal.ts` assigns monotonic `seq` cursors and buffers active-run events in memory so a reloaded renderer stitches `events.jsonl`, `events.replay`, and live deltas without gaps.

  Model selection belongs to each chat: `session-models.ts` persists `model.selected` (provider, model, reasoning, variant) and reconstructs matching transport, context window, and modality capabilities (falling back to the last primary run's model on legacy chats, or global config defaults on brand-new chats). `ui/src/lib/run/model.ts` serializes per-chat changes so late responses from background chats never overwrite the active view.
- **Crash Recovery and Draft Persistence.** Queued messages persist atomically in per-session `queue.json` with idempotent message IDs. On sidecar restart, `recovery.ts` detects unfinished runs from `events.jsonl`, resumes them from durable history, and notifies the renderer via `sessions.interrupted`; Electron supervises sidecar restarts with `1`, `2`, `4`, `8`, and `15 s` backoff.

  Unsent composer drafts persist in the Chromium profile keyed by canonical `cwd` and chat ID (including new chats and `projectless` mode), storing raw text, structured `@` mentions, and attachment metadata without heavy preview blobs. Modified drafts flush `200 ms` after the first edit in a burst (without sliding the timer on continuous typing) and flush immediately on chat/project switch, blur, hide, or window close; sending or clearing deletes the draft immediately. Startup reopens the last active chat (prioritizing chats with active runs). Chromium profile storage validates schemas on read and surfaces write errors while retaining in-memory edits, though it cannot guarantee OS-level `fsync` across sudden power loss within the `200 ms` window.
- **Single Sidecar per Workspace, Single Window per Profile.** The sidecar acquires `.flecten/sidecar.lock` (`src/app/project-lock.ts`) atomically via hard link, waiting up to `5 s` on a live PID, reclaiming stale locks from dead processes immediately, and reporting `project_locked` without restart loops if contended. Electron holds a single-instance profile lock so subsequent launches focus the existing window, restoring monitor-validated window bounds via `shell/window-state.mjs`.
- **Chat and Run Budgets.** `RunBudget` (`src/core/session/budget.ts`) accumulates primary and auxiliary model usage in a durable per-chat ledger across continuations and restarts while tracking wall-clock limits per run. Missing provider usage receipts mark total cost as incomplete; crossing a configured ceiling halts the next request with an explicit budget error.
- **Destination-Bound Credentials.** OS keychain entries partition by canonical workspace path and bind each credential envelope to `protocol`, `baseUrl`, and `proxy`. Keys never cross workspaces or endpoints silently, legacy unbound keys prompt for re-entry, and the renderer receives redacted metadata only.
- **On-Demand External Schemas.** External MCP tools stay out of active model specs until explicitly enabled via `tool_catalog` (`list` / `activate`), after which calls traverse standard `prepare`/`run` validation, permissions, and logging. Active selections survive compaction and model switches via successful call history and typed `contextSummary.activeMcpTools`, giving each run an isolated registry view.
- **System Prompt Assembly.** Assembles `prompts/`, `AGENTS.md`, skill catalog, MCP summary, and active tool schemas within `promptBudget` (default `24,000` tokens, counted with the active model's tokenizer). Tool JSON Schemas pass natively via provider tool parameters without prose duplication in the system prompt; child roles share project instructions but return strict JSON Schema outputs without HTML summaries. `session.started` logs `prompt.version`, `prompt.base`, and `prompt.hash`. See [PROMPTS.md](PROMPTS.md).
- **Context Compaction.** Worker closes each coherent subtask via `context complete`, immediately archiving the transcript and replacing it with a compact summary before the next model turn regardless of window fill. Talker compacts on window threshold. When tokens approach `context.window - context.reserve`, emergency pruning trims old tool outputs first and then invokes `PageWriter` under a strict JSON Schema with a deterministic canonical fallback. Three consecutive compaction failures trip a circuit breaker and emit `context.compacted`. Typed `ContextSummary` records carry outcomes, the original request, and the latest user instruction across replay without parsing Markdown.
- **Permissions and Approvals.** Every schema-validated immutable tool call passes hooks, resource extraction, sandbox checks, and `PermissionEngine` before running. `shared/access-mode.ts` coordinates permissions and OS sandboxing across `agent` (normal workspace work), `confirm` (prompts before writes, shell, and MCP), and `full` (disables sandbox), defaulting new profiles to `agent` while preserving explicit legacy rules. Explicit `deny` rules and mandatory human checkpoints override all modes and grants. Out-of-workspace paths trigger a dedicated `external_path` prompt (once, chat-wide, or saved project `pathPrefix`) shared across logical sandbox checks, OS writable roots, Worker, and subagents; other grants bind via SHA-256 over exact tool, args, `cwd`, and target resources. Advanced `auto` mode permits bounded safe calls, delegates ambiguous opaque calls to a reviewer model, and escalates uncertainty to the user. `ApprovalWaiters` manages deadlines, cancellation, routing, a 100-receipt reconnect cache, and live policy re-evaluation (`allow_once` / `deny` with `by: policy`) whenever rules or covering grants change. Access modes and sandbox controls live together in **Access**. See [SECURITY.md](SECURITY.md).
- **File Checkpoints.** Content-addressed store in `.flecten/checkpoints` records pre- and post-images before `write`, `edit`, `apply_patch`, `delete`, and `move`, powering Git-independent `/undo` and `/redo`.
- **Shell Rollback.** `bash` and `terminal` snapshot working-tree state in `.flecten/shadow`. Initial indexing is capped at `5 s`, `50,000` paths, `256 MiB` total file bytes, and `16 MiB` path-list size (checked prior to hashing; existing shadows above `1 GiB` stay intact without rebuilding). Exceeding caps disables automatic shell snapshots with a clear notice rather than faking partial rollbacks. Per-command snapshots budget `5 s` (`1.5 s` pre, `1.5 s` post, `2 s` save), recording diffs above `2,000` files or `128 MiB` as explicit gaps while protecting settings and secrets during `/undo`.
- **Persistent PTY.** One persistent `Bun.Terminal` session per chat supporting `run`, `write`, `read`, `resize`, `kill`, and `list`, with env allowlists, scrollback caps, ANSI handling, timeouts, structured exit reports, process-tree termination on stop, and live `terminal` config reload.
- **Background Jobs.** `bash` with `background: true` and the `jobs` tool (`list`, `read`, `wait`, `stop`) track job IDs, status, logs, and elapsed time, routing completion events strictly to the owning chat and exposing per-card `tool.cancel` process-tree termination.
- **Resource Monitoring.** Tracks memory, child processes, and listening ports via `procfs` on Linux (catching `setsid` orphans), `ps`/`lsof` on macOS, and async schema-validated CIM snapshots on Windows. Platform-specific bounds are documented in [SECURITY.md](SECURITY.md).
- **Queue and Steering.** Persists `queue` and `steer` follow-ups on disk across restarts: `steer` injects at the next safe turn boundary, while `queue` starts after `done` or run completion.
- **Two-Stage Stop.** Active runs swap Send for `Stop` (alongside `Queue` and `Steer` when a draft is present). First click sends `mode: graceful` (`SessionState.stopRequested`), letting the in-flight stream and already-spawned commands finish while cancelling pending tool calls and halting queued turns; clicking red `Force stop` sends `mode: force` to abort the shared `AbortSignal` immediately.
- **Voice Dictation.** Records up to `90 s` via `MediaRecorder`: cloud API mode posts multipart audio to `/audio/transcriptions`, while offline `faster-whisper` and `Vosk` convert audio to `16 kHz` mono PCM16 WAV via Web Audio and stream it over `stdin` to a bundled Python worker (`Escape` kills the worker tree; zero network calls or cloud fallback in local mode). See [VOICE.md](VOICE.md).
- **Vision.** Pasting an image inserts an atomic `Image 1` token backed by session media artifacts. Vision-capable models receive native image content parts; text-only models route through `src/app/vision.ts` using either the lowest-cost vision model on the active provider (requiring explicit selection if pricing is unknown) or configured `vision.provider` / `vision.model`, supporting `focus` prompts on `read`, per-session content caching, and helper-rate billing.
- **Attachments.** Accepts `png`, `jpeg`, `webp`, `gif`, `avif`, and `pdf` (up to `5` files at `10 MB` each), encoding base64 content parts and gating `pdf` on model modality support. `WAV`/`MP3` audio routes to OpenAI Chat and supported audio containers route to Gemini, while unsupported protocols fail explicitly; token budgets account for image dimensions, conservative PDF reserves, and `WAV`/`MP3`/`FLAC` duration.
- **Sandboxed HTML Summaries.** Renders Markdown via `marked` + `DOMPurify` allowlists, and streams final `<summary>` / `<complete>` blocks into a `sandbox="allow-scripts"` iframe (without `allow-same-origin`) behind a skeleton loader. Inline CSS/JS is permitted with scripts executed once after stream completion, zero network/external resource access, theme tokens + `Manrope` injected inline, and height/navigation events validated over `postMessage` (`flecten://settings/SECTION`, `flecten://panel/PANEL`, `flecten://models`, `flecten://file?path=...&line=...`, and `data-summary-action="navigate"` via `summary-navigation.ts`) with no IPC exposure. Interactive `window.flectenSummary` state capture and delivery modes (next message, post-summary delay, post-interaction delay, or explicit submit button) run tool-free follow-up turns as specified in [response-summary.md](../prompts/response-summary.md).
- **Tool Cards and Subagents.** `tool-presentation.ts` maps built-in tools to plain-language labels and targets while keeping raw JSON arguments inside disclosures. `task` calls spawn dedicated header tabs with live journals, expandable briefs, schema-validated reports (`subagent-report.ts`), and independent `Stop` controls (`SubagentTasks` owns child `AbortSignal`s so stopping the parent run merely stops awaiting children; `task` `list`/`wait`/`stop` manages them explicitly). Malformed subagent reports get one tool-free `submit_report` repair pass within remaining budget. Consecutive `read`, `grep`, and `glob` calls collapse into a single summary row (`ui/src/lib/run/action-groups.ts`) unless one fails; file chips and full logs open in the bounded viewer via `files.read` (`src/app/file-preview.ts`) at the target line `offset`; backup-model responses carry an explicit failover notice.
- **Verification.** `bun run verify` runs unit/integration tests, typecheck, lint, `docs-check`, and both builds. Packaged smoke tests verify the compiled sidecar, preload bridge, editable composer, and live `status` model display (including AppImage smoke on Linux). Headless Playwright E2E exercises Electron + sidecar + mock provider across core flows and visual snapshots at `1480x940` and `1180x640`. `bun scripts/coverage.mjs` enforces an `85%` line-coverage gate, and `bun scripts/docs-check.mjs` cross-checks `PROTOCOL.md`, `TOOLS.md`, config schemas, and security contracts against code in both directions.
- **Extensions.** Supports user/project Agent Skills, MCP over `stdio` and Streamable HTTP with OAuth PKCE and UI elicitation, MCP resource attachments, and command/HTTP hooks (`shared/hooks.ts`) sharing timeouts, cancellation, output caps, `failClosed` semantics, pre-save draft dry-runs, and a 50-run live/replayed execution log. See [HOOKS.md](HOOKS.md) and [EXTENSIONS.md](EXTENSIONS.md).

Implementation and external-infrastructure boundaries: signed production releases require CI signing keys; persistent Windows PTY relies on Bun 1.4.2 ConPTY while Windows AppContainer and per-command Job Objects remain open; Bun's no-orphans cleanup reaps children on sidecar exit but does not replace per-command sandboxing. Auto-update (`update` config section: `stable`/`beta` channel, `update.github` or custom HTTPS feed, auto-check `10 s` after launch and every `4 h` with `15 min` to `4 h` error backoff, background download, restart/quit install) verifies Ed25519 channel manifests before checking installer SHA512 and byte size, blocking unsigned updates. Custom user modes are excluded by design; `done` ends a run loop without replacing acceptance gates; full Spec/Gates/Critic orchestration remains the target architecture below.

Skills reload before each new run and when opening the `/` menu, verifying SHA-256 trust before loading bodies and enforcing `allowed-tools` immediately even within the same tool batch, with restrictions replayed from durable events. Structured `@` mentions pass validated `ContextReference` payloads (editor selection/AST symbol, task item, public GitHub PR, or MCP resource) as untrusted data alongside verbatim prompts. Session export streams logs and copied attachments atomically into a private directory while rejecting symlinks and irregular files; retention never prunes active sessions or non-empty queues. `DiagnosticsRuntime` writes bounded structured logs and redacted config-shape bundles, while opt-in HTTPS telemetry sends counters only - never messages, files, or keys.

## 3. Target Execution Loop

```text
raw message (user language, verbatim)
  │
  ├─ intake: term tagging, translation, persona profile
  ▼
spec.json: goal, non-goals, acceptance criteria, user voice
  │
  ├─ Scout (parallel): brief.md
  ▼
page N: Worker ─► Gates ─► pages/N.md ─► compaction
  │
  ▼ repeat until all criteria pass
Critic in clean context window ─► PASS / REJECT
  │
  ▼
localized answer to user
```

A Worker page corresponds to one cohesive, self-contained subtask sized by cognitive load rather than file count, URL, or window percentage; a single acceptance criterion may span multiple pages.

## 4. Roles

### Twin

Acts as the session's client rather than a helpful assistant: speaks in the user's voice, enforces user taste, and holds veto power over deliverables.

- **Input:** verbatim bilingual prompt, persona profile, repository map.
- **Output:** `spec.json`, mid-run steering decisions, and clean-window final verdict.
- **Rule:** every persona claim requires provenance from prior sessions or `spec.json` - otherwise Twin asks the user directly. A fabricated persona is worse than none.

### Orchestrator

Lightweight model paired with deterministic state rules: selects the next step and page boundary, dispatches Scout, executes Gates, and replans on failure. Never debates requirements or writes product code.

### Scout

Ephemeral read-only researcher spawned per step and terminated upon writing `brief.md` (relevant files, symbols, reusable code, and risks). Writes zero product code.

### Worker

Sees `spec.json`, `brief.md`, the prior page's summary, and the active page - never raw session history - and authors its own page summary on completion.

### Critic

Twin instantiated in a fresh context window seeing only the raw user request, `spec.json`, and the resulting diff/evidence (never intermediate Worker chatter), auditing acceptance criteria, user voice, dead/unrequested code, and project rules.

### Primary Model and Memory

The primary model curates workspace memory directly via the `memory` tool during normal turns without a background Janitor or user-diff observer. Up to three memory candidates can piggyback on existing compaction summary or `done` turns without extra model round-trips.

## 5. Handoffs

Every inter-role boundary is an explicit disk artifact or typed payload with a single writer:

| Boundary | Payload | Writer | Reader |
|---|---|---|---|
| message -> terms | matched term IDs, aliases, and safe spelling fixes | `src/dictionary/match.ts` | `DictionaryRuntime` |
| terms -> model | bounded Markdown reference definitions | `src/core/dictionary/runtime.ts` | active provider request |
| Twin -> orchestrator | `spec.json` | Twin | orchestrator, Critic |
| orchestrator -> Scout | step target and acceptance criterion | orchestrator | Scout |
| Scout -> Worker | `brief.md` | Scout | Worker |
| Worker -> Gates | mutated workspace files | Worker | verification commands from `spec.json` |
| Worker -> page summary | `pages/N.md` | Worker | context budget, next page |
| page summary -> budget | compacted page summary | `context.ts` | subsequent model request |
| diff -> Critic | workspace diff, `spec.json`, verbatim prompt | loop | Critic |
| conversation -> memory | entry with verified source quote and revision | primary model via `memory` | bounded index, plus on-demand `read` |

## 6. Spec

`spec.json` defines:

- Single-paragraph goal.
- Explicit non-goals.
- Verifiable acceptance criteria.
- User voice and dealbreakers.
- Source requirements (for research tasks).
- Verification commands (when known).

"Done" means every criterion is backed by concrete evidence; no evidence means not done.

## 7. Context

### Page

A page represents one bounded unit of work a model can execute at full instruction fidelity (for example, a 1-2 screen landing page, a Login + Registration flow, or a dashboard shell without inner feature tabs). Complex subtasks are split before execution begins.

When page storage is configured, Worker must call `context` `begin` (title and goal) before invoking working tools, and `complete` (outcome, evidence, next step) in a separate turn once verified. The harness rejects work outside an open page, opening a second page before closing the current one, or finishing a run with an unclosed page. A successful `complete` archives the full segment and replaces it with its summary before the next model request regardless of window utilization.

Talker and single-session mode retain threshold-based compaction; for Worker, window limits act strictly as an emergency safety net on runaway open pages, carrying typed `activePage` state across compaction so explicit `complete` remains mandatory. Semantic completeness is declared by the model while lifecycle state is enforced deterministically without regexes or heuristics.

### Page Archive and Summary

`pages/N.md` records what changed, where, active constraints, next step, and open risks; `pages/N.transcript.md` preserves full segment messages, tool arguments, and outputs (linking oversized outputs to session tool logs). Archives fsync before history replacement so write failures leave active context intact. `context` `list`, line-ranged `read`, and literal substring `search` recover exact prior details across compactions and restarts; forked chats copy archives up to the branch point.

### Prefix Stability

Within an active page, the system prompt, `spec.json`, persona summary, and prior page summaries stay byte-identical; only the trailing messages and tool results append, keeping provider KV-cache hits intact across an entire page rather than thrashing every 12-15k tokens.

### Output Truncation

Oversized tool outputs keep deterministic head and tail lines while preserving errors and diffs intact and writing full payloads to `.flecten/sessions/<id>/logs/`, ensuring byte-stable prefixes.

### Compaction Ladder

1. Per-tool inline output cap.
2. Old tool-output pruning.
3. Page-boundary dialogue compaction.
4. Full-session summary fallback.

Three consecutive compaction failures trip the circuit breaker and disable auto-compaction rather than burning API quota in a retry loop.

## 8. Memory

`MemoryPort` is shared across all chats belonging to the same canonical workspace. The primary model curates entries explicitly via `memory` (`topics`, `list`, `read`, `sources`, `save`, `forget`, `reconcile`) across built-in kinds (`preference`, `lesson`, `decision`, `commitment`, `context`, `procedure`) or schema-valid custom kinds, using model-authored `topics` and `appliesWhen` routing with no global cross-project bank, auto-graph, or background extraction model.

The runtime verifies exact verbatim quotes against real user or tool events, recording role and SHA-256 provenance; `preference` and `lesson` entries require direct user quotes (summaries, system notices, and Worker briefs never count as user speech). Up to `1,200` estimated tokens inject before each request (invalidations, topic catalog, unseen index entries, or critical bodies scaled to available context), with paginated listing and batch `read` (up to six bodies per call) tracking `index`/`full`/`invalidated` visibility across pruning, compaction, and replay.

`.flecten/memory.json` (v2) stores active entries (up to `500` with zero silent eviction), tombstones, and audit history using CAS revisions, atomic `reconcile`, mutex serialization, metadata-cached snapshots, and explicit failure on corruption. Legacy v1 entries migrate as `unverified` and are excluded from automatic injection; `forget` suppresses active recall while preserving the audit log and `events.jsonl`. Full budgets and constraints live in [MEMORY.md](MEMORY.md).

## 9. Verification

- **Gates:** Verification commands from `spec.json` run automatically after each page; failures return to Worker as structured tool errors rather than prompt persuasion.
- **`done`:** Returns `REJECTED` until Critic issues `PASS`.
- **Criteria -> Evidence:** Sessions close with a strict criterion-to-evidence mapping; unverified criteria block completion.
- **Sources:** Research specs enforce `sources_required` (count, domain/date logging, freshness, and `independence: strict` forbidding single-source claims).
- **Untrusted Input:** File reads, web fetches, MCP responses, and tool outputs wrap inside fenced `Untrusted data` Markdown sections (`src/core/loop/tool-message.ts`) paired with system-prompt non-execution rules - enforced structurally rather than via regex sanitization.

## 10. Comprehension

Intake flags uncertain term spans and resolves them in order across the term dictionary, local docs, and web search, attaching dated, source-attributed definitions beside the user turn rather than mutating the system prompt. Unresolved ambiguity triggers a single targeted Twin question whose answer persists with `source: user`. `message.raw` is stored character-for-character; Worker executes against `message.en`, and localized replies verify identifier, path, and numeric fidelity.

## 11. Reuse

Prior to the first `write`, Scout checks the local cross-project index, installed package types/docs, and web references. If a diff introduces more than `40` lines duplicating an indexed local pattern, Critic requires explicit justification.

## 12. Runtime

The Electron shell passes a stable `FLECTEN_PROFILE` directory (`userData`) to the sidecar, consolidating all settings (including permissions, sandbox, MCP, hooks, modules, and slash commands) into a single global `flecten.config.json` and ignoring repo-local config files (unless an explicit `FLECTEN_CONFIG` override is set for tests/integrations). First launch non-destructively imports legacy settings and destination-bound credentials.

`shared/project-index.cjs` tracks the active canonical workspace, saved folders, and trust decisions (`unknown`, `trusted`, `untrusted`). Selecting a new or undecided folder prompts in the UI (`trust.accept` / `trust.reject`, editable anytime from the project menu); `untrusted` workspaces keep built-in tools active while disabling repo-local executable extensions. Legacy profiles with a global config but no project index register the startup `cwd` as `unknown` (or fall back to `projectless` if inaccessible), while fresh profiles write an empty index immediately and honor explicit `FLECTEN_CWD` overrides.

Fresh profiles boot in `projectless` mode: the shell provisions an isolated `projectless` directory inside the profile with `FLECTEN_PROJECTLESS=1` and `AppInfo.projectRoot = null`, keeping sessions, memory, attachments, and logs self-contained without scanning parent directories for `AGENTS.md`, local skills, commands, subagents, or shadow Git (inspired by `/home/oleksandr/reverse_codex`).

Opening a broad parent directory never recursively preloads sibling project instructions. Workspace file indexing streams entries under a `1.5 s` budget capped at `5,000` files, `2,000` directories, `10,000` total entries, depth `32`, and `1 MiB` Git output, setting `files.list.limited` so the explorer and search warn when results are truncated and suggest opening a narrower project root. `projects.list` aggregates saved workspaces and standalone sessions. The Agent sidebar groups standalone sessions under the collapsible **Separate chats** section below the folders. Removing a folder from the list never deletes files or session history on disk.

Stack summary:

- **Bun 1.4:** `Bun.serve`, `Bun.spawn`, `Bun.Terminal`, `Bun.WebView`, `bun:sqlite`, `Bun.cron`, `bun test`, and `bun build --compile`.
- **Core sidecar (`dist/flecten-agent` / `src/app/server.ts`):** Separate Bun process speaking newline-delimited JSON over `stdin`/`stdout` with zero open network ports, auth tokens, or Electron/Svelte imports, and no standalone user CLI.
- **UI (`ui/`):** Svelte 5 + Vite with zero direct filesystem or model access; state enters via props and `window.desktop.agent`.
- **Shell (`shell/`):** Electron 45 serving `flecten://app/index.html` and `preload.cjs`, packaged via `electron-builder` with `flecten-agent` and `prompts/` in `resources/`. Electrobun remains the long-term shell target per ADR-003 without changing the renderer contract.

## 13. Modules and Layer Boundaries

Reference module [Computer Use](COMPUTER-USE.md) (`tests/fixtures/modules/computer-use/`) builds strictly on the public module SDK ([MODULES.md](MODULES.md)) without a second agent loop: serializing input actions, requiring current observation IDs, separating human control from model calls via trusted transport metadata, isolating Xvfb/D-Bus and Firefox profiles from the host pointer (within OS user permissions), and routing screenshots through content-addressed session attachments. `src/modules` manages verified module generations while `core` depends only on the abstract session port. Full directory ownership lives in [STRUCTURE.md](STRUCTURE.md).

Layer rules (one responsibility per file; `300` lines soft limit, `500` hard limit):

- `core` never imports `ui`, `shell`, or `store`.
- `store` knows domain types, never agent roles.
- `context` counts tokens and compacts messages, never calling models directly.
- `security` evaluates permissions, approvals, and path policies without executing tools.
- `terminal` manages PTYs and command framing without choosing what to run.
- `tools` depend only on core types and utilities.
- `providers` translate wire protocols with zero knowledge of tools or the agent loop.
- `skills` discover skill files and expose the catalog plus activation tool.
- `mcp` encapsulates the MCP SDK, config, and tool registry away from the core loop.
- `core/hooks` runs lifecycle hooks without depending on `app`.
- `app` wires dependencies together without embedding harness business logic.

## 14. Invariants

1. Minimal hardcoding: no brittle keyword lists, arbitrary three-state enums, or aesthetic ban checklists.
2. Enforce rules in runtime code and deterministic gates - prompt reminders do not count as guarantees.
3. Keep request prefixes byte-stable within an active page; compact strictly at page boundaries.
4. Invoke frontier models cleanly on distilled context rather than polluted transcripts.
5. Use lightweight models only where deterministic checks catch mistakes cheaply.
6. Core stays completely agnostic of UI and desktop shell internals.
7. Store raw user messages verbatim, character for character.
8. Validate every external boundary with an explicit schema.

## 15. Security Boundaries

- Sidecar IPC runs exclusively over `stdin`/`stdout`; loopback HTTP listeners open solely during explicit interactive OAuth callbacks.
- Inline tool outputs are size-capped with full logs on disk; renderer `files.read` previews resolve symlinks prior to workspace bounds checks, cap payloads at `512 KB`, and redact secrets.
- Secrets redact before hitting `events.jsonl`, tool logs, live IPC streams, or replay.
- File writes outside declared task scope require an explicit `why` justification.
- All content from the web, workspace files, skills, MCP servers, and hooks is treated as untrusted data.
- MCP child processes receive only a minimal safe environment allowlist plus explicit `env` entries from `flecten.config.json`.
- Command hooks and MCP servers spawn processes only when configured in `flecten.config.json` and workspace trust permits.
- `PermissionEngine` and `SandboxPolicy` verify canonical paths, symlinks, protected prefixes, network rules, and env allowlists before any tool executes.
- `bash` and interactive terminals run inside `bubblewrap` on Linux and `Seatbelt` on macOS when available on the host (Windows AppContainer isolation remains pending); hooks configured with `failClosed` block execution on hook failure.

## 16. Cut Scope and State Guarantees

Explicitly cut: `Hardness` three-state toggles, "no purple gradients" prompt checklists, Jev in summarization/fact-extraction/grading, a separate Talker window, 30-second command polling crons, a custom terminal emulator, Go/Rust/C# core rewrites for v1, Tauri for v1 (retained as fallback), and LangChain or third-party agent SDKs.

Binary attachments copy into private content-addressed session storage on send so durable events, chat reopens, and branch forks restore full multimodal parts even if source files are deleted. `auth.command` token caches key on provider config and expiry, updating live adapters on re-authorization. Lifecycle phase, queue, approvals, and background jobs publish from core as schema-validated `SessionState` snapshots carrying `epoch` and `revision` - the UI projects canonical backend snapshots rather than guessing local phases or optimistically confirming queued/approved actions before IPC acknowledgement.
