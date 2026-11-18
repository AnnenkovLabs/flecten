# Changelog

## 0.1.5

November 18, 2026 · Alpha

**Keep talking to Flecten while it works.** Ask Talker for an update or add context while Worker continues executing. Interactive HTML answers can carry your selections into the conversation.

### New

- **Live replies during Worker runs.** Send a message directly to Talker while Worker keeps running, or use **Queue** to save it for later. Worker can ask Talker to clarify instructions already discussed in the chat.
- **Interactive HTML answers.** A report can pass a choice you make in it to the next message, or offer a button to send the choice immediately.

### Improvements

- **Easier project navigation.** Reorder project folders from the sidebar and open older chats from a separate list without expanding the whole project history.
- **Smoother desktop controls.** Settings, dialogs, and composer controls keep focus and layout steadier as they open, close, or change state.
- **Updated build requirements.** Building from source now requires Bun 1.4.4 or newer and Node.js 22.12 or newer. Desktop users do not need to install either runtime.

### Fixes

- **Provider and tool reliability.** Tightened validation of provider streams and tool arguments so incomplete calls are rejected and ambiguous edits report what needs to be corrected.
- **Chat isolation.** Follow-ups, queued messages, and interactive report choices stay associated with the chat that received them.

### Before Updating

- **Linux AppImage:** Use the **Beta** channel on `0.1.2` or newer. Older versions require a one-time manual install.
- **Windows and macOS:** Download the installer for your platform from this release if your installation cannot update in-app. Native code signing is reported by the release assets.

