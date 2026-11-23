# Repository Structure

One file, one responsibility. Soft limit: 300 lines; hard limit: 500 lines. Directories group domains; files split by responsibility.

## Localization

`ui/src/lib/i18n.svelte.ts` holds the active locale and interpolates values into catalog strings. `ui/src/lib/i18n/locales.ts` defines the seven supported locales with English as default. Message catalogs are partitioned by UI domain under `ui/src/lib/i18n/messages/`. `shell/dialog-copy.mjs` provides native close-dialog copy. The marketing site uses `web/i18n.js` and `web/locales/`, and translated READMEs live in `docs/i18n/`.

## Backend

| Path | Responsibility |
|---|---|
| `src/app/server.ts`, `server-handlers.ts` | Sidecar JSONL protocol, command schema validation, and responses |
| `shared/storage-migration.ts`, `src/app/storage-bootstrap.ts`, `src/store/storage-migration/` | Mandatory startup migration gate, typed progress, verified originals, resumable publication, and durable acceptance |
| `ui/src/components/StorageMigration.svelte`, `ui/src/lib/run/storage-migration.svelte.ts` | Non-dismissible migration screen, error retry, and handoff to live runtime status |
| `shared/twin*.ts`, `src/twin/`, `src/app/twin.ts`, `twin-handlers.ts`, `session-twin.ts` | User clone persona, filtered history sources, agentic trait learning, live Taste-style observation, background mid-work/summary barge-in, and typed dialogue; see [TWIN.md](TWIN.md) |
| `src/app/service.ts`, `service-types.ts` | Dependency wiring and public application API |
| `shared/access-mode.ts`, `src/app/access.ts` | Shared access-mode catalog, custom-policy detection, and validated security config updates |
| `src/app/conversation.ts`, `conversation-options.ts`, `worker-tool.ts`, `worker-references.ts` | Independent Talker/Worker sessions, routing, role models, scoped references, and Worker events |
| `src/app/conversation-budget.ts`, `single-session.ts`, `twin-accounting.ts`, `src/core/session/run-accounting.ts` | Shared durable chat budget, primary and auxiliary call accounting, and missing-receipt tracking |
| `src/app/worker-recovery.ts`, `conversation-restore.ts` | Operational Worker recovery, session handles, uncertain side effects, and persisted partial progress |
| `src/app/session-pool.ts`, `recovery.ts`, `session-replay.ts` | Concurrent sessions, crash recovery, and model history reconstruction |
| `shared/model-choice.ts`, `src/app/session-models.ts`, `session-model-options.ts` | Per-chat model, reasoning, and variant selection, durable restore, and resolved provider transport options |
| `src/app/event-journal.ts`, `session-logs.ts` | Cursor-based live event replay and durable JSONL persistence |
| `src/app/session-history.ts`, `session-export.ts` | Retention policy, trash, and portable session export |
| `shared/message-branches.ts`, `src/store/events/branches.ts`, `src/app/message-branches.ts`, `message-attachments.ts`, `session-pages.ts` | Typed message revisions, reused stored attachments, append-only branch selection, branched continuations, and branch-scoped page archives |
| `src/app/extensions.ts`, `extension-runtime.ts`, `extension-handlers.ts` | MCP/skill lifecycle and UI elicitation requests |
| `src/app/provider-state.ts`, `provider-ops.ts`, `provider-secrets.ts` | Provider status projection, connectivity probes, catalog sync, and secret redaction |
| `src/app/provider-auto-refresh.ts`, `src/providers/actualize.ts`, `shared/model-draft.ts`, `ui/src/components/ProviderModelRefresh.svelte` | Hourly model metadata refresh, baseline-preserving manual overrides, open-draft reconciliation, and per-provider settings |
| `src/config/` | Schema versions, migrations, Zod schemas, defaults, unified global desktop profile, scoped secrets, destination binding, and atomic writes |
| `src/core/session/` | Canonical session lifecycle, budgets, approvals, run start/stop, and typed events |
| `src/core/loop/` | Model stream consumption, tool batches, continuation, retries, and emergency compaction |
| `src/core/loop/external-access.ts`, `tool-authorization.ts` | Canonical external-directory scopes, chat-wide grants, pre-execution authorization, and logical/OS sandbox updates |
| `src/core/pages/`, `src/context/` | Typed Worker page lifecycle, archive port, structured summaries, tokenizers, context budget, and pruning |
| `src/tools/context/run.ts`, `src/store/pages.ts` | `begin`/`complete`/`list`/`read`/`search` context tool and durable segment archive with restore and fork copy |
| `src/core/queue/`, `goal/`, `subagents/` | Session message queue, goal tracking, and subagent runtime |
| `shared/hooks.ts`, `src/core/hooks/`, `src/app/hook-test.ts` | Shared hook event catalog and schemas, matcher/executor, and draft dry-run runner; see [HOOKS.md](HOOKS.md) |
| `src/core/subagents/tasks.ts`, `result.ts`, `src/app/subagent-report.ts` | Independent child task lifecycle, report schema validation, and single tool-free `submit_report` repair pass |
| `src/core/memory/` | Main-model `memory` tool, topic catalog, batch reads, quote/source verification, schemas, pre-request delivery, and revision visibility |
| `src/app/memory.ts`, `src/store/memory.ts`, `memory-mutations.ts` | Workspace-shared `MemoryPort`, CAS updates, atomic reconciliation, metadata cache, audit trail, and legacy migration |
| `shared/dictionary.ts`, `src/dictionary/`, `src/app/dictionary.ts` | Term schemas, remote category sync, surface-form matching, and project-local memory overrides |
| `src/core/types/` | Message, event, tool, command, and result types |
| `src/core/attachments.ts`, `media.ts`, `audio-duration.ts`, `image.ts` | Multimodal content parts, modality checks, image magic-byte detection, and media token estimation |
| `src/app/vision.ts`, `src/core/session/vision.ts`, `src/core/loop/vision.ts` | Vision helper selection, image description fallback for text-only models, caching, and cost accounting |
| `src/skills/` | Skill discovery, SHA-256 trust, catalog, activation, `allowed-tools` scoping, resources, and replay |
| `src/mcp/` | SDK transports, OAuth PKCE, health checks, tool/resource/prompt catalogs, and elicitation |
| `src/connectors/x/` | Standalone HTTP MCP server for X in ChatGPT, OAuth bridge, encrypted token store, and read-only X API client |
| `src/modules/`, `src/core/modules/`, `src/app/modules.ts` | SDK/MCP module bundles, session/project platform services, hot-loading, dependency graph, trust, and append-only context |
| `src/modules/marketplace.ts`, `marketplace-download.ts`, `shared/module-marketplace.ts` | Built-in and HTTPS module catalogs, package verification, dependency resolution, and marketplace IPC |
| `src/marketplace/index.json` | Empty built-in catalog compiled into the binary with no implicit remote seeding |
| `src/core/services/`, `src/app/session-storage.ts` | `replace`/`wrap`/`provide`/`require` typed service container, leases, and unified event-log/index storage |
| `src/core/types/event-schema.ts` | Shared Zod event schemas for native drivers and durable log readers |
| `src/commands/` | User-level and project-level slash commands |
| `src/security/provider-protection.ts`, `src/security/provider-secrets/`, `shared/provider-protection.ts` | Per-provider secret tagging, reversible placeholders, and bounded response checks; see [PROVIDER-PROTECTION.md](PROVIDER-PROTECTION.md) |
| `src/providers/gateway-detection.ts`, `gateway-signals.ts` | Unauthenticated detection of public New API / One API gateway signatures |
| `src/providers/` | Four protocol adapters, HTTP/SSE transport, auth helpers, model catalog, probes, discovery, and failover |
| `src/providers/model-metadata.ts`, `ui/src/lib/settings/model-metadata.ts` | Generation-free model capability/limit lookup from provider APIs and catalog |
| `src/providers/model-identity.ts` | Canonical model ID matching, aliases, and uncensored/abliterated derivatives while preserving version/checkpoint distinctions and API precedence |
| `src/translation/`, `src/app/translation.ts` | Streaming Markdown/text node translation, bounded cache, session agent language, localized view projection, and provider routing |
| `src/tools/` | Tool registry, argument repair, output budgets, log persistence, and built-in tools |
| `src/tools/catalog.ts`, `registry.ts` | Explicit per-session MCP schema activation and restoration across compaction and checkpoints |
| `src/tools/jobs/remote.ts`, `remote-runner.py`, `ssh-capability.ts` | Durable remote Linux jobs, process identity verification, reconnect, and scoped SSH agent access |
| `src/tools/util/scratch.ts`, `src/security/session-grant.ts` | Session-scoped scratch directories and owner/policy-versioned grants |
| `src/tools/grep/line-matcher.ts`, `glob/gitignore.ts`, `read/run.ts` | Interruptible regex worker, nested `.gitignore` scopes, and mid-line/byte-bounded file reads |
| `src/terminal/` | Persistent PTY, background jobs, process-tree termination, and resource monitors |
| `src/terminal/command-completion.ts` | Explicit shell command framing with nonce, exit code, and intact line endings across ConPTY/POSIX |
| `src/terminal/process-scope.ts`, `native-processes.ts`, `windows-processes.ts` | Inherited Linux process markers, POSIX process/socket metrics, and schema-validated Windows CIM snapshots |
| `src/security/` | PermissionEngine, workspace trust, OS/logical sandbox, protected paths, and secret backends |
| `src/security/shell-paths.ts`, `src/tools/util/mutation-path.ts` | Lexer-driven shell path extraction and pre-mutation canonical path re-verification |
| `src/store/` | Durable event log, message queue, page archives, memory store, and file/shell checkpoints |
| `src/util/abort.ts`, `mutex.ts`, `atomic.ts` | Abortable IO waits, async mutexes, and deadline-bounded atomic file writes |
| `src/observability/` | Bounded structured logs, counters, trace IDs, crash reports, diagnostic bundles, and opt-in telemetry |
| `src/util/`, `src/errors/` | Pure utility helpers and typed error hierarchy |

