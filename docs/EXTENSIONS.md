# Extensions

## Task-Scoped Modules

The `module` gateway bundles an SDK runtime, MCP servers, instructions, lazy resources, hooks, and custom HTML surfaces into a single package. Agents activate modules per chat; hot-loading appends updated context to the tail of the conversation history while keeping the system prompt prefix and provider tool definitions byte-stable. Package layout, SDK contracts, trust, and cache invariants are documented in [MODULES.md](MODULES.md). Standalone skills, MCP servers, and hooks remain configurable directly in Settings. The experimental `plugins` system has been removed: legacy `plugins` keys in config files are ignored on load and omitted on the next save, while previously installed files stay untouched on disk and are never auto-converted into modules.

Status as of `2026-11-10`: all extension paths run through standard sessions, the shared tool registry, the permission engine, durable events, and context budgeting. Settings surface discovery roots, trust state, and connection health. Adding any new npm dependency requires a decision-log entry.

## Skills

A skill is a directory containing `SKILL.md` with YAML frontmatter and Markdown instructions. Only names and short descriptions enter the initial catalog; the full body loads on explicit slash invocation or a `skill` tool call.

| Scope | Discovery roots (highest priority last or per override rule below) |
|---|---|
| Built-in | Bundled in `prompts/skills` (`convert-plugin`, `self-config`, enabled by `skills.builtin: true`) |
| User | `~/.claude/skills`, `~/.agents/skills`, `~/.flecten/skills` |
| Project | `.claude/skills`, `.agents/skills`, `.flecten/skills` |

Project skills override user skills, and user/project skills override built-in skills of the same name. Within each scope, `.flecten` overrides `.agents`, which overrides `.claude`; shadowed definitions are reported in diagnostics. `skills.sources` enables folder discovery roots individually (`[]` disables folder discovery), while `skills.builtin` toggles Flecten's built-in skills (`true` by default). Bundled skill reference/playbook files load on demand via `skill({ name, resource })` without entering the initial system prompt.

- Skill catalogs refresh before each new run and when opening the slash menu; an active run keeps its snapshot until a safe boundary.
- Project trust is verified before loading a skill body. Settings let users allow or block individual skills and inspect their source, revision, and bundled files.
- Repeated activations are deduplicated. `allowed-tools` narrows the session tool registry (restored on reopen from durable tool events) and never expands permissions.
- When a model batches `skill` activation alongside another tool call in the same turn, the activation constraint applies before subsequent calls in that batch.
- `SKILL.md` is capped at 256 KiB and the catalog at 200 skills, with separate prompt-budget caps on catalog listings and descriptions.
- The resource browser previews regular UTF-8 text files inside the skill directory after canonical-path, symlink, depth, file-count, and size checks; previewing never executes code.

## MCP

MCP integration uses `@modelcontextprotocol/client` `2.4.0` for modern/legacy protocol negotiation, schema validation, timeouts, and cancellation. `protocol: "auto"` supports servers requiring legacy initialization.

Servers connect over `stdio` (`command`, `args`, `env`) or Streamable HTTP (`url`, auth). Saving MCP settings hot-reloads connections without restarting the app. Executable project-scoped MCP definitions require project trust.

MCP settings display:

- connection state, health, discovered tools, and last-connected timestamp;
- `allowTools`, `readOnly`, request timeout, and context budget;
- manual reconnect, redacted `stderr` tail, and error diagnostics;
- resources, resource templates, and server prompts.

`list_changed` notifications refresh catalogs live. Tool names are namespaced as `mcp_<server>_<tool>` and checked by SDK schemas, the permission engine, and the shared registry. Upstream `readOnlyHint` annotations grant no extra permissions; setting `readOnly: true` on a server blocks all its tools while keeping resource reads and prompts available.

External MCP tool schemas load lazily on demand: `tool_catalog` with `operation: "list"` lists names and descriptions, and `operation: "activate"` with `names` enables up to 128 tool schemas in the current chat starting on the next model request. Activated names persist across reopen, compaction checkpoints, model switches, and catalog refreshes as long as those tool names remain available; each chat and role maintains its own selection. Schema activation grants no execution privilege: permissions, hooks, `readOnly`, and input validation still run on every invocation.

Users can attach MCP resources via `@` with provenance and bounded text, or invoke MCP prompts as slash commands; models also receive `read_resource` and `use_prompt`. Server instructions and outputs are treated as untrusted data under strict tool-count, schema-size, and context-budget limits. Binary blobs are never dumped into prompts as raw base64.

### OAuth and Elicitation

Streamable HTTP uses SDK OAuth discovery, PKCE, a loopback callback listener, issuer/state validation, and automatic token refresh. The UI presents a consent prompt and opens the browser URL only on explicit user action. Tokens stay in the backend secret store (OS keychain when available, mode-`0600` file fallback) and never reach the renderer alongside auth headers or credential commands.

Elicitation works over both `stdio` and HTTP: the UI renders a form from the validated server schema with submit, cancel, timeout, and session-abort handling, and validates the response before returning it to the server. MCP `sampling` is not implemented.

## Hooks

Named command and HTTP hooks are configured via form controls: lifecycle event, literal match conditions, shell command or URL, failure policy, and timeout. `shared/hooks.ts` is the single source of truth for hook events, schemas, and capabilities across core and UI. Newly created form actions default to `responseFormat: "text"`, while `"json"` is selected explicitly when returning `decision`, `reason`, or `additionalContext`; omitting `responseFormat` preserves legacy JSON semantics.

