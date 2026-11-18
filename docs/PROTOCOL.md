# Protocol

## Service

The core exposes a single interface:

```ts
interface HarnessService {
  send(command: Command): Promise<unknown>;
  subscribe(listener: (event: Event) => void): () => void;
}
```

Everything else is an adapter: the sidecar process for Electron and direct in-process calls in tests. All sidecar commands are listed in `shell/agent-commands.json`, and core events are defined by `Event` in `src/core/types/event.ts`. `bun scripts/docs-check.mjs` cross-checks this document against both sources in both directions: any undocumented command/event or stale table row fails CI.

## Transport

Electron spawns `dist/flecten-agent` (or `src/app/server.ts` in dev) and communicates via newline-delimited JSON (one JSON object per line):

- Commands arrive on `stdin`, events and responses write to `stdout`, and diagnostics write to `stderr`.
- Any command may carry a string `requestId`. When present, the sidecar replies with a `response` carrying the same `requestId`: `ok: true` plus the fields listed under **Response**, or `ok: false` and `error`.
- Without `requestId`, no `response` envelope is sent; validation failures emit an `error` event with code `invalid_input`.
- `run` and `hello` stream their results as events (`session.started` onward, or `status`). `stop` with `requestId` also acknowledges the command and returns canonical session `state`.
- Error messages pass through `redact` so API keys and tokens never reach the window or logs.

```json
{ "type": "checkpoint.list", "requestId": "r7", "sessionId": "s_1" }
```

```json
{ "type": "response", "requestId": "r7", "ok": true, "checkpoints": [] }
```

```json
{ "type": "response", "requestId": "r8", "ok": false, "error": "id is required" }
```

Each project is served by a single core process. On startup, the sidecar acquires `.flecten/sidecar.lock` (PID, token, start timestamp; created atomically via hard link). If a live process holds the lock, startup waits up to 5 seconds so a reopened workspace lets the previous sidecar flush writes; locks held by dead PIDs are reclaimed immediately. If the lock remains held after 5 seconds, the sidecar emits `error` with code `project_locked` and exits without Electron restart-looping it. On read-only filesystems, the core runs lock-free.

The Electron shell validates every command before forwarding it to the sidecar: JSON object, `type` in `shell/agent-commands.json`, string `requestId`, `prompt` <= 200,000 characters, and raw line <= 4 MiB. The sidecar re-validates every field at its own boundary (`src/app/server-input.ts`): `text` and `prompt` <= 200,000 characters, plus typed IDs, numbers, and arrays.

## Pre-Launch Migration

Before starting the normal core service, the sidecar may emit `storage.migration` events matching `shared/storage-migration.ts`: `version`, `phase`, `step`, `completed`, `total`, `paths`, `backups`, and optional `currentPath` and `error`. Phases are `required`, `running`, `failed`, and `complete`. While migration is pending, `hello`, `status`, and `storage.status` return the current migration snapshot and all other core commands are blocked. `storage.migrate` acknowledges startup immediately and streams progress via events (duplicate calls while running are idempotent). `storage.accept` is valid after `complete`, re-verifies published data, records acceptance durably, and boots the core; the UI modal closes only once a live core `status` arrives.

The migration transaction log at `.flecten-migration/v1/state.json` advances through `planned`, `backed-up`, `merged`, `verified`, `retiring`, `retired`, `published`, and `ready`. Each source records a content `scope` (`durable` for new plans; legacy transactions without `scope` default to `full`). Prior to `retiring` (while all source stores remain in place and no `retired-*` directory exists), a legacy `full` plan upgrades automatically to a `durable` revision without walking rebuildable trees: the exact prior state is preserved via an immutable `state-N-full.json` link, existing backups stay untouched, and the upgraded plan writes into `originals-N`. Once `retiring` begins, full-scope checks stay pinned. `originals/current` and `originals/legacy` backups are verified by SHA-256 within scope, original directories are preserved intact as `retired-current` and `retired-legacy`, and publication uses atomic directory renames with `fsync`. Interrupted runs resume automatically on restart, unaccepted completions re-open the confirmation screen, remembered accessible projects migrate together without recreating deleted folders, and discovery inspects only metadata directories of selected and remembered roots rather than crawling user trees.

