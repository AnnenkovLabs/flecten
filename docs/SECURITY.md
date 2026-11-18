# Security

## Trust Boundaries

The user controls all permissions. Model outputs, workspace files, web content, MCP servers, and extension payloads are treated as untrusted inputs: tool arguments, configuration files, wire events, and upstream responses are validated with Zod schemas at every boundary before use.

The renderer never reads local files or calls LLM APIs directly. Electron's main process allowlists IPC channels, verifies sender frames, and spawns the Bun sidecar over `stdin`/`stdout` (there is no local bearer-token HTTP server; OAuth loopback listeners bind `127.0.0.1` exclusively during an active user-initiated login).

Opening a folder presents a full-screen workspace trust prompt stored per canonical path in profile `projects.json` (changeable anytime from the workspace menu; dismissing the dialog leaves trust `unknown`, while rejecting requires explicit confirmation). Untrusted workspaces disable project hooks, project MCP servers, and executable project modules while keeping built-in tools subject to standard permissions and sandboxing.

When running without an open workspace (`projectRoot: null`), the sidecar runs inside its profile directory, skips project `AGENTS.md`, skills, and custom commands, disables shadow Git, and enforces external-path checks on every filesystem access.

## Secrets Management

- **Credential sources** (in precedence order): environment variables, OS keychain, mode-`0600` fallback file (`.flecten/secrets.json`), and explicit auth commands. The renderer receives only `{ isSet, source }`.
- **Scope binding**: keychain entries bind to the canonical scope path (desktop profile or explicit project config), and stored provider API keys additionally bind to `{ protocol, baseUrl, proxy }` so changing an endpoint URL never leaks an existing key to a new host. Legacy unbound keys stay untouched on disk without auto-populating requests until re-entered.
- **Filesystem hygiene**: `.flecten/secrets.json` and atomic staging files use mode `0600`; `.env*`, `.flecten/`, `.liquid/`, logs, and private exports are git-ignored.
- **Streaming redaction**: runs prior to live UI events, listeners, replay buffers, and full tool logs, scrubbing configured secret values as well as AWS, Google, GitHub, Bearer, JWT, and PEM credentials even when split across stream chunks.

Per-provider secret protection, reversible secret placeholders, and mandatory human checkpoints are detailed in [PROVIDER-PROTECTION.md](PROVIDER-PROTECTION.md).

## Access Modes, Permissions, and Protected Paths

Fresh configurations default to `agent` mode: workspace reads, writes, shell commands, network access, MCP calls, and skills run inside the OS sandbox (with network enabled), while accessing external directories or running destructive shell commands prompts for confirmation. Existing saved project configs are never silently rewritten.

`shared/access-mode.ts` defines three presets synchronized across permissions and sandbox settings (`access.set` accepts `agent | confirm | full`, reporting `custom` whenever baseline fields diverge):

- `agent`: standard development inside the workspace and approved directories with OS sandboxing active.
- `confirm`: prompts before file writes, shell commands, and MCP tool calls.
- `full`: allows baseline action categories and disables OS process sandboxing and `SandboxPolicy` path guards. Explicit `deny` rules and mandatory human checkpoints still override `full` mode and saved session grants.

When `SandboxPolicy` is active, canonical paths and symlinks are resolved before every read or write, protecting `.git`, `.flecten`, `.liquid`, `flecten.config.json`, `AGENTS.md`, `secrets.json`, `.env*`, `~/.ssh`, and `~/.aws`. Accessing an external path prompts on its canonical containing directory (or nearest existing parent directory for new files), serializing concurrent prompts for the same directory:

- `allow_once`: authorizes only the prepared invocation without persisting a rule.
- `allow_session`: caches directory read/write scope in memory for the current chat (shared across Talker, Worker, and subagents of that chat, never across other chats or forks) and extends both the logical sandbox and OS sandbox `writablePaths`.
- `allow_always`: persists an `external_path` rule with `pathPrefix` in global config.

Targets, symlinks, and explicit `deny` rules are re-checked immediately before execution; editing permission rules invalidates active session grants. Model-supplied `why` strings explain intent in UI prompts without granting access, and shell approvals bind to exact command arguments, `cwd`, and touched resources rather than turning into command-prefix allowlists.