## Window and UI

| Path | Responsibility |
|---|---|
| `shell/main.mjs` | Electron lifecycle, window management, and sidecar process supervision |
| `shared/project-index.cjs`, `shell/projects.mjs`, `src/app/project-list.ts`, `project-trust.ts` | Saved workspaces, canonical trust state, active workspace switching, and cross-project session listing |
| `shell/preload.cjs`, `agent-commands.json` | Validated `window.desktop` IPC bridge and command allowlist |
| `shell/deep-links.mjs`, `window-state.mjs` | Deep-link session routing and monitor-aware window bounds restoration |
| `shell/updater.mjs` | Ed25519-verified update loop: scheduled checks, background download, and restart/quit installation |
| `shell/github-update-provider.mjs` | GitHub Releases feed resolver: latest published release and signed channel manifest lookup |
| `shell/update-runtime.mjs` | Shell updater controller wiring feed, runtime status settings, and IPC |
| `shell/update-policy.mjs`, `shared/update-settings.cjs` | Channel/feed/backoff policy and shared update settings normalization across sidecar and shell |
| `ui/src/App.svelte` | Top-level screen composition and global keyboard shortcuts |
| `ui/src/components/ProjectNavigation.svelte`, `ProjectTrust.svelte`, `ProjectGroup.svelte`, `ui/src/lib/run/projects.svelte.ts` | Sidebar project/session tree, folder context menu, and workspace trust prompt |
| `ui/src/app.css` | Single source of design tokens, font declarations, and base styles |
| `ui/src/lib/interface-scale.svelte.ts`, `ui/src/lib/appearance.svelte.ts`, `components/settings/AppearanceSettings.svelte`, `ScaleSlider.svelte` | Window-persisted interface zoom (75-125% via `webFrame`), reading text scale, HTML summary scale, chat width, and code/terminal font sizes |
| `ui/src/controls.css` | Shared button, input, and toggle primitives across surfaces |
| `ui/src/custom-controls.css`, `ui/src/components/controls/`, `ui/src/lib/tooltip.ts` | Custom checkbox, slider, progress, keyboard-accessible select/combobox, and `data-tooltip` floating layer |
| `ui/src/lib/modal.ts`, `clipboard.svelte.ts` | Unified modal focus/escape lifecycle and confirmed clipboard copy |
| `ui/src/lib/run.svelte.ts`, `run/` | Renderer state projection from canonical sidecar events and IPC responses |
| `ui/src/lib/run/model.ts` | Per-chat model state, global defaults separation, and serialized updates immune to stale cross-chat responses |
| `ui/src/lib/run/message-history.svelte.ts`, `composer/drafts.svelte.ts`, `composer/attachment-draft.ts` | In-composer message editing, isolated edit vs new-message drafts, and chat-bound async attachments |
| `ui/src/lib/composer/draft-storage.ts` | Schema-validated per-chat/per-project composer draft persistence, throttled writes, lifecycle flush, and last-chat restore |
| `ui/src/lib/updater.svelte.ts` | Reactive update status store shared by header pill and About settings card |
| `ui/src/lib/tool-presentation.ts`, `subagent-report.ts` | Human-readable tool labels/states and validated subagent report presentation |
| `ui/src/lib/run/subagents.svelte.ts`, `SubagentPane.svelte`, `SubagentAvatar.svelte` | Dedicated subagent tabs, live logs, independent stop controls, and deterministic subagent avatars |
| `ui/src/lib/agent-protocol.ts`, `types.ts` | Renderer IPC contract and UI view types |
| `ui/src/lib/settings.svelte.ts`, `settings/` | Validated settings drafts, provider connectivity checks, and dirty-state tracking |
| `ui/src/lib/settings/modules.svelte.ts`, `components/settings/ModuleMarketplace.svelte`, `InstalledModules.svelte` | Module catalog browsing, installation, custom HTTPS feeds, and installed package management |
| `ui/src/lib/ide.svelte.ts`, `ide/` | Editor state, tabs, syntax tree, selection symbols, and sidecar-backed file saves |
| `ui/src/lib/thread-*` | Virtualized thread windowing, height measurement, and scroll-anchor preservation |
| `ui/src/components/` | Svelte 5 components driven strictly by props and `ui/src/lib` stores |
| `ui/src/components/settings/` | Settings sections: providers, trust, MCP, hooks, skills, modules, and diagnostics |
| `ui/src/components/permissions/`, `settings/PermissionsSettings.svelte`, `settings/SandboxSettings.svelte` | Unified Access view: modes, saved rules, action permissions, and OS sandbox settings |
| `ui/src/components/ApprovalDock.svelte`, `ApprovalCard.svelte` | Pending approval dock above chat and IDE composers with action buttons and persisted history receipts |
| `ui/src/components/ide/` | File tree, Monaco editor, and diff views |