File reads and copies run with bounded concurrency of 16, copying via open Bun file descriptors with per-file `fsync` and directory sync before advancing stages. SHA-256 manifests verify backups, staging, and pre-retirement sources. `durable` plans skip enumerating, hashing, or copying rebuildable `shadow`, `cache`, `diagnostics`, and `sidecar.lock` data, bounding migration time regardless of shadow Git size. Verification caches apply only within a single locked invocation and re-run after restart; `storage.accept` holds locks across all pending stores from verification through durable acceptance writes. Benchmark isolated stores via `bun scripts/measure-storage-migration.ts` (`--source` tests an isolated copy of a target directory).

Disjoint sessions merge cleanly, preserving identical files and verified journal prefixes without rewriting user prompts, whereas conflicting substantive files halt migration with paths to preserved originals. Checkpoint objects and manifests are always copied and verified byte-for-byte. Disk-full errors, permission failures, active competing sidecars, or corrupt state transition to `failed` rather than producing an empty store, and `Retry` never resolves data conflicts automatically. Accepted workspaces skip stale manifest checks on subsequent boots, and backup directories are never auto-deleted (crash safety covers `SIGKILL`; power-loss durability depends on OS/drive `fsync` semantics).

## Tasks and Routing

Multiple tasks can run concurrently up to `sessions.maxConcurrent` (default `4`). Each task is an isolated session with its own queue, pending approvals, background jobs, and budget.

- Commands marked **Session: yes** accept `sessionId` and fall back to the focused session when omitted.
- `approval.respond`, `approval.allowAll`, and `approval.denyAll` without `sessionId` resolve the owning session by approval `id`, routing responses from any window to the session that requested them.
- Every task event carries `sessionId`, and background job completion notices route exclusively to the session that spawned the job.
- Sending a second `run` to an already active session fails with `a run is already active`; use `steer` or `queue.add` while a run is in flight.

## Event Ordering and Replay

`sessions.get` returns visible events alongside `messageVersions` ordered by user turns (`messageId`, 1-based `current` index, and opaque `variants` IDs). `sessions.edit` preserves the prior continuation branch, keeps the history prefix before the edited message, and starts a new run with updated `text`, replying once `session.started` is persisted so clients refresh from journal + live replay without issuing a second `run`. `sessions.branch` switches to a saved variant along with its latest nested continuation.

`messageVersions.attachments` lists stored attachment metadata (`id`, `name`, `kind`, `size`). On `sessions.edit`, `retainedAttachments` selects which prior attachments and context references carry over before appending new `attachments` and `contexts` (`[]` drops all prior attachments; omitting `retainedAttachments` replaces only the arrays explicitly passed). IDs and newly attached files are validated and persisted before branching; `model.set` commits model changes prior to editing, and `reasoning` sets the new run's level. Legacy unindexed snapshots appear as a single grouped attachment.

History edits and branch switches are rejected while the agent is running or when queued messages, pending approvals, background jobs, or active subagents exist. `history.edited` and `history.selected` persist in the durable journal without appearing in visible UI event projections, and switching conversation branches does not revert workspace files.

When translation is enabled, `session.started.prompt` keeps the user's original message verbatim while `input.translated` records English `input`, detected `language`, and actual compiled `system` stamp. `message.finished` stores canonical English `text`, `reasoning`, and `summary` alongside translated `display` fields for the UI (similarly, `context.compacted.displaySummary` is separate from canonical `summary`): model replay reads canonical English, while the renderer shows `display` (falling back to canonical text and emitting `translation.failed` if back-translation fails). `usage` events with `purpose: "translation"` or `purpose: "vision"` carry `provider`, `model`, and `durationMs` billed at that model's rates.

