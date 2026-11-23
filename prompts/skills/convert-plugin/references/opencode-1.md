# Converting from OpenCode 1 (Latest v1.x)

Source ecosystem: **OpenCode v1.x** (`sst/opencode` / `anomalyco/opencode`, npm `@opencode-ai/plugin` and `@opencode-ai/sdk`).

OpenCode v1 plugins are async functions receiving a `PluginInput` context and returning a flat `Hooks` record of event handlers, lifecycle interceptors, custom tools, and auth hooks.

## 1. Recognizing an OpenCode v1 Plugin or Config

- **Discovery locations:**
  - Project: `.opencode/plugins/*.{ts,js}`, `.opencode/tools/*.{ts,js}`, `.opencode/agents/*.md`, `.opencode/commands/*.md`, `.opencode/skills/<name>/SKILL.md`
  - Global: `~/.config/opencode/plugins/`, `~/.config/opencode/opencode.json` (or `opencode.jsonc`)
  - npm packages listed in `opencode.json`: `"plugin": ["my-opencode-plugin"]` (singular `"plugin"` in v1; v2 uses `"plugins"`).
- **Plugin entry signature:**
  ```ts
  import { type Plugin, tool } from "@opencode-ai/plugin";

  export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
    return {
      event: async ({ event }) => { ... },
      config: async (config) => { ... },
      tool: {
        my_tool: tool({
          description: "...",
          args: { query: tool.schema.string() },
          async execute(args, ctx) {
            // ctx: { sessionID, messageID, agent, directory, worktree, abort, metadata, ask }
            return "result string";
          },
        }),
      },
      auth: { provider: "...", methods: [...] },
      "chat.message": async (input, output) => { ... },
      "chat.params": async (input, output) => { ... },
      "chat.headers": async (input, output) => { ... },
      "permission.ask": async (input, output) => { ... },
      "command.execute.before": async (input, output) => { ... },
      "shell.env": async (input, output) => { ... },
      "tool.execute.before": async (input, output) => { ... },
      "tool.execute.after": async (input, output) => { ... },
      "tool.definition": async (input, output) => { ... },
      "experimental.chat.messages.transform": async (input, output) => { ... },
      "experimental.chat.system.transform": async (input, output) => { ... },
      "experimental.session.compacting": async (input, output) => { ... },
      "experimental.text.complete": async (input, output) => { ... },
    };
  };
  ```
- **Standalone tool files (`.opencode/tools/<name>.ts`):** default export `tool({ description, args, execute })` (named exports register as `<filename>_<exportName>`).

## 2. Native-Overlap Check (OpenCode v1 vs Flecten)

Check before porting and notify the user if the plugin duplicates native Flecten functionality:

| Common OpenCode v1 plugin | Flecten native equivalent | Verdict |
|---|---|---|
| `.env` / secret read blocker (`tool.execute.before` blocking `.env`) | **Built-in**: `SandboxPolicy` blocks `.env*`, `secrets.json`, `~/.ssh`, `~/.aws` by default + Provider Protection masks secrets in context. | **Notify user.** Do not port basic `.env` guards; only port custom company-specific path rules via `sandbox.readDenyPrefixes` / `permissions.rules` / `hooks.preToolUse`. |
| Desktop notification on `session.idle` / `session.error` | **Built-in** notifications + `hooks.stop` / `hooks.notification` / `hooks.sessionEnd`. | If custom webhook/Slack/sound alert -> port cleanly as a tiny `async: true` `hooks.stop` / `hooks.sessionEnd` hook (no module needed!). |
| Dynamic context pruning / DCP (`experimental.chat.messages.transform` / `experimental.session.compacting`) | **Built-in**: Flecten already has output truncation + full disk logs, old tool-output pruning, Worker page compaction, `PageWriter`, and circuit breaker. | **Notify user.** Warning: mutating historical messages breaks prompt KV-cache! Only port via `platform.entry` `contracts.compact` if the user explicitly wants a custom compaction algorithm. |
| System prompt injector (`experimental.chat.system.transform`) | **Built-in**: `AGENTS.md` hierarchy, Skills, Memory, Term Dictionary, Module `instructions` (cache-safe append-only!). | **Notify user.** Never mutate system prompt dynamically; port static rules to `AGENTS.md`/Skills and task-scoped guidance to Module `instructions`. |
| Custom OAuth / auth plugin (`auth` hook, e.g., corporate token fetcher) | **Built-in**: Provider `auth.command` (executes credential helper with expiry caching) + MCP Streamable HTTP native PKCE OAuth. | **Notify user.** Convert token-refresh scripts directly to `providers.<id>.auth.command` in `flecten.config.json` (zero plugin code needed!). |
| Env loader (`shell.env` injecting env vars into bash/MCP) | **Built-in**: `sandbox.envAllowlist`, `terminal.envAllowlist`, `mcp.servers.<id>.env`, `hooks.*.env`. | **Notify user.** Configure env allowlists/vars in `flecten.config.json` (see `self-config` skill). |
| Model params/headers tweaker (`chat.params`, `chat.headers`) | **Built-in**: `providers.<id>.headers`, `extraBody`, `models.<id>.variants`, `models.<id>.compat`. | **Notify user.** Express via `flecten.config.json` provider/model variants instead of code! |
| Multi-agent workflow packs ("oh-my-opencode" style agent teams, planner/reviewer/oracle) | **Partially built-in**: Talker + Worker + Twin + `explore`/`implement`/`review` subagents. | **Notify user** about Talker/Worker/Twin overlap! Port ONLY genuinely specialized domain agents into `.flecten/agents/*.md` and domain skills into `.flecten/skills/`. |
| Auto-formatter / linter after edit (`tool.execute.after` on `edit`/`write`) | **Native Hook**: `hooks.postToolUse` with literal `matcher: { tool: "edit" }` / `{ tool: "write" }`. | Port as a simple command hook in `flecten.config.json` (zero TypeScript plugin needed!). |

## 3. Complete OpenCode v1 API -> Flecten Mapping

### A. `PluginInput` Context

| OpenCode v1 `PluginInput` | Flecten equivalent |
|---|---|
| `directory` / `worktree` | `workspace` in Module `runtime.entry` / `platform.entry`, or `cwd` in hook JSON stdin. |
| `$` (Bun shell template tag) | Inside `runtime.entry`: Bun is the embedded runtime! Use `Bun.$` or `Bun.spawn` directly (always pass/respect abort and cleanup). |
| `project` | Derive from `workspace` (or `git` commands inside `runtime.entry`). |
| `client` (`@opencode-ai/sdk` HTTP client: `session.prompt`, `tui.showToast`, `app.log`) | No localhost HTTP daemon in Flecten (sidecar speaks JSONL over stdio). Split by real intent: tool logic -> `runtime.entry`; notifications/UI -> Module `surface` (`flecten.harness`) or `hooks`; background logging -> module-owned log file or `stderr` diagnostics. Never call `console.log` inside stdio MCP/JSON hooks! |

### B. Custom Tools (`tool` hook & `.opencode/tools/*.ts`)

OpenCode v1 uses `tool.schema` (which is Zod!):
```ts
tool({
  description: "...",
  args: { path: tool.schema.string().describe("...") },
  async execute(args, ctx) {
    ctx.metadata({ title: "..." });
    await ctx.ask({ permission: "...", patterns: ["..."], always: ["..."], metadata: {} });
    return "output";
  },
})
```
Flecten adaptation in Module `runtime.entry`:
- Wrap `args` shape into `z.object({ ... })` using host-injected `z`.
- Return `{ content: [{ type: "text", text: String(result) }] }` (and optional `structuredContent`).
- `ctx.abort` -> honor cancellation / cleanup callback.
- `ctx.ask(...)` -> **remove custom permission prompts!** Flecten's `PermissionEngine` already gates every MCP/module tool call centrally before execution (and `runtime.readOnlyTools` marks read-only tools cleanly). For human-in-the-loop form inputs, MCP server elicitation or `ask` tool handles it.
- `ctx.metadata(...)` -> return clean structured output; Flecten renders tool cards automatically.

### C. Complete `Hooks` Mapping