`shared/session-state.ts` defines the shared schema for lifecycle snapshots across backend and renderer.

## Prompts, Tooling, and Verification

- `prompts/`: System prompt Markdown, capability sections, role contracts, and completion protocols; `memory.md`, `memory-checkpoint.md`, and `tool-description-memory.md` define the memory contract.
- `scripts/`: Build pipelines, lint/architecture rules, docs-as-code checks, coverage, performance benchmarks, packaged smoke tests, and release tooling.
- `bench/`: 20 deterministic harness tasks, local mock provider, runner, Codex CLI baseline adapter, and generated reports.
- `tests/unit/`, `tests/integration/`, `tests/smoke.test.ts`: Tests exercising real services and protocol adapters against local fixtures.
- `tests/e2e/`: Headless Electron suite with a local mock provider covering core user journeys and visual regression at 1480x940 and 1180x640.
- `tests/fixtures/modules/`: Reference SDK module packages kept exclusively for tests rather than shipped in builds; `computer-use/` exercises Linux Computer Use (session control, private Xvfb/D-Bus display backend, bounded AT-SPI tree, instructions, and Computer surface) via `tests/integration/computer-use.test.ts`.
- `.github/workflows/`: Reusable quality gates, text/LCOV coverage, Electron visual regression, per-OS packaged smoke tests, signing/release pipelines, and diagnostics.
- `docs/`: Architecture, decision log, wire protocol, security model, and acceptance reports; `docs/research/access-ux-2026-11-14.md` records upstream versions and sources for the permissions UX design.