- Every wire event carries a process-wide monotonically increasing `seq`.
- Per-session events arrive in causal order; `tool.finished` emits as calls complete while tool results enter model history in invocation order.
- `events.replay` returns events for the active (or latest) run starting from its `session.started`: `{ "replay": { "sessionId", "events", "seq", "running" } }`. Streaming deltas for already completed messages are omitted because `message.finished` carries the full text.
- Reconnecting or secondary windows apply `replay.events` and ignore live events with `seq <= replay.seq`, preventing dropped or duplicate deltas.
- Up to 32 recent sessions (up to 20,000 events per run) stay buffered in memory; full histories live on disk and `sessions.get` loads the active conversation branch.

```json
{ "type": "events.replay", "requestId": "r9", "sessionId": "s_1" }
```

## Commands

| Command | Session | Fields | Response |
|---|---|---|---|
| `storage.status` | no | none | current `migration` snapshot, or `null` once accepted |
| `storage.migrate` | no | none | immediate ACK, followed by live `storage.migration` progress events |
| `storage.accept` | no | none | ACK after verification and durable acceptance, then core startup |
| `twin.get` | no | none | `twin`: persona profile, sources, and training state |
| `twin.scan` | no | none | `twin`: discovered source paths and session counts |
| `twin.train` | no | `sourceIds` | `twin`: immediate snapshot while training runs in background |
| `twin.cancel` | no | none | `twin`: cancels active training |
| `twin.configure` | no | `enabled?`, `sourceIds?` | `twin`: updates Twin configuration |
| `twin.review` | no | `candidateId`, `action`, `edits?` | `twin`: applies or dismisses a legacy candidate trait |
| `twin.update` | no | `id`, `expectedRevision`, `edits` | `twin`: CAS update of an existing trait |
| `twin.forget` | no | `id`, `expectedRevision` | `twin`: removes a trait |
| `twin.teach` | no | `summary`, `content`, `appliesWhen`, `path?`, `before?`, `after?`, `reaction?`, `strength?`, `voice?` | `twin`: records an explicit user lesson without calling a model |
| `twin.consult` | no | `question` | `twin`, `answer`: sample Twin reply with trait citations and usage |
| `dictionary.list` | no | none | `dictionary`: public and local entries with provenance and revision |
| `dictionary.sync` | no | none | `dictionary`: verified GitHub snapshot, or prior dataset with sync error |
| `dictionary.save` | no | `entry`, `expectedRevision?` | `dictionary`: saves a local definition in project memory |
| `dictionary.forget` | no | `id`, `expectedRevision` | `dictionary`: deletes a local override, uncovering any public definition |
| `sessions.export` | no | `id` | `exported.path`: atomic redacted JSONL + attachments bundle in `.flecten/exports/` |
| `context.pull-request` | no | `url` | `contextReference`: public GitHub PR metadata and summary |
| `diagnostics.export` | no | none | `diagnostics.path`, `diagnostics.report` |
| `telemetry.send` | no | none | sends opt-in event counters when consent is saved |
| `hooks.test` | no | `event`, `index` | `hookTest`: dry-run execution result for a configured hook |
| `modules.list` | optional | `sessionId?` | `moduleState`: catalog, active revisions, and surfaces |
| `modules.marketplace` | no | `action: list/install/addSource/removeSource`, `refresh?`, `url?`, `source?`, `name?`, `revision?` | `moduleMarketplace`, `moduleState`: catalog browsing, source management, and verified installs with dependencies |
| `modules.change` | no | `operation`, `path`, `revision?`, `enabled?` | `moduleState`: install/trust/enable/development/interface/remove |
| `modules.surface` | optional | `name`, `surface`, `revision` | `moduleHtml`: verified HTML surface bundle |
| `modules.invoke` | yes | `name`, `surface`, `revision`, `request` | `moduleResult`: executes surface tool/resource call via shared executor |
| `modules.styles` | no | `name`, `revision` | `moduleStyles`: bundled CSS for the active module interface |
| `modules.authorize` | optional | `name`, `surface`, `revision`, `request` | `moduleAuthorized`: verifies surface host-API grant |
| `skills.list` | no | none | `skills`: discovered skill metadata and resource files |
| `skills.reload` | no | none | `skills`: reloaded skill catalog |
| `skills.resource` | no | `name`, `path` | bounded UTF-8 text of a skill resource file |
| `mcp.status` | no | none | `mcp`: health, logs, catalogs, and pending auth requests |
| `mcp.reconnect` | no | `id?` | `mcp`: reconnected server catalog |
| `mcp.resource` | no | `server`, `uri` | `attachedContext`: bounded resource text and budget metadata |
| `mcp.prompt` | no | `server`, `name`, `args?` | `attachedContext`: rendered MCP server prompt |
| `mcp.oauth.start` | no | `id` | `authorization`: consent URL (tokens remain in sidecar) |
| `mcp.oauth.cancel` | no | `id` | cancels pending OAuth flow |
| `mcp.elicitation.respond` | no | `id`, `response` | `answered`: validates and submits server elicitation form response |
| `hello` | no | none | no `response`; sidecar emits `status` |
| `status` | optional | `sessionId?` | with `sessionId`: session `state` and `info`; followed by global `status` |
| `run` | yes | `prompt`, `reasoning?`, `sessionId?`, `clientId?`, `attachments?`, `contexts?`, `resumed?` | no `response`; streams task events |
| `summary.interaction` | yes | `sessionId`, `summaryId`, `interaction` (delivery policy, named value, or trigger) | no `response`; delivers interaction payload into the same chat per policy |
| `stop` | yes | `sessionId?`, `mode?: graceful / force`, `target?: worker` | `result`, `state`; run concludes with `session.finished` |
| `steer` | yes | `text`, `attachments?`, `contexts?`, `id?` | `result`; injects message into active run (`steer.applied`) |
| `queue.add` | yes | `text`, `attachments?`, `contexts?`, `id?` | `result`; enqueues message for next run |
| `queue.edit` | yes | `id`, `text` | `result` |
| `queue.remove` | yes | `id` | `result` |
| `approval.respond` | yes | `id`, `decision`, `feedback?` | `result` |
| `approval.allowAll` | yes | `ids` | `result` |
| `approval.denyAll` | yes | `ids` | `result` |
| `tool.cancel` | yes | `callId` | `result` |
| `subagent.stop` | yes | `id` | `result.stopped`, `state`; stops the target subagent (including Worker subagents) |
| `jobs.list` | yes | none | `jobs` |
| `jobs.stop` | yes | `id` | `job` |
| `checkpoint.list` | yes | none | `checkpoints` |
| `checkpoint.diff` | yes | `id` | `diff` |
| `checkpoint.restore` | yes | `id`, `target?`, `paths?`, `force?`, `includeProtected?` | `restore` |
| `context.compact` | yes | `focus?` | compaction result: `pruned`, `before`, `after`, `summary` |
| `events.replay` | yes | `sessionId` | `replay` |
| `sessions.list` | no | `query?`, `limit?`, `offset?` | `sessions` |
| `sessions.search` | no | `query`, `limit?`, `offset?` | `sessions` |
| `sessions.get` | no | `id` | `events`, `messageVersions` for the active branch |
| `sessions.edit` | no | `id`, `messageId`, `text`, `reasoning?`, `attachments?`, `contexts?`, `retainedAttachments?` | `events`, `messageVersions`; launches the edited branch automatically |
| `sessions.branch` | no | `id`, `messageId`, `variantId` | `events`, `messageVersions`; activates a saved continuation variant |
| `sessions.rename` | no | `id`, `title` | `session` |
| `sessions.delete` | no | `id`, `confirm: true` | deletion result |
| `sessions.fork` | no | `id`, `sequence?` or `turn?` | `session` |
| `settings.get` | no | none | `settings` |
| `access.set` | no | `mode: agent/confirm/full` | `info`; followed by `status` |
| `voice.status` | no | none | `voice`: `engine`, `providerId`, provider/engine label, `model`, `language`, plus local install readiness |
| `voice.transcribe` | no | `id` (UUID), `audio` (base64: <= 2 MiB for API, <= 2,900,044-byte WAV for local), `mimeType`, `destination?` (`engine`, `providerId`, `model`, `language` from `voice.status`) | `text`: transcribed speech |
| `voice.cancel` | no | `id` | aborts transcription or setup and kills its process tree |
| `voice.check` | no | `id` (UUID), `engine` (`faster-whisper` or `vosk`), `local` (`python`, `whisperModel`, `voskModel`, `device`) | `voiceSetup`: `ready`, `message` |
| `voice.prepare` | no | `id` (UUID), `engine`, `local` | installs Python runtime and downloads model; returns `voiceSetup`: `ready`, `message` |
| `settings.save` | no | `config`, `clearApiKeys?` | `info`; followed by `status` |
| `trust.accept` | no | none | `info`; persists workspace trust, followed by `status` |
| `trust.reject` | no | none | `info`; persists workspace rejection, followed by `status` |
| `projects.list` | no | none | `projects`: registered folders, trust state, sessions, plus the `projectRoot: null` group |
| `model.set` | optional | `sessionId?`, `provider`, `model`, `reasoning?`, `variant?` | `info` for target chat or global defaults; followed by global `status` |
| `model.probe` | no | `provider`, `model` | model connectivity probe result |
| `provider.discover` | no | `protocol`, `baseUrl`, `apiKey?`, `headers?` | `result` |
| `provider.inspect` | no | `baseUrl` | `result`: unauthenticated gateway fingerprint |
| `provider.draft` | no | `provider`, `providerId?` | `result` with temporary draft token |
| `provider.test` | no | `model` plus `providerId` or `draftToken` | `result` |
| `model.metadata` | no | `model`, `providerId` or `draftToken`, `refresh?` | `result.model`, `result.warnings` (read-only API/catalog lookup without generation or saving) |
| `provider.reauthorize` | no | `id`, `model` | `result`; refreshes auth-command token cache and probes model |
| `provider.actualize` | no | `id` | `result`, `info` |
| `catalog.status` | no | none | `status` |
| `catalog.sync` | no | none | `status` |
| `catalog.list` | no | none | `providers` |
| `catalog.provider` | no | `id` | `provider` |
| `files.list` | no | none | `files` |
| `files.change` | no | `operation`, `path`, `destination?`, `directory?`, `confirm?` | file/directory create, rename, or trash result |
| `files.search` | no | `query`, `caseSensitive`, `wholeWord`, `include` | `search`: workspace search matches |
| `files.replace` | no | search and replacement parameters | `replacement`: verified workspace replacement result |
| `files.git` | no | `action`, `path?`, `staged?`, `message?` | `git`: repository status or operation result |
| `ide.terminal` | no | `action`, `data?`, `cursor?`, `cols?`, `rows?` | `terminal`: dedicated user IDE PTY |
| `files.read` | no | `path` | `file`: `path`, `size`, `text`, `truncated`, `binary`, `hash?`, `readOnlyReason?` |
| `files.write` | no | `path`, `text`, `expectedHash` | updated `file` snapshot |
| `commands.list` | no | none | `commands` |