Draft hooks can be dry-tested before saving through the production runner with a typed sample payload; non-matching conditions short-circuit without spawning a command or HTTP request. Recent-run history records the last 50 real executions in the active task, reconstructs from `hook.finished` on replay, and stays separate from manual editor test runs. Command hooks run through shared terminal helpers with an environment allowlist, timeout, cancellation, and bounded output; HTTP hooks send `POST` requests with redirects disabled.

Exit code `2` or `decision: "deny"` blocks interceptable events; transport/process failures block when `failClosed: true`. Observer hooks cannot retroactively undo completed operations, and `async` execution is restricted to observer events. `sessionStart` and `sessionEnd` scope to each run, while `stop` fires on natural model completion rather than user cancellation. Full event semantics, limits, examples, and wire payloads are documented in [HOOKS.md](HOOKS.md).

## Subagents, LSP, and Formatters

Subagent definitions in user directories and `.flecten/agents` configure model, allowed tools, permissions, and budgets; project definitions require project trust. `task` spawns an isolated child session whose effective permissions are the intersection of child rules, parent permissions, and active parent skill restrictions. Parent `deny` or `ask` policies reject child calls immediately instead of surfacing hidden approval prompts.

LSP servers and code formatters are configured in `flecten.config.json` and invoked by built-in tools under the same schema checks, path boundaries, and cancellation signals, without any external agent framework.

## Other Runtime Paths

- Checkpoints store pre/post-images for file edits, while shell commands snapshot into an isolated shadow Git repository so `/undo` and `/redo` never touch the user's `.git`.
- Persistent PTY terminals and background jobs track stable IDs, status, streamed logs, bounded waits, stop signals, and session-scoped completion notices.
- Message queues and live steering persist to disk with stable message IDs.
- Attachments support images, PDFs, and audio (`WAV`/`MP3` on OpenAI Chat, inline audio on Gemini; unsupported protocols fail fast before sending). Context token estimation accounts for image dimensions, PDF size, and supported audio duration.
- Voice input transcribes into an editable composer draft; see [VOICE.md](VOICE.md).
- HTML summaries run inline CSS/JS inside a `sandbox="allow-scripts"` iframe without `allow-same-origin` or network access, receiving theme tokens and Manrope font data via `postMessage`.

## Configuration Examples

Settings forms persist these exact shapes, and `docs:check` validates every JSON block below against `HarnessConfigSchema`.

```json
{
  "skills": { "sources": ["user-agents", "project-flecten"] },
  "mcp": {
    "servers": {
      "docs": { "command": "bun", "args": ["mcp/docs-server.ts"], "env": { "DOCS_ROOT": "./docs" }, "protocol": "auto", "timeoutMs": 60000, "maxTools": 64 }
    }
  }
}
```

```json
{
  "hooks": {
    "preToolUse": [{ "command": "bun .agents/hooks/guard.ts", "matcher": "bash", "timeoutMs": 5000, "failClosed": true }],
    "sessionEnd": [{ "command": "bun .agents/hooks/cleanup.ts", "timeoutMs": 10000 }]
  }
}
```

```json
{
  "permissions": {
    "read": "auto", "write": "auto", "shell": "ask", "network": "ask", "mcp": "ask", "skill": "allow", "externalPath": "deny",
    "rules": [{ "action": "write", "tool": "edit", "pathPrefix": "src", "policy": "allow", "note": "Edit project source files" }]
  }
}
```

```json
{
  "sessions": { "retentionDays": 90, "maxSessions": 1000, "trashDays": 30 },
  "telemetry": { "enabled": false }
}
```

## Platform Boundaries and Verification

Windows AppContainer isolation and per-command Job Objects are not wired in yet. Persistent PTY uses Bun `1.4.2` native ConPTY; Windows path edge cases, native shells, CIM snapshots, and process-tree teardown require verification on a Windows runner. The sidecar enables Bun's `no-orphans` guard so child processes terminate when the parent exits. Signed release/update channels require CI signing certificates. Linux test fixtures do not substitute for native OS acceptance on those paths.

Core test suites: `extension-runtime`, `skill-lifecycle`, `mcp-oauth`, `mcp-elicitation`, `modules`, `hooks`, `subagent-integration`, `attachments`, and `queue` under `tests/unit`, plus `tests/e2e/extensions.spec.ts`.

## References

A standalone OAuth MCP connector for searching and reading X from ChatGPT lives in [connectors/x-chatgpt](../connectors/x-chatgpt/README.md) and runs independently via `bun run connector:x`.

- [Agent Skills specification](https://agentskills.io/specification)
- [MCP lifecycle](https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle)
- [MCP transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [SDK v2 client](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect)

## Vision Fallback (`vision`)

`vision` configures an optional `{ provider, model }` pair for describing images when the active working model lacks native image input. Omitting `provider` defaults to the working model's provider; omitting `model` picks the enabled vision-capable model with known pricing that minimizes `cost.input + cost.output` (breaking ties by `model` ID). If no candidate has known pricing, explicit selection is required because unknown pricing is never treated as free. Manual selection accepts models without tool-calling support or known pricing as long as they declare image input. Vision-capable working models always receive raw images directly.

General Settings reuse the shared `ModelPicker` (search, provider grouping, favorites), saving `vision: { "provider": "provider-id", "model": "model-id" }`, with an **Auto** button to restore automatic selection. Clipboard pastes stage in private mode-`0700` temp directories and copy into durable session attachments on send. Non-vision models receive the generated description plus the attachment path, and subsequent `read` calls accept an optional `focus` question. Descriptions are capped at 60,000 characters, vision requests time out at 120 seconds, and up to 64 descriptions are cached per session; vision failures surface explicitly while keeping the attachment intact for retry.
