# Flecten Target Architecture and Native Feature Audit

Read this guide before porting any plugin from another harness. Its job is twofold:
1. Prevent porting features Flecten already implements natively (often deeper or safer).
2. Provide the exact Flecten extension contracts so every port is idiomatic, cache-safe, and schema-valid.

## 1. Native Flecten Capabilities (DO NOT Re-Implement)

Before writing a single file, check whether the source plugin's idea is already native to Flecten. If it matches an item below, **notify the user** and skip porting that part (port only a genuine delta if the user still needs one):

| External plugin category | Flecten native equivalent | Why Flecten's native version is equal or better |
|---|---|---|
| Dual-agent / non-blocking chat / background worker | **Talker + Worker** (`conversation.enabled: true`) | Built-in split loop with `< 1 s` Talker responsiveness, live steering, `[[w_...]]` live tool cards, independent role models, and runtime acceptance criteria. |
| Taste/style learning, "code review critic", user-voice guardrails | **Twin** (`src/twin/`) | 3D digital clone that imports history/memory from 10 AI tools (Claude Code, Codex, Cursor, OMP, Kilo, DeepSeek, OpenCode, Hermes, Command Code, Flecten), learns up to 200 quote-backed traits, watches silently mid-run, and barges into chat in the user's voice. |
| Persistent project memory / auto-remembering preferences | **Quote-verified Memory** (`memory` tool, `.flecten/memory.json`) | Primary-model curated, SHA-256 verbatim-quote verified, CAS revisions, topic navigation, zero hallucinated background bots, secret rejection. |
| Slang/glossary/acronym expander or broken-layout fixer | **Term Dictionary** (`Settings > Memory and dictionary`) | 114-term built-in engineering glossary synced from GitHub + project-local overrides + 0 ms EN/RU/UK wrong-keyboard-layout recovery. |
| Enhanced grep / AST code search / symbol-aware read | **Sniper Search + Function-Aware Read** (`grep`, `read`) | Native `rg` + AST symbol ranking + top-3 definition expansion + BM25 fallback + enclosing symbol alignment + shared `ReadTracker` across parallel subagents. |
| File undo / snapshot / shell command rollback | **File Checkpoints + Shadow Git** (`/undo`, `/redo`, `/checkpoints`) | Content-addressed file checkpoints PLUS isolated `.flecten/shadow` snapshots for shell commands without touching the user's `.git`. |
| Chat branching / edit previous message / fork | **Dialogue Branching** (edit any message in composer) + `sessions.fork` | Native `< 1 / 2 >` branch switching with isolated unsent drafts, preserved attachments, and branch-scoped page archives. |
| Interactive cards / tables / UI forms in assistant replies | **Interactive HTML Summaries** (`<summary>...</summary>`) | Built-in offline sandboxed HTML kit with sortable/filterable tables, tabs, diagrams, `flecten://` deep links, and two-way `window.flectenSummary` human-gesture capture. |
| Provider fallback / rate-limit retry / model router | **Failover + Stream Recovery** (`failover`, `model.failoverModels`) | Automatic empty-turn/cutoff continuation, error classification, cooldown circuit breaker, and backup model chains. |
| Secret DLP / API key masking / untrusted proxy shield | **Provider Protection** (`providers.<id>.protection`) | Reversible HMAC-tagged `[[secret_...]]` vault, gateway detection (New API / One API), mandatory human approval checkpoints, streaming redaction across logs/IPC. |
| Permission prompts / command guard / OS sandbox | **Access Modes + PermissionEngine + OS Sandbox** (`Settings > Access`) | `agent`/`confirm`/`full` presets, lexer-based destructive shell detection (not regexes), `bubblewrap` (Linux) / `Seatbelt` (macOS), per-directory external-path leases. |
| Persistent terminal / background process manager | **`terminal` (Bun PTY) + `bash` (`background: true`) + `jobs`** | Process-tree tracking (RSS, ports, `setsid` orphans), timeouts, exit framing, session-scoped completion notices. |
| Voice input / Whisper / speech-to-text | **Voice Dictation** (`Settings > General > Voice Input`) | Built-in cloud `/audio/transcriptions` AND offline local `faster-whisper` (CPU/CUDA) + `Vosk` with zero cloud fallback. |
| Image description fallback for text-only models | **Vision Fallback** (`Settings > Models > Vision`) | Auto-selects lowest-cost vision model on active provider or configured override, with per-session caching and `read(..., focus)`. |
| Auto-translate prompts/responses for non-English users | **Agent Language** (`translation` config) | Streaming chunk translation keeping verbatim raw prompt separate from English working context. |
| Context compaction / sliding window / page archives | **Context Compaction + Worker `context` Pages** | Automatic emergency pruning + `PageWriter` JSON schema compaction + circuit breaker + Worker `pages/N.md` archive with `list`/`read`/`search`. |
| Multi-agent / subagent orchestration | **Subagents (`task` tool)** | Built-in `explore`, `implement`, `review` + custom `.flecten/agents/*.md|json`, dedicated header tabs, independent Stop, strict JSON reports with repair pass. |
| Lazy MCP tool loading / OAuth / elicitation | **Native MCP + `tool_catalog`** | `stdio` and Streamable HTTP, PKCE OAuth, UI elicitation forms, on-demand `tool_catalog` activation (zero upfront schema bloat). |
| Custom desktop IDE / diff viewer | **Built-in IDE** (header toggle Agent / IDE) | File tree, CodeMirror editor, inline split diffs, line comments, docked chat, integrated terminal. |
| Auto-update / diagnostics bundle | **Signed Auto-Updater + Diagnostics** (`Settings > About`) | Ed25519 + SHA-512 verified updates and redacted diagnostics bundles. |