`docs/MEMORY.md` specifies the memory runtime and token budgets. `src/tools/memory/run.ts` implements the `memory` tool, while compaction checkpoints piggyback on `src/core/pages/writer.ts` without an extra model round-trip.

## Data Flow

1. Electron spawns the sidecar in the selected workspace or in the profile's `projectless` workspace; the sidecar acquires `.flecten/sidecar.lock`.
2. `app` loads config, secrets, instructions, and extensions, then constructs the tool/provider registries and `SessionPool`.
3. The renderer dispatches allowlisted commands through `preload.cjs`; it never reads files or calls models directly.
4. `core/session` drives the run loop, message queue, approvals, and tools, emitting typed events.
5. `app` redacts secrets, fsyncs durable event records, and publishes to the in-memory live journal; the renderer receives session-tagged, sequenced events.
6. `run.svelte.ts` projects UI state and reconciles canonical snapshots on IPC completion; reopening a chat hydrates from `events.jsonl`, `events.replay`, and live status.

## Module Boundaries

- `core` never imports `ui`, `shell`, or `store`; persistence enters via explicit ports and callbacks.
- `ui` never imports `core`, `store`, or `tools`; components consume props and helpers from `ui/src/lib`.
- `shell` owns OS windowing, IPC transport, and process supervision, with zero harness logic.
- `providers` translates canonical messages and tool schemas into wire protocols without knowing about the agent loop.
- `tools` validates schemas, permissions, and canonical paths prior to execution; all tool output is treated as untrusted data.
- `app` wires domain ports together; new domain capabilities belong in dedicated modules rather than growing `service.ts`.