Field semantics:

- `reasoning`: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; defaults to config when omitted and clamps to the nearest level supported by the model.
- `files.read`: project-relative path with symlinks resolved prior to boundary checks (external paths, FIFOs, and device nodes are rejected). Returns up to 512 KiB of secret-redacted UTF-8 text aligned to a line boundary (`truncated: true`), or `binary: true` with empty `text` for binary files; backs both the file viewer and full tool-log inspection.
- `files.write`: atomically updates an existing UTF-8 file up to 512 KiB while preserving permissions and BOM. `expectedHash` must match the latest `files.read` (on mismatch, write rejects and prompts reloading). Binary, truncated, redacted, UTF-16, and protected `.git`/`.flecten` files omit `hash` and expose `readOnlyReason` instead; external paths are rejected.
- `decision`: `allow_once`, `allow_session`, `allow_always`, or `deny`. On `external_path`, `allow_once` covers the prepared call, `allow_session` authorizes that directory tree in session memory, and `allow_always` writes an `external_path` + `pathPrefix` rule to config; other actions scope session/always grants to exact arguments, `cwd`, and target resources. Human checkpoints permit `allow_once` only. `feedback` forwards user guidance to the model.
- `access.set.mode`: `agent`, `confirm`, or `full`. Updates baseline permissions and sandbox settings while preserving providers, custom rules, checkpoints, and other config fields. `info.accessMode` and `status` report `agent | confirm | full | custom` (`custom` is computed when baseline fields diverge and is not accepted as an input mode).
- `target`: `before` (default pre-turn state) or `after`. `force` overwrites files modified manually since the checkpoint; `includeProtected` includes protected paths.
- `protocol`: `openai-chat`, `openai-responses`, `anthropic-messages`, or `gemini`.
- `clientId` correlates a pre-session `run_failed` error back to an unsaved UI draft.
- `resumed` marks a run continuing an interrupted task.