## 2. Flecten Primitive Selection Matrix

Choose the lightest primitive that completely serves the plugin's real value:

| Source feature | Best Flecten target | Location |
|---|---|---|
| Prompt workflow, coding conventions, domain guide, checklists | **Skill** (`SKILL.md` + optional `references/`) | `.flecten/skills/<name>/SKILL.md` or `~/.flecten/skills/<name>/SKILL.md` |
| User-invoked `/name args` prompt macro | **Slash Command** (`.md` with optional frontmatter) | `.flecten/commands/<name>.md` or `~/.flecten/commands/<name>.md` |
| Specialized read-only/coding/review child agent | **Subagent definition** (`.md` or `.json`) | `.flecten/agents/<name>.md` or `~/.flecten/agents/<name>.md` |
| Block/audit tool calls, run formatter/linter on edit, webhook notify | **Hook** (`command` or `http`, exact matchers) | `flecten.config.json` `hooks` (**Settings > Hooks**) or module `hooks` |
| Connect external SaaS/API/database tools | **MCP Server** (`stdio` or Streamable HTTP + OAuth) | `flecten.config.json` `mcp.servers` or MCP-only module |
| Custom tools + instructions + lazy guides + optional hooks/HTML tab | **Module** (`runtime.entry` + optional `instructions`/`resources`/`hooks`/`surfaces`) | `.agents/modules/<name>/` (local dev) or `.flecten/modules/<name>/` (installed) |
| Custom theme CSS, workspace panel/tab, or full desktop shell UI | **Module with `styles` and/or `surfaces`** (`placement` + `harness` bridge) | `.agents/modules/<name>/` |
| Deep runtime interception (model stream, tool executor, compaction, agent loop, session storage) | **Module with `platform.entry`** (`scope: "session"` or `"project"`) | `.agents/modules/<name>/` |

## 3. Exact Flecten Target Contracts

### A. Module Manifest (`.flecten-module/module.json`)