| OpenCode v1 hook | Flecten target & exact adaptation |
|---|---|
| `tool.execute.before` (throws `Error` to block, or mutates `output.args`) | **Blocking:** `hooks.preToolUse` (`responseFormat: "json"`, `failClosed: true`, return `{ decision: "deny", reason }`). **Mutating args:** `platform.entry` `contracts.tool` wrapper (only if truly necessary; remember Flecten validates schemas before `contracts.tool`). |
| `tool.execute.after` | `hooks.postToolUse` (observer) or `platform.entry` `contracts.tool` (if modifying output returned to the model). |
| `tool.definition` (rewrites tool description/params dynamically) | **Avoid mutating built-in schemas** (breaks KV cache). Provide clear guidance via Skill or Module `instructions`, or register a purpose-built tool in `runtime.entry`. |
| `permission.ask` (`output.status = "allow" \| "deny" \| "ask"`) | **Deny rules:** `permissions.rules` in `flecten.config.json` or `hooks.permission` (note: Flecten `hooks.permission` can ONLY deny, never escalate to `allow`!). **Allow rules:** configure `permissions.rules` explicitly with user consent. |
| `command.execute.before` | `hooks.userPromptSubmit` (fires before user prompt reaches model; cannot mutate verbatim user text, can block or add `additionalContext`). |
| `chat.message` | `hooks.userPromptSubmit` (block or `additionalContext`) or Module `instructions`. |
| `chat.params` / `chat.headers` | Prefer `flecten.config.json` provider `headers`, `extraBody`, `models.<id>.variants`, `compat`. For truly dynamic per-request headers/options, wrap `contracts.model` in `platform.entry`. |
| `shell.env` | Configure `sandbox.envAllowlist`, `terminal.envAllowlist`, `hooks.*.env`, or `mcp.servers.<id>.env` in `flecten.config.json`. |
| `auth` (`AuthHook`: OAuth / API key methods) | For LLM providers: `providers.<id>.auth.command` (external CLI token helper with caching). For MCP servers: native MCP Streamable HTTP PKCE OAuth. |
| `config` (mutates loaded config at startup) | **Not supported as invisible runtime mutation.** Flecten config is explicit and user-controlled in `flecten.config.json` and the Settings UI. |
| `event` (`session.created`, `session.idle`, `session.compacted`, `session.error`, `file.edited`, `todo.updated`, `permission.updated`, `tui.*`, etc.) | Map `session.idle` -> `hooks.stop`, `session.error` -> `hooks.sessionEnd`, `session.compacted` -> `hooks.compact`, `file.edited` -> `hooks.postToolUse` (`tool: "edit"`/`"write"`/`"apply_patch"`). For live UI reactions -> Module `surface` `flecten.harness.subscribe`. |
| `experimental.chat.system.transform` | Convert to `AGENTS.md`, Skill, or Module `instructions` (append-only, KV-cache safe!). |
| `experimental.chat.messages.transform` | Avoid (breaks KV cache). If essential, inspect `contracts.model` or `contracts.compact` in `platform.entry`. |
| `experimental.session.compacting` | `hooks.compact` (blocking/inspection) or `platform.entry` `contracts.compact`. |
| `experimental.text.complete` | `hooks.stop` (observer) or `platform.entry` `contracts.model` stream wrapper. |

### D. Declarative `.opencode/` Files -> Flecten

| OpenCode v1 file | Flecten target |
|---|---|
| `.opencode/skills/<name>/SKILL.md` | `.flecten/skills/<name>/SKILL.md` (compatible Agent Skills; update tool names: `webfetch` -> `web_fetch`, `todowrite`/`todoread` -> `todo`, `list` -> `glob`). |
| `.opencode/commands/<name>.md` | `.flecten/commands/<name>.md` (keep `$ARGUMENTS`, `$1..$9`; remove OpenCode `!` shell-expansion syntax inside templates and instruct the model to run commands or use a hook instead). |
| `.opencode/agents/<name>.md` | `.flecten/agents/<name>.md` (convert frontmatter to Flecten's strict `name`, `description`, `allowed-tools`, `permissions`, `budget`). |
| `opencode.json` `mcp` block | `flecten.config.json` `mcp.servers` (OpenCode `"type": "local", "command": ["cmd", "arg"]` -> Flecten `{ "command": "cmd", "args": ["arg"] }`; OpenCode `"type": "remote", "url"` -> Flecten `{ "url", "headers", "oauth" }`). |
| `opencode.json` `instructions` | `AGENTS.md` (or `AGENTS.local.md`). |