Pending approval prompts subscribe to live `PermissionEngine` and parent-policy updates: if a rule change or newly saved grant now permits the call, it resolves with `by: "policy"` (`allow_once`); if newly blocked, it resolves `deny` (`by: "policy"`); `ask` and human checkpoints stay pinned above the composer until answered, timed out, or cancelled, recording durable receipts in chat history.

Destructive shell commands are detected by a dedicated shell lexer rather than regex heuristics. File checkpoints store pre/post-images and shell commands snapshot into an isolated shadow Git repository without touching `.git`; `/undo` skips config and secret files unless explicitly requested (`includeProtected`) and aborts cleanly if checkpoint lock/write budgets expire rather than writing partial manifests.

## Untrusted Context and Sandboxed UI

Outputs from file reads, web tools, MCP servers, and shell commands are wrapped in fenced `Untrusted data` Markdown blocks annotated with provenance, keeping prompt-injection payloads subordinate to system and user instructions.

HTML summaries render inside an opaque-origin `sandbox="allow-scripts"` iframe (`flecten-summary://shell`) with network and nested frames blocked; user interactions pass only schema-validated named values back to the sidecar as untrusted context without granting tool permissions. Markdown output is sanitized and Mermaid diagrams retain plain-text fallbacks.

## MCP, Hooks, and Modules

Project-scoped MCP servers, command hooks, and modules run only in trusted workspaces with allowlisted environment variables. Upstream MCP `readOnlyHint` annotations grant no privileges. MCP servers default to a `60s` (`60000` ms) request timeout and `64` tools per server (`maxTools`, configurable up to `128` max); see [EXTENSIONS.md](EXTENSIONS.md).

Command and HTTP hooks default to a `10s` (`10000` ms) timeout up to a `60s` (`60000` ms) maximum, capping `stdin`/`stdout`/`stderr` at 64 KiB. Hooks with `failClosed: true` (mandatory in strict mode) block interceptable events on errors, timeouts, or malformed JSON, while async observer hooks cannot undo completed operations ([HOOKS.md](HOOKS.md)).

Modifying any byte of a trusted module invalidates its SHA-256 trust immediately on the next boundary ([MODULES.md](MODULES.md)). Child subagents execute under the strict intersection of their own permissions, parent permissions, and active parent skill `allowedTools`, rejecting any call that would require interactive approval.

## Process Isolation and Resource Guards

`bash`, background `jobs`, and persistent PTYs share a process-tree monitor tracking RSS memory, process count, and open ports, killing the entire tree on stop or timeout:

- **Linux**: `bubblewrap` OS sandbox (when installed), `procfs` + `prlimit`, and inherited process-scope markers tracking descendants across `setsid`/reparenting (verified in headless Electron E2E across `SIGKILL`).
- **macOS**: `Seatbelt` (`sandbox-exec`) when available, plus `ps` RSS and `lsof` socket ownership.
- **Windows**: Bun `1.4.2` ConPTY, `no-orphans` kill-on-close Job Object, async CIM snapshots validated by Zod (halting on malformed telemetry rather than reporting zeroes), and `taskkill /T` (per-command AppContainer and resource Job Objects are not wired in yet; native Windows/macOS acceptance remains tracked separately from Linux CI).

Missing OS sandbox binaries are surfaced explicitly in `status`. `grep`'s JS regex fallback runs inside a cancellable worker thread with a hard deadline to prevent ReDoS stalls, and `read` bounds long-line buffering while rejecting FIFOs and device files.

## Auditability, Session Grants, and SSH

Logs and diagnostics stay local under `.flecten/`, telemetry is opt-in counters-only ([PRIVACY.md](PRIVACY.md)), new dependencies require decision-log entries, `bun audit` runs in CI, and auto-updates verify pinned Ed25519 signatures plus SHA-512 installer hashes before user-triggered installation ([RELEASE.md](RELEASE.md)).

Durable `allow_session` resolutions record canonical scope/request hashes, owner session, and policy epoch in `approval.resolved`: replay restores grants only within that exact chat and policy epoch, never across new chats, forks, or legacy unhashed events.

SSH resource analysis inspects local key/config flags, redirections, command substitutions, and local `ProxyCommand` arguments while treating remote `argv` as an opaque payload; scoped SSH preflight forwards only the live `SSH_AUTH_SOCK` and verified target `known_hosts` entries into guarded calls without exposing private keys or `~/.ssh`.