Every path must be relative (no `..`, no leading `/`, no `\`, no symlinks). Package cap: 32 MiB and 5,000 files. Unknown keys are rejected (`.strict()`).

```json
{
  "schemaVersion": 1,
  "name": "my-module",
  "version": "1.0.0",
  "description": "Concise purpose of this module",
  "capabilities": ["domain-tag"],
  "requires": [],
  "conflicts": [],
  "instructions": ["instructions.md"],
  "styles": ["theme.css"],
  "resources": [
    { "id": "guide", "path": "guides/reference.md", "description": "Detailed guide loaded on demand" }
  ],
  "runtime": {
    "entry": "runtime.mjs",
    "readOnlyTools": ["mcp_module_my-module__runtime_inspect"]
  },
  "platform": {
    "entry": "platform.mjs",
    "scope": "session"
  },
  "mcp": {
    "servers": {
      "api": { "url": "http://127.0.0.1:3100/mcp" }
    }
  },
  "hooks": {
    "preToolUse": [
      {
        "id": "guard",
        "name": "Guard writes",
        "type": "command",
        "responseFormat": "json",
        "command": "bun \"$FLECTEN_MODULE_ROOT/hooks/guard.ts\"",
        "matcher": { "tool": "write", "pathPrefix": "src" },
        "timeoutMs": 5000,
        "failClosed": true
      }
    ]
  },
  "surfaces": [
    {
      "id": "panel",
      "title": "My Panel",
      "entry": "panel.html",
      "tools": ["mcp_module_my-module__runtime_inspect"],
      "resources": ["guide"],
      "placement": {
        "selector": "[data-harness-region=\"workspace\"]",
        "position": "append",
        "order": 10
      },
      "harness": {
        "state": true,
        "events": true,
        "commands": ["run", "stop", "sessions.new", "sessions.select", "settings.open"]
      }
    }
  ]
}
```

Key rules:
- `runtime.entry` server ID is implicitly `runtime` -> canonical tool names are `mcp_module_<module>__runtime_<tool>`.
- External `mcp.servers.<id>` tools become `mcp_module_<module>__<id>_<tool>`.
- `runtime.readOnlyTools`: list exact canonical tool names that have zero side effects so they evaluate against `read` policy instead of mutating `mcp` policy.
- Agents activate modules per chat via `module` tool (`list`, `activate`, `deactivate`, `status`, `tools`, `call`, `read`). Talker has read-only `list`/`status`/`tools`/`read`; Worker runs `activate`/`call`/`deactivate`. Both share one module instance per conversation.
- Never put API keys or secrets inside a module folder: all files are hashed into SHA-256 trust snapshots.

### B. Native Runtime SDK (`runtime.entry`)

Runs in a dedicated child process of Flecten's embedded Bun runtime (no separate Bun, Zod, or MCP SDK installation needed):

```javascript
export default ({ apiVersion, server, z, workspace, moduleRoot }) => {
  server.registerTool(
    "inspect",
    {
      description: "Inspect project state",
      inputSchema: z.object({ target: z.string().min(1) }),
    },
    async ({ target }, ctx) => {
      const fromUi = ctx?.mcpReq?._meta?.["flecten.dev/invocation-origin"] === "module-surface";
      return {
        content: [{ type: "text", text: `Inspected ${target} (fromUi=${fromUi})` }],
      };
    },
  );

  // Optional sync or async cleanup invoked on transport close, SIGTERM, or SIGINT
  return async () => {
    // Tear down child processes, timers, sockets, temp files
  };
};
```

Notes:
- `workspace` is the project root; `moduleRoot` is an immutable per-revision staging directory deleted on unload. Persist durable state under `workspace` or an external user directory, never `moduleRoot`.
- MCP image/audio results are automatically validated and saved as durable session attachments (no base64 in logs).

### C. Platform Service Overrides (`platform.entry`)

Runs in-process in the sidecar with full privileges (explicitly surfaced to the user before trusting). Use ONLY when `runtime.entry` + `hooks` + `surfaces` are insufficient.

```javascript
export default async ({
  apiVersion,
  workspace,
  moduleRoot,
  sessionId,
  signal,
  z,
  contracts,
  defineService,
  services,
  effect,
}) => {
  await effect(() => {
    // Setup resource; returned function runs on rollback/unload in reverse order
    return () => {};
  });

  services.wrap(contracts.model, (next) => async (request, callSignal, provider) => {
    // ModelRequest is frozen: never mutate system prompt, tool schemas, or historical prefix
    return next(request, callSignal, provider);
  });
};
```

Five built-in contracts (`src/core/services/contracts.ts`):
- `contracts.agent` (`harness.agent@1`): `(prompt, options: LoopOptions) => Promise<LoopResult>` - wrap or replace the agent loop; emit typed `LoopEvent` items via `options.emit`.
- `contracts.model` (`harness.model@1`): `(request: ModelRequest, signal, provider) => Promise<AsyncIterable<ModelEvent>>` - wrap/route primary model streams (prefix mutations are rejected to protect KV cache).
- `contracts.tool` (`harness.tool@1`): `(tool, input, context) => Promise<ToolResult>` - wrap/redirect post-validation, post-permission tool execution (e.g., containers/remote hosts).
- `contracts.compact` (`harness.compact@1`): `(messages, options) => Promise<CompactionResult>` - custom history compaction.
- `contracts.storage` (`harness.storage@1`, requires `scope: "project"`): `(request: StorageRequest) => Promise<unknown>` - custom event journal and session index (e.g., `bun:sqlite`).

Cross-module typed services:
- `defineService("my.service@1", InputSchema, OutputSchema)`
- `services.provide(contract, handler)` / `services.replace(...)` / `services.wrap(...)` / `services.require(contract)` (consumer declares `requires: ["provider-module"]`).

### D. Custom HTML Surfaces and Shell Replacement (`surfaces`, `styles`)

Each surface is a self-contained HTML bundle (up to 8 MiB, inline CSS/JS, `data:`/`blob:` assets) running in an opaque-origin iframe (`sandbox="allow-scripts allow-forms"`, strict CSP, zero direct network/filesystem/Node access).

Available inside the iframe via `window.flecten`:
- `await flecten.tools()` - list tools declared in `surface.tools`.
- `await flecten.call(toolName, args)` - invoke declared tool (returns `ToolResult`; sets unforgeable `invocation-origin: "module-surface"`).
- `await flecten.read(resourceId)` - read declared resource.
- When `harness.state: true`: `await flecten.harness.snapshot()` (workspace, active chat, messages, sessions, phase, running, model, approvals, usage, budget, queue, jobs - never raw secrets).
- When `harness.events: true`: `await flecten.harness.subscribe(cb)`.
- When `harness.commands` lists explicit command names (no wildcards): `await flecten.harness.request({ type: "...", ... })`.
  - Including `"interface.styles"` allows runtime CSS injection (`{ type: "interface.styles", css: "..." }`, up to 256,000 chars).
- Prefer stable DOM placement targets: `[data-harness-region="shell"|"titlebar"|"sidebar"|"workspace"|"header"|"composer"]`.
- `placement.position`: `"replace" | "before" | "after" | "prepend" | "append"`.
- Emergency recovery: user can press `Ctrl+Shift+F12` or **Restore native interface** at any time.

### E. Hooks (`hooks`)

11 lifecycle events (`shared/hooks.ts`):
- Interceptable (can block via exit code `2` or `{ "decision": "deny", "reason": "..." }`): `sessionStart`, `userPromptSubmit`, `preToolUse`, `toolBatch`, `permission`, `compact`, `subagent` (only `phase === "start"`).
- Observer-only (cannot block; supports `async: true`): `postToolUse`, `notification`, `stop`, `sessionEnd`.

Matchers use **exact literal matching only** (no regex, no glob): `tool`, `path`, `pathPrefix`, `command`, `commandPrefix` combined with logical AND. Use multiple hook entries for OR.
- `stdin` receives a single JSON object (`event`, `sessionId`, `cwd`, `toolName`, `toolArgs`, etc.); 64 KiB cap on input/output; `timeoutMs` `100..60000` (default `10000`).
- `responseFormat`: `"text"` (diagnostic stdout; exit `2` still blocks) or `"json"` (`{ decision?: "allow"|"deny", reason?: string, additionalContext?: string }`).
- In module hooks, `$FLECTEN_MODULE_ROOT` resolves to the active revision's snapshot directory.

### F. Skills, Commands, Subagents, and MCP

- **Skills** (`.flecten/skills/<name>/SKILL.md`): YAML frontmatter (`name`, `description`, optional `version`, `argument-hint`, `allowed-tools`, `compatibility`, `license`, `metadata`) + concise Markdown body + lazy companion files read via `skill({ name, resource })`. Cap: 256 KiB per file.
- **Slash Commands** (`.flecten/commands/<name>.md`): lowercase `a-z0-9-_` filename; optional YAML frontmatter (`description`, `argument-hint`/`hint`); body expands `$ARGUMENTS` and `$1..$9`. Cap: 64 KiB.
- **Subagents** (`.flecten/agents/<name>.md` or `.json`): kebab-case `name` matching filename; required `description`, `allowed-tools` (MD) / `allowedTools` (JSON), `permissions` array, `budget: { maxTurns, maxTokens, maxCost? }`, optional `model`/`provider`; Markdown body becomes system prompt; child returns JSON with non-empty `summary`.
- **MCP Servers**: `stdio` (`command`, `args`, `env`, `protocol`, `timeoutMs`, `maxTools`, `allowTools`, `readOnly`) or Streamable HTTP (`url`, `headers`, `oauth`, `protocol`, `timeoutMs`, `maxTools`, `allowTools`, `readOnly`).

## 4. Post-Conversion Trust and Verification Checklist

1. Verify every JSON file against its Flecten schema (no unknown keys in `module.json` or `flecten.config.json`).
2. Verify zero secrets or `.env` files inside any module or skill folder.
3. Verify zero `..` traversal, absolute paths, or symlinks inside module manifests.
4. Confirm prompt-cache discipline: no per-turn system-prompt mutation in `platform.entry` wrappers.
5. Verify zero em dashes (`U+2014`) in UI strings and documentation.
6. Give the user exact activation instructions:
   - Module in `.agents/modules/<name>`: **Settings > Modules > Installed > Trust this version** (optionally enable **Reload local changes automatically** for active dev, and **Use module interface** for `placement`/`styles`).
   - Skill / Command / Subagent: auto-discovered on next run or **Reload skills** in **Settings > Skills**.
   - Hooks / MCP: configure in `flecten.config.json` (or **Settings > Hooks** / **Settings > MCP**).
