# Converting from OpenCode 2 (Latest v2.x, including v2.2+ Desktop GUI)

Source ecosystem: **OpenCode v2.x** (`anomalyco/opencode` v2, npm `@opencode/plugin`, `@opencode/client`, `@opencode/plugin/tui` / `@opencode-ai/plugin/tui`, and `@opencode/plugin/gui` via `./gui-experimental`).

OpenCode v2 is a **breaking redesign** of v1 plugins: flat hook-object functions are replaced by `Plugin.define({ id, setup })`, imperative namespaced registration on `ctx`, a separated server/client architecture (`@opencode/client`), global `~/.config/opencode/cli.json` for TUI plugins, and multi-target packages exposing Server + TUI (`./tui`) + Desktop GUI (`./gui-experimental`) + typed RPC.

## 1. Recognizing an OpenCode v2 Plugin

- **Configuration:**
  - Server plugins: `opencode.json` / `opencode.jsonc` using plural `"plugins": [...]` (package names or absolute module root paths; v1 used singular `"plugin"`).
  - TUI plugins: global `~/.config/opencode/cli.json` (replaced legacy layered `tui.json`/`tuirc`).
  - Desktop GUI plugins (v2.2.0+): declared in `"plugins"` and managed in OpenCode Desktop under Settings > Extensions > Plugins.
- **Multi-target `package.json` exports:**
  ```json
  {
    "name": "opencode-my-plugin",
    "exports": {
      ".": "./dist/server.js",
      "./tui": "./dist/tui.js",
      "./gui-experimental": "./dist/gui.js"
    }
  }
  ```
- **Server plugin entry signature:**
  ```ts
  import { Plugin } from "@opencode/plugin";

  export default Plugin.define({
    id: "my-org.my-plugin",
    async setup(ctx) {
      // ctx.options, ctx.client, ctx.project, ctx.directory, ctx.worktree
      await ctx.tool.transform((tools) => {
        tools.add({
          name: "query_db",
          description: "...",
          input: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
          execute: async (input) => ({ content: "..." }),
        });
      });

      await ctx.tool.hook("execute.before", async (event) => { ... });
      await ctx.session.hook("prompt", async (event) => { ... });
      await ctx.permission.hook("evaluate", async (e) => { ... });
      await ctx.shell.hook("create.before", async (e) => { ... });
      ctx.event.on("session.idle", async (event) => { ... });

      return () => { /* optional cleanup */ };
    },
  });
  ```
- **What stayed compatible from v1 in OpenCode v2:** `opencode.json` core provider/MCP settings, `.opencode/agents/`, `.opencode/commands/`, and `.opencode/skills/` remain structurally compatible (see `references/opencode-1.md` for those declarative files).

## 2. Native-Overlap Check (OpenCode v2 vs Flecten)

Check before porting and notify the user whenever Flecten already provides the feature natively:

| OpenCode v2 plugin capability | Flecten native equivalent | Verdict |
|---|---|---|
| Session recap / usage limits / cost tracker TUI/GUI panel | **Built-in**: Flecten already tracks per-chat + Talker/Worker token usage, USD cost, run budgets, and rich HTML summaries. | **Notify user.** Only port external billing/quota dashboards (e.g., third-party provider quota API) as a Module with a read-only tool + HTML `surface`. |
| Tool blocker / path guard (`ctx.tool.hook("execute.before")`, `ctx.permission.hook("evaluate")`) | **Built-in**: `PermissionEngine`, `SandboxPolicy`, Access Modes, lexer-based destructive shell checks. | **Notify user.** Port only project-specific policies via `permissions.rules` or `hooks.preToolUse`. |
| Shell env injection (`ctx.shell.hook("create.before")`) | **Built-in**: `sandbox.envAllowlist`, `terminal.envAllowlist`, `mcp.servers.<id>.env`. | **Notify user.** Configure in `flecten.config.json`. |
| Prompt / system context injection (`ctx.session.hook("prompt")`) | **Built-in**: `AGENTS.md`, Skills, Memory, Term Dictionary, Module `instructions`. | **Notify user.** Prefer static/append-only context over dynamic prompt mutation. |
| Custom auth provider (`ctx.auth`) | **Built-in**: Provider `auth.command` + MCP Streamable HTTP PKCE OAuth. | **Notify user.** Convert to `providers.<id>.auth.command` where possible. |
| TUI-only ergonomics (OpenTUI keymaps, terminal dialogs, TUI status bars, theme tweaks) | **Different architecture**: Flecten is a native desktop app with GUI modals, IDE, command palette (`/`), and HTML summaries. | **Drop TUI-only layers!** Port only the backend capability and, if valuable on desktop, build a clean Flecten Module HTML `surface` matching Flecten CSS tokens (`--bg`, `--surface`, `--text`, `--primary`, etc.). |
| Desktop GUI plugin (`./gui-experimental` panels, slots, composer pills, settings pages) | **Direct counterpart**: Flecten Module `surfaces` (workspace tabs, `placement` into `[data-harness-region]`, `styles`, and `flecten.harness` bridge)! | **Great fit for Flecten Modules!** Adapt slots/panels cleanly (see Section 3C below). |

## 3. Complete OpenCode v2 API -> Flecten Mapping

### A. Server Plugin (`Plugin.define({ id, setup })`)

| OpenCode v2 Server API | Flecten target & adaptation |
|---|---|
| `Plugin.define({ id, setup })` + returned cleanup | Module `.flecten-module/module.json` (`name: id` normalized to valid `ModuleIdSchema` kebab-case) + `runtime.entry` setup returning async cleanup callback (or `platform.entry` with `effect()`). |
| `ctx.options` | Read module configuration from a project file (e.g., `.flecten-module-config/<name>.json`) or pass via tool arguments / Module `surface` UI. |
| `ctx.tool.transform(tools => tools.add(...))` | Module `runtime.entry` `server.registerTool(name, { description, inputSchema }, handler)`. Convert JSON Schema `input` to Zod via host-injected `z`. Mark side-effect-free tools in `runtime.readOnlyTools`. |
| `ctx.tool.transform` removing/mutating built-in tools | **Do not mutate built-in tool schemas** (breaks KV cache and safety invariants). Use Skill `allowed-tools` or Subagent `allowedTools` to narrow tools cleanly, or `platform.entry` `contracts.tool` only if execution redirection is truly required. |
| `ctx.tool.hook("execute.before", ...)` | `hooks.preToolUse` (`responseFormat: "json"`, `failClosed: true`) for blocking/context; `platform.entry` `contracts.tool` if argument transformation is truly needed. |
| `ctx.tool.hook("execute.after", ...)` | `hooks.postToolUse` for observation/automation; `platform.entry` `contracts.tool` if mutating returned tool output. |
| `ctx.session.hook("prompt", ...)` | `hooks.userPromptSubmit` (block or `additionalContext`; Flecten never mutates stored verbatim user messages) or Module `instructions`. |
| `ctx.permission.hook("evaluate", e => { e.effect = ... })` | `permissions.rules` in `flecten.config.json` for explicit allow/deny rules; `hooks.permission` for dynamic deny-only guards (Flecten hooks can never escalate privileges to `allow`). |
| `ctx.shell.hook("create.before", e => { e.env ... })` | `sandbox.envAllowlist` / `terminal.envAllowlist` / `hooks.*.env` / `mcp.servers.<id>.env`. |
| `ctx.command` (slash commands) | `.flecten/commands/<name>.md` for prompt commands, or Module `surface` buttons calling `flecten.call(...)` / `flecten.harness.request(...)`. |
| `ctx.auth` | `providers.<id>.auth.command` (LLM auth) or MCP HTTP OAuth (external services). |
| `ctx.event.on(...)` / `ctx.event.subscribe(...)` | `hooks.sessionStart`, `hooks.stop`, `hooks.sessionEnd`, `hooks.compact`, `hooks.notification`, `hooks.subagent`; or live UI subscription via `flecten.harness.subscribe(...)` inside a `surface`. |
| `ctx.client` (`@opencode/client` server RPC) | Replace server HTTP RPC calls with direct local logic in `runtime.entry`, or `flecten.harness.snapshot()` / `flecten.harness.request(...)` from a `surface`. |