```json
{ "type": "run", "prompt": "Build a landing page", "reasoning": "medium" }
```

```json
{ "type": "approval.respond", "id": "a_12", "decision": "allow_once" }
```

```json
{ "type": "checkpoint.restore", "sessionId": "s_1", "id": "c_3", "target": "before", "paths": ["src/app.ts"] }
```

## Events

| Event | Payload |
|---|---|
| `session.started` | `prompt`, `provider`, `model`, `input?`, `attachments?` (validated metadata references), `reasoning?`, `system?`, `queueId?`, `resumed?`, `budget?` |
| `session.state` | `sessionId`, `state`: canonical phase, epoch/revision, queue, approvals, and jobs |
| `turn.started` | `turn` |
| `message.started` | none; anchors the chronological slot of the first assistant text chunk |
| `message.delta` | `text` |
| `reasoning.delta` | `text` |
| `message.finished` | `text`, `reasoning`, `toolCalls`, `summary?`, `complete?`, `display?` |
| `message.reset` | `reason` |
| `model.fallback` | `provider`, `model`, `reason` |
| `provider.retry` | `kind`, `attempt`, `delayMs`, `until`, `reason` |
| `tool_call.progress` | `index`, `name?`, `delta?` |
| `tool.output` | `callId`, `text` (redacted live output chunk from an active call) |
| `twin.activity` | `activity` (`taskId?`, `phase`, `state`, `emotion`, `voice`, `instructions`, `entryIds`, `corrections`, `provider`, `model`, `usage?`): durable Twin-Worker dialogue, acceptance, and cost |
| `worker.event` | parent `sessionId` plus nested `event` from the Worker session (recursive Worker envelopes disallowed) |
| `worker.acceptance` | `sessionId`, `acceptance`: assignment criteria and verification state |
| `provider.response` | `sessionId`, `response`: redacted stream-completeness receipt without prompt or response text |
| `context.summary.failed` | `sessionId`, `stage`, `reason`: compaction summary failure stage and cause |
| `subagent.started` | `subagent`: stable `id`, `callId`, `name`, `avatar`, `agent`, and initial `prompt` |
| `subagent.event` | `id`, `event`: typed child-session event (no nested child runners) |
| `subagent.finished` | `id`, `result` (validated report, usage, error), `cancelled` (explicit stop or timeout) |
| `tool.started` | `call` |
| `tool.finished` | `call`, `result` |
| `steer.applied` | `text`, `input?`, `queueId?` |
| `notice.applied` | `text` |
| `job.started` | `job` |
| `job.finished` | `job`, `notify`, `checkpoint?` |
| `budget` | `budget` |
| `task.budget` | `budget`: combined chat ledger across Talker, Worker, and auxiliary calls |
| `run.interrupted` | `at`, `reason` |
| `context.compacted` | `summary`, `displaySummary?`, `pruned`, `before?`, `after?`, `kept?`, `page?`, `path?`, `source?`, `focus?` |
| `context.usage` | `used`, `window`, `reserve`, `source` |
| `memory.context` | `text`, `references`: array of `{ id, revision, level }` (`index`, `full`, `invalidated`) |
| `usage` | `usage`, `purpose?`, `provider?`, `model?`, `durationMs?` |
| `usage.unavailable` | `purpose?`, `provider?`, `model?` when upstream omitted usage receipts |
| `input.translated` | `input`, `language`, `system?` |
| `translation.failed` | `message` |
| `hook.finished` | `hook` |
| `turn.finished` | `turn`, `reason` |
| `session.finished` | `result` |
| `approval.requested` | `approval` |
| `approval.resolved` | `id`, `choice`, `by` |
| `error` | `code`, `message`, `sessionId?`, `limit?`, `resetAt?` |