IDE workspace services: `workspace-files.ts` validates file operations, `workspace-search.ts` runs workspace search, `workspace-replace.ts` applies verified replacement plans, `workspace-git.ts` wraps Git operations, and `ide-terminal.ts` owns the user's interactive PTY. In the renderer, `ide/commands.ts` defines commands and keybindings, `layout.svelte.ts` persists layout preferences, `search.svelte.ts` manages search/replace state, and `git.svelte.ts` projects Git status. IDE components receive workspace state via props and never touch the filesystem directly.

Talker/Worker UI: `ui/src/lib/run/worker.svelte.ts`, `markdown/tool-references.ts`, `WorkerPane.svelte`, and `MirroredMarkdown.svelte` render split Talker and Worker sessions. Both reuse `ThreadView` and `Thread.svelte` for messages, reasoning, tool rows, and live indicators, while keeping the composer exclusively in the Talker conversation.

Twin UI: `ui/src/components/twin/` (including `TwinBlob.svelte`), `ui/src/lib/twin.svelte.ts`, and `ui/src/lib/run/twin-view.svelte.ts` present Twin sources, traits, training progress, dialogue turns, and 3D furry rounded-rectangle chat blobs. `ui/src/lib/twin/` isolates the rig, interactive scene lifecycle, and WebGL2 renderers (`renderer.ts` for the 3D character mesh and `blob-renderer.ts` / `twin-blob.frag` for 3D furry chat message blobs), while `scripts/twin/render-assets.mjs` pre-renders static fallbacks into `ui/public/twin/` from the same canonical shader.