### B. TUI Plugin (`./tui`, `@opencode/plugin/tui`)

Do **not** port OpenTUI components or terminal keymap layers. Instead:
1. Extract the domain purpose behind the TUI feature (e.g., git status monitor, PR dashboard, token budget view, test runner panel).
2. Check if Flecten already shows it natively (sidebar, header, Activity trace, Changes tab, Worker Actions tab, IDE Source Control).
3. If it provides genuinely new interactive value, rebuild it as a self-contained HTML **Module `surface`** (workspace tab or targeted `placement`).

### C. Desktop GUI Plugin (`./gui-experimental`, `@opencode/plugin/gui`) -> Flecten Module `surfaces`

OpenCode v2.2+'s Desktop GUI plugin model maps closely to Flecten's Module Surfaces, with important security improvements in Flecten:

| OpenCode v2 Desktop GUI concept | Flecten Module Surface equivalent | Key adaptation |
|---|---|---|
| Workspace panel / tab | `surfaces[]` entry without `placement` (renders as a native workspace tab when module is active) | Bundle into a single self-contained HTML file (`entry`, up to 8 MiB, inline CSS/JS, zero external CDN URLs). |
| Layout slots (header, sidebar, composer pill, footer) | `surfaces[]` entry with `placement: { selector, position, order }` | Target stable `[data-harness-region="shell"\|"titlebar"\|"sidebar"\|"workspace"\|"header"\|"composer"]` selectors (never fragile internal classes). Requires user opt-in (**Use module interface**). |
| Settings page / theme overrides | Module `styles: ["theme.css"]` + `surface` settings tab + optional `"interface.styles"` command grant | Use Flecten's existing CSS tokens (`var(--bg)`, `var(--surface)`, `var(--raised)`, `var(--text)`, `var(--muted)`, `var(--primary)`, `var(--line)`). Do not invent a second token set or decorative glassmorphism. |
| Typed `rpc` bridge between GUI and Electron main / server | **`flecten.call(tool, args)`** + **`flecten.read(resource)`** + **`flecten.harness`** (`snapshot`, `subscribe`, `request`) | Move all Node/Bun/OS/network logic into `runtime.entry` MCP tools and list those exact tool names in `surface.tools`. Flecten NEVER runs untrusted plugin code in Electron's main process; `runtime.entry` runs safely in the Bun sidecar child process and sets unforgeable `_meta["flecten.dev/invocation-origin"] === "module-surface"`. |
| Command palette actions | Slash commands (`.flecten/commands/`), Skills, or buttons inside the Module `surface`. | Prefer explicit visible controls over hidden command-only actions (per Flecten `design.md`). |
| Toast / notification | Render inline status feedback inside the `surface` or return concise tool output; never spam transient toasts for persistent errors. | Match Flecten desktop design standards. |

## 4. V1 vs V2 Quick Detection Checklist

When inspecting an OpenCode repository to decide which guide to apply:
- Imports `@opencode-ai/plugin` + exports async function returning `{ "tool.execute.before": ... }` + `opencode.json` has `"plugin"` -> **OpenCode 1** (`references/opencode-1.md`).
- Imports `@opencode/plugin` + exports `Plugin.define({ id, setup })` + uses `ctx.tool.hook` / `ctx.tool.transform` / `cli.json` / `./gui-experimental` + `opencode.json` has `"plugins"` -> **OpenCode 2** (this guide).
- Hybrid migration repo shipping both -> read the v2 target code as the canonical source of intent.