Every event (except non-session `error` events) carries `sessionId` plus wire `seq`.

`memory.context` persists in durable JSONL and replays into internal model context: `text` becomes a dedicated context message carrying `memoryReferences` (`{ id, revision, level }`, plus `catalog:<SHA-256>` at revision `1` for topic-catalog snapshots) without granting user-quote `memorySource` authority, preserving visibility tracking across reopen and clearing it on compaction ([MEMORY.md](MEMORY.md)). During bulk revocations, `invalidated` references strip stale memory messages from provider projections and replay across the entire 500-entry bank without inflating model-facing prose.

- `tool_call.progress`, `message.delta`, `reasoning.delta`, and `provider.retry` are transient live indicators excluded from durable JSONL and post-completion replay.
- `message.reset` discards a partially streamed assistant message when an upstream stream drops mid-turn and retries.
- `provider.retry` announces that the request will retry at epoch timestamp `until` (ms).
- `model.fallback` fires before the first token from a backup route after primary failure `reason` (`rate_limit`, `quota`, `server`, `network`, `timeout`, `circuit_open`, etc.) and persists in the log to record which model answered.
- `steer.applied` fires when a steered user message enters model context (`queueId` links back to a dequeued item).
- `notice.applied` fires when the model receives a runtime notice (such as background job completion).
- `budget` fires on every spend update; `budget.exceeded` names the limit (`tokens`, `cost`, or `time`) that halted the run.
- `run.interrupted` is appended to sessions cut short by a sidecar crash or restart.
- `approval.requested` includes `approval.expiresAt`. `approval.resolved.by` is `user`, `timeout`, `aborted`, `policy`, or `persistence`: `policy` re-evaluates pending prompts when rules or grants change (`allow_once` if newly permitted, `deny` if newly blocked, without fabricating a user grant, while keeping `ask` and human checkpoints pending); `persistence` marks a grant-save failure.
- `error.limit` (`rate`, `five_hour`, `weekly`, `billing`) and `resetAt` arrive when an upstream rate or billing quota halts the run.