[Full diff from 0.1.4](https://github.com/AnnenkovLabs/flecten/compare/v0.1.4...v0.1.5)

## 0.1.4

November 17, 2026 · Alpha

**Inspect Worker progress, blockers, and verification evidence in real time while a task is running.** Talker and Worker can now run on separate models, with all role costs aggregated into a single per-chat total.

### ✨ New

- **Dedicated Worker activity feed.** Open the `Worker` tab to inspect executed commands, errors, and permission prompts. Every task checklist item shows whether it is resolved and why, separating runtime-verified command outputs from model self-assessment. Refining the task prompts Worker to re-verify which completed items still hold.
- **Per-role model configuration.** Configure separate models for the primary agent, Talker, Worker, subagents, and vision helper in **Models**. The composer model picker sets the active chat's executor, letting Talker stay on a fast lightweight model while Worker handles heavy execution.
- **Unified per-chat spend counter.** Total chat cost aggregates Talker turns, Worker execution, subagents, Twin, and auxiliary calls across restarts. When a provider omits usage receipts, the UI explicitly marks the total as incomplete.
- **Provider secret protection.** Known API key and password formats are replaced with reversible placeholder tags before context leaves the machine, while file writes and shell commands require confirmation. The provider's own connection API key is still sent to authenticate requests. See [Provider Protection](https://github.com/AnnenkovLabs/flecten/blob/v0.1.4/docs/PROVIDER-PROTECTION.md).
- **Artifact-backed build verification.** Agents can declare expected output archives or reports for a command; Flecten verifies file existence, size bounds, and optional checksums before marking the check green.

### ⚡ Improvements

- **Seamless chat and draft restoration.** Relaunching reopens the last active chat. Unsent text, `@` mentions, and attachment lists persist independently per chat and workspace.
- **Crash-resilient Worker state.** Worker persists partial progress, its last confirmed action, and stop reasons across crashes. When a remote Linux job disconnects, Flecten inspects remote process state before re-running it.
- **Compact completed stages.** Finished Worker pages compress into structured summaries with outcomes and evidence links for subsequent model turns while archiving full transcripts on disk. Nested directory instructions load on demand as files inside them are touched.
- **Chunked reads for large files and directories.** The `read` tool can resume mid-line on very long lines, the file explorer warns when directory listings are truncated, and terminal/background-job scratch files stay scoped to their chat.
- **Sharper keyboard navigation for menus and tooltips.** Closing a menu restores focus cleanly; tooltip copy is selectable and dismisses on `Esc`.
- **Interruptible Twin training.** Disabling Twin mid-import halts ingestion immediately while preserving traits already learned and keeping Twin disabled across restarts.

### 🛠 Fixes

- **Windows:** Fixed a first-launch directory-creation hang and a false storage-migration conflict when Windows resolved the same path via 8.3 short names and full names.
- **macOS:** Fixed SSH agent socket connections (including symlinked sockets) and restricted remote jobs strictly to required connection credentials.
- **Providers:** Quota exhaustion on one model no longer blocks switching to sibling models with remaining quota. Truncated OpenAI Chat tool-call streams no longer execute incomplete commands.
- **Persistence and permissions:** Event-log, config, and queue write failures now surface immediately. Session grants no longer leak into forked chats or survive security policy edits.

### 📦 Before Updating

- **Windows and Linux AppImage:** Versions `0.1.2`+ update automatically via the built-in **Beta** channel. Versions `0.1.0` and `0.1.1` require a one-time manual install.
- **macOS:** Download the Intel or Apple Silicon installer manually until Apple Developer ID signing is configured.
- **First launch with existing `.liquid` data:** Flecten verifies and migrates chats, attachments, memory, and checkpoints from `.liquid` to `.flecten` behind a dedicated confirmation screen while leaving original files untouched on disk. Interrupted migrations resume cleanly, and any conflicts display the exact backup paths.

[Full diff from 0.1.3](https://github.com/AnnenkovLabs/flecten/compare/v0.1.3...v0.1.4)

## 0.1.3

November 15, 2026

**Message branching, per-chat model selection, and stricter Twin learning.** Edit prior prompts without losing earlier branches, tailor models per conversation, and scale the desktop UI to fit your display.

### Edit and Branch Conversations

- **Edit prior messages directly in the composer.** Modify prompt text and attachments to branch the conversation from any point while keeping your unsent bottom draft separate and intact.
- **Switch freely between conversation branches.** Version switchers on edited messages restore the full downstream branch across restarts and feed the selected branch to the model.
- **Reuse persisted attachments across edits.** Keep, remove, or add files when editing a message; existing attachments hydrate from session storage even if the original source file was deleted from disk.
- **Locked history during active execution.** Editing and branch switching remain disabled while a run is in flight so active model context never mutates mid-turn.

### Per-Chat Model Selection

- **Independent model, reasoning, and variant per chat.** Switching tasks restores each chat's chosen model without altering global defaults for new chats; in-flight requests finish on the model that started them.
- **Generation-free model metadata lookup.** Adding or editing a model populates capabilities, context limits, and supported parameters from provider APIs and the built-in catalog without spending tokens on test completions.
- **Optional hourly model auto-refresh.** Enable automatic catalog refresh per provider while preserving manual capability overrides by default (with opt-in overwrite); edits saved while a refresh is in flight take precedence.
- **Offline provider setup.** Save provider URLs and API keys without a live connectivity check, then configure models manually with explicit wire-protocol selection.
- **Stricter model identity matching.** Catalog resolution accounts for canonical IDs and fine-tuned derivatives while preserving version/checkpoint distinctions and prioritizing live provider API metadata.

### More Reliable Twin Learning

- **Schema- and quote-verified trait updates.** Twin accepts raw or fenced JSON, validates every field, and verifies exact source quotes against real user messages so truncated completions or hallucinated quotes never corrupt the persona profile.
- **Atomic profile updates.** Traits, revisions, and processed-message cursors commit only after durable disk writes succeed, allowing re-imports to retry failed batches cleanly.
- **Stale-update protection on cancel or workspace switch.** Late model responses or polling ticks after disabling Twin or switching projects are discarded, and empty imports report explicitly when no new messages exist.

### Workspace Ergonomics

- **Interface zoom from 75% to 125%.** Scales typography, controls, and thread layout immediately via window profile settings, with one-click reset to `100%`.
- **Quick profile rename and settings in the sidebar.** Edit your profile name directly from the sidebar footer, with header settings fallback when the sidebar is collapsed or in IDE mode.
- **Expanded technical dictionary.** Added categories covering models, agents, benchmarks, MCP, web, CSS, infrastructure, mobile platforms, and product terms; remote updates extend built-in entries without overwriting project-local definitions.
- **Clean-slate module marketplace.** Removed bundled demo modules and implicit repository seeding while retaining custom HTTPS catalog feeds and installed-package management.

### Installation and Updates

**Linux AppImage and Windows builds on `0.1.2` can update in-app via the Beta channel** using the pinned Ed25519 key. Versions `0.1.0` and `0.1.1` still require a one-time manual upgrade, and macOS installs remain manual pending Apple Developer ID signing.

[Full diff from 0.1.2](https://github.com/AnnenkovLabs/flecten/compare/v0.1.2...v0.1.3)

## 0.1.2

November 15, 2026

**Signed GitHub updates, multi-project sidebar navigation, and unified access controls.** Streamlines everyday workspace switching and establishes Ed25519-verified auto-updates for subsequent alpha builds.

### Signed Updates from GitHub

- **Automatic alpha discovery on `beta`.** Default update channel is now `beta`, checking 10 seconds after launch and every 4 hours thereafter with exponential backoff on network errors.
- **Non-disruptive background downloads.** Updates download with live progress without interrupting active runs; apply via one-click restart or automatically on quit.
- **Pre-download Ed25519 verification.** Channel manifests are signed in CI and verified against a build-pinned Ed25519 public key, binding version, byte size, and SHA512 checksum before any installer runs. Unsigned or tampered metadata is rejected.
- **Configurable update source and behavior.** Choose channel, GitHub repository or custom HTTPS feed, auto-check, auto-download, and install-on-quit in **About**, applied immediately without restarting.
- **Downgrade protection.** Channel switches never install an older version over a newer build, even when validly signed.
- **Retroactive install-on-quit.** Toggling install-on-quit after an update has already been downloaded and verified applies immediately to the cached installer without re-downloading.

### Projects and Tasks in the Sidebar

- **Start immediately without picking a folder.** Launching without a workspace opens an isolated `projectless` directory inside the profile, keeping chats, attachments, and memory separate from code repositories.
- **Multi-project sidebar.** Switch across saved folders and their threads from one tree, restoring the last workspace on restart; removing a folder from the sidebar leaves its files and session logs untouched on disk.
- **Single-instance focus handoff.** Launching a second app instance focuses the existing window and exits before mutating the project index.
- **Explicit workspace trust.** Entering a new folder prompts for trust (`trusted` vs `untrusted`), disabling project-local executable extensions when untrusted while keeping built-in tools working.
- **Unified global desktop profile.** Providers, models, permissions, sandbox rules, and extensions now live in one profile config, migrating legacy per-project settings non-destructively while honoring explicit `FLECTEN_CONFIG` overrides.

### Unified Access and Approvals

- **Access mode selector.** Switch among `Agent`, `Confirm`, and `Full access` to coordinate permission rules and OS sandboxing while keeping custom path rules, protected paths, and mandatory human checkpoints intact.
- **Chat-scoped external folder grants.** Approving an external directory updates both tool authorization and OS sandbox writable roots for the active chat without prompting per file, re-checking revocations prior to execution.
- **Docked approval cards above the composer.** Pending approvals in both Agent and IDE modes display target actions, reasons, and decision buttons above the input, recording receipts in history and resuming execution cleanly.
- **Consolidated Access settings.** Permissions, saved rules, mandatory checkpoints, and sandbox configuration now share the **Access** tab (with legacy sandbox deep links routed automatically).

### Smoother Run Control

- **One-click Continue from the composer.** Resume stopped runs via the `Continue` button or by pressing Send on an empty input while keeping normal message send behavior when text or attachments are present.
- **Debounced run-state transitions.** Guarded transitions across `Stop`, `Force stop`, and `Continue` prevent accidental double-click races, and late responses remain bound to their originating chat and run epoch.

### Build-Once Release Pipeline

- **Parallel CI verification and packaging on `main`.** Releases promote pre-built, smoke-tested artifacts without rebuilding or re-running E2E suites at publish time.
- **Commit-bound release integrity.** Publishing verifies CI provenance, version tags, Ed25519 signatures, file sizes, and checksums; network retries resume draft uploads without overwriting published assets.

### Before Installing

**Upgrade manually once from `0.1.0` or `0.1.1` to `0.1.2`.** Earlier builds lack the pinned Ed25519 verification key and cannot accept signed auto-updates. From `0.1.2` onward, Linux AppImage and Windows builds update in-app on the **Beta** channel (explicitly selected **Stable** channels do not auto-switch). macOS installers remain unsigned and require manual installation until Apple Developer ID certificates are configured.

[Full diff from 0.1.1](https://github.com/AnnenkovLabs/flecten/compare/v0.1.1...v0.1.2)

## 0.1.1

November 14, 2026

**Shared cross-project settings, interactive Twin training, and Windows/runtime reliability fixes.**

### Configure Once Across Projects

- **Global provider and model profile.** Providers, API keys, and model selections persist across workspaces in the shared app profile while permissions, sandbox settings, MCP servers, hooks, and extension trust stay project-scoped.
- **Non-destructive config migration.** First launch imports existing provider settings and destination-bound keys without deleting legacy files; explicit `FLECTEN_CONFIG` paths continue to run isolated.

### Live Twin Training

- **Interactive phrase cards during history import.** Twin tracks, catches, and reacts to real redacted snippets from imported chats continuously across batches without resetting the WebGL scene.
- **Core-driven training progress.** Progress counters reflect verified backend ingestion (`100%` appears only on completion), supporting pause, cancel, and `prefers-reduced-motion`.
- **Ephemeral redacted previews.** Training card snippets strip known secrets before rendering and are never persisted into the Twin persona file.

### Stable Scroll, Timers, and Thread State

- **Smart streaming auto-follow.** Virtualized message loading no longer breaks bottom auto-follow, while scrolling up detaches cleanly so incoming tokens and dynamic HTML summary resizes never yank your reading position down.
- **Preserved reading anchors across long threads.** Search highlights and deferred height measurements no longer shift scroll position when switching chats.
- **Accurate elapsed and reasoning timers.** Active timers tick continuously while awaiting completions, reconstruct exact durations from event timestamps on chat reopen, and freeze once finished.
- **Reliable HTML summary updates.** Fixed stale iframe rendering when a replacement HTML document had greater or equal byte length.
- **Isolated Mermaid SVG IDs.** Multiple Mermaid diagrams in the same thread now namespace their internal SVG defs so markers and arrows never collide across messages.
- **Chat-isolated late IPC replies, single-shot modal focus restore, and atomic queue item removal** (in-flight messages can no longer be deleted mid-send).

### Startup, Recovery, and Tooling Hardening

- **Windows:** Fixed startup hang when the secrets file is absent; added bounded 1-second atomic-rename retries under transient file locks; preserved quoted paths/special characters in `cmd.exe` commands, background jobs, and hooks; framed ConPTY command completion with explicit exit codes across `cmd.exe` and PowerShell; canonicalized 8.3 short vs long paths inside sandbox checks while flushing attachments via syncable file descriptors; normalized path separators for nested `.gitignore` rules in `glob` and `grep`.
- **Studio approvals:** Bound `Allow once` confirmations to exact request IDs so brief reads and writes resume reliably.
- **Tolerant JSONL recovery:** New events append cleanly on a fresh line after a truncated tail record, preserving last-run state and interruption markers during index rebuilds.
- **Epoch-scoped sidecar stdio and lock handling:** Restarted sidecars ignore late output from superseded processes, and workspaces locked by another window surface the error once instead of crash-looping.
- **Process-tree and Git shadow cleanup:** macOS run cancellation tracks detached child processes via environment markers, and app shutdown awaits background shadow-Git indexing and checkpoint pruning before releasing workspace locks.
- **Terminal output retention and post-checkpoint cancellation:** Fixed lost leading command output after ANSI stripping or scrollback trimming, and re-checked `AbortSignal` immediately after checkpoint creation so cancelled `write`, `edit`, `apply_patch`, `delete`, and `move` calls abort before mutating files.
- **Provider rate-limit metadata, SSE line endings, and MCP redirect safety:** Surfaced HTTP status, reset timestamps, and quota headers to adapters; supported split `LF`/`CR`/`CRLF` boundaries in SSE streams; blocked cross-redirect MCP request forwarding while closing SSE streams on handler errors.

### Leaner Model Context

- **Focused system prompts.** Removed duplicated tool-schema field prose and unused prompt templates while preserving role boundaries, trust rules, and completion contracts.
- **Removed built-in `git` and `lsp` tools (18 built-in tools total).** Git runs directly via terminal tools, and legacy `lsp` config sections strip cleanly during migration.

### Releases and Packaging

- **Automated GitHub Pre-releases.** CI drafts release notes from `CHANGELOG.md`, runs verification and builds, and attaches Linux, Windows, and dual-architecture macOS (`x64` + `arm64`) installers, blockmaps, SBOMs, and checksums (leaving failed builds as unpublished drafts).

### Before Updating

Flecten remains in alpha. In-app auto-updates require Ed25519-signed channel metadata plus Apple Developer ID signing on macOS; shipping an installer alone does not imply auto-update signing is active.

[Full diff from 0.1.0](https://github.com/AnnenkovLabs/flecten/compare/v0.1.0...v0.1.1)

## 0.1.0

November 13, 2026

**First public alpha of Flecten:** a desktop coding harness pairing a Bun sidecar core, Svelte 5 UI, and Electron shell (incorporating all prior pre-release work).

### Workspace

- Unified Agent and IDE modes per task with CodeMirror editor, diff viewer, run history, interactive terminal, and dirty-buffer protection during agent edits.
- Split Talker and Worker roles over a shared event log, alongside Twin user-preference modeling, project memory, and technical term dictionary.
- Four provider protocols (OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and Gemini) with catalog import, connectivity probes, auth refresh, and model failover.
- Seven UI locales, sandboxed live HTML summaries, copyable code blocks, Mermaid diagrams, and line-numbered file previews.
- Voice dictation via cloud API or offline `Vosk` / `faster-whisper`, plus image, PDF, and audio attachments.

### Long-Running Execution and Recovery

- Concurrent session pool, persistent message queue, mid-run steering, background shell jobs, and independent subagent tabs.
- Durable `events.jsonl` log, crash recovery across sidecar/window restarts, and content-addressed attachments surviving compaction, queuing, and chat forks.
- Structured Worker context pages and archives, token/cost/wall-clock budgets, and bounded tool outputs linked to full disk logs.
- Git-independent file and shell checkpoints with `/undo`, portable session exports, retention policies, and trash.
- Virtualized long threads with history search, preserved reading anchors, and streaming auto-follow.

### Extensions and Security

- Agent Skills, MCP over `stdio` and Streamable HTTP with OAuth PKCE, elicitation forms, and resource catalogs, plus hot-loadable SDK modules.
- SHA-256 content trust for extensions (invalidated automatically on package mutation) and durable replay of skill `allowed-tools` restrictions.
- Layered PermissionEngine, OS sandboxing, interactive approvals, and `failClosed` hooks; subagents can never escalate beyond parent permissions.
- Pre-log and pre-IPC secret redaction (including cross-chunk stream boundaries) plus project- and destination-bound credentials.
- Atomic writes for configs, queues, and caches, paired with redacted diagnostic bundles and opt-in counter telemetry.

### Packaging and CI

- Renamed to Flecten (`flecten.config.json`, `FLECTEN_*` env vars, `flecten-agent` binary) with legacy-name migration compatibility.
- Linux AppImage, macOS DMG/ZIP, and Windows NSIS installers with packaged smoke tests, SBOMs, and SHA checksums.
- Ed25519-signed update manifests verifying version, SHA512, and installer byte size, rejecting unsigned feeds.
- Cross-platform CI across Linux, macOS, and Windows enforcing an 85% line-coverage gate, docs-as-code checks, and visual regression at 1480x940 and 1180x640.

[0.1.0 source tree](https://github.com/AnnenkovLabs/flecten/tree/v0.1.0)