## Service messages

These messages originate from the sidecar wrapper (`src/app/server.ts`) or Electron shell (`shell/main.mjs`) rather than `core`:

| Message | Source | Payload |
|---|---|---|
| `status` | sidecar | workspace, Git branch, user, default provider/model, context window, providers list, skills, MCP, sandbox, `accessMode`, prompt info, shell snapshots, `configError?`, `sessions` |
| `response` | sidecar and shell | `requestId`, `ok`, response payload fields or `error` |
| `sessions.interrupted` | sidecar | `interrupted`, `resumed` |
| `agent.exit` | shell | `code`, `signal?`, `message?` |
| `project.changed` | shell | `cwd` |
| `projects.changed` | shell | workspace list changed; refresh via `projects.list` |
| `session.open` | shell | `id`; open target session once workspace is ready |

`status` carries `projectRoot: string | null` (`null` when running without an open project) and `trustState: "unknown" | "trusted" | "untrusted"`.

Global `status` broadcasts the default `provider` and `model` without `sessionId`, whereas `status` called with `sessionId` returns chat-scoped `info` first. `model.set` with `sessionId` appends a durable `model.selected` event (`sessionId`, `provider`, `model`, `reasoning?`, `variant?`) to that chat without altering global defaults; omitting `sessionId` updates the default model for new chats. Reopened chats restore their latest `model.selected` (or latest primary run model on legacy logs), applying changes on the next turn after any in-flight request finishes.

`status` is emitted on boot and after `hello`, `status`, `trust.accept`, `trust.reject`, `settings.save`, `access.set`, and `model.set`. `sessions` summarizes all active sessions (`sessionId`, `running`, `turns`, `queue`, `approvals`, `jobs`). Missing provider credentials populate `configError` while keeping the sidecar alive.

`sessions.interrupted` emits on boot when prior sessions were cut short, listing all `interrupted` IDs alongside any auto-`resumed` IDs (`sessions.autoResume`, capped at `sessions.maxConcurrent` and never re-resuming an already resumed run).

`agent.exit` notifies the UI that the sidecar process exited so the user can retry; `project.changed` announces that the shell switched workspaces and restarted the sidecar.

## Errors

Uncorrelated command failures (without `requestId`) and fatal task errors emit an `error` event:

```json
{ "type": "error", "code": "invalid_input", "message": "prompt is required" }
```

| Code | Condition |
|---|---|
| `invalid_input` | Command envelope or field failed schema validation |
| `provider_failed` | Upstream provider failed after all retries and failover routes |
| `context_overflow` | Prompt still exceeds context window after compaction |
| `provider_limit` | Provider rate or quota limit hit (includes `limit` and `resetAt`) |
| `cancelled` | Task stopped by user or abort signal |
| `run_failed` | `run` failed to start (includes `sessionId` or `clientId`) |
| `startup_failed` | Sidecar failed during initialization |
| `project_locked` | Another Flecten sidecar holds `.flecten/sidecar.lock` (message includes PID and lock path) |
| `protocol` | Shell received a non-JSON line from the sidecar |

## Versioning

Breaking protocol changes bump both sidecar and app versions; mismatched clients must surface an explicit error rather than hanging silently.

## Deep Links

Installed builds handle `flecten://session/<id>?project=<absolute-path>` via the OS protocol handler. The shell validates URL scheme, session `id`, existing absolute project directory, and absence of extra query parameters, then emits `session.open` once the window connects. Opening a deep link selects the saved session without invoking the model or altering workspace trust; dev and test runs never mutate OS protocol registrations.

## Talker and Worker Events

`session.started` may carry `role: "talker" | "worker"`, plus `internal: true` when Talker wakes on an internal harness notification (preserving the user's last raw prompt untouched); external `run` commands cannot spoof either field.

`worker.event` wraps a validated Worker event under the parent chat's `sessionId` (disallowing nested `worker.event` envelopes). Scoped `call.id` (`w_<uuid>`) stays identical across `tool.started`, `tool.output`, `tool.finished` (authoritative final status and full log), and `[[id]]` card references.

`stop` with `target: "worker"` halts only Worker using `mode`, whereas plain `stop` halts both Talker and Worker loops. Child subagents keep running unless stopped explicitly via `subagent.stop` or `task` (`operation: "stop"`), while parent wait calls return immediately. `tool.cancel` resolves scoped call IDs strictly within their owning parent chat, and quitting the application terminates all child executions cleanly.
