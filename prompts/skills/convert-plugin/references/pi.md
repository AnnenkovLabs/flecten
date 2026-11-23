# Converting from Pi (`badlogic/pi-mono`)

Source ecosystem: **Pi Coding Agent** (`badlogic/pi-mono`, npm `@earendil-works/pi-coding-agent`, legacy `@mariozechner/pi-coding-agent`, docs in `packages/coding-agent/docs/extensions.md`).

Pi is a deliberately minimal terminal coding agent whose core ships only basic tools (`read`, `write`, `edit`, `bash`, plus `grep`, `find`, `ls`) and delegates almost everything else (permissions, compaction customization, subagents, themes, widgets, providers, status bars) to TypeScript extensions.

## 1. Recognizing a Pi Extension or Package

- **Single file or directory extension:** `~/.pi/agent/extensions/<name>.ts` (or `.js`), project `.pi/extensions/`, or listed in `~/.pi/agent/settings.json` under `"extensions": [...]`, or run via `pi --extension path.ts`.
- **Pi Package (`package.json`):**
  ```json
  {
    "name": "my-pi-package",
    "keywords": ["pi-package"],
    "pi": {
      "extensions": ["./extensions"],
      "skills": ["./skills"],
      "prompts": ["./prompts"],
      "themes": ["./themes"]
    }
  }
  ```
- **Extension entry signature:**
  ```ts
  import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"; // or @mariozechner/pi-coding-agent
  import { Type } from "typebox"; // or @sinclair/typebox

  export default function (pi: ExtensionAPI) {
    pi.registerTool({ ... });
    pi.on("tool_call", async (event, ctx) => { ... });
    pi.registerCommand("foo", { description: "...", handler: async (args, ctx) => { ... } });
  }
  ```

## 2. Native-Overlap Check (Very High for Pi!)

Because Pi's core is intentionally bare-bones, **many popular Pi extensions exist solely to add capabilities Flecten already ships natively**. Check this table first and notify the user whenever the plugin is redundant:

| Common Pi extension idea | Flecten status | Action |
|---|---|---|
| Permission gate / `rm -rf` blocker / `.env` guard (`pi.on("tool_call")` returning `{ block: true }`) | **Built-in & stronger**: `PermissionEngine`, `SandboxPolicy` (default protected `.env*`, `.git`, `.flecten`, `~/.ssh`, `~/.aws`), lexer-based destructive shell checks, OS sandbox (`bwrap`/`Seatbelt`). | **Notify user.** Only port custom project-specific rules as `permissions.rules` or a `hooks.preToolUse` guard. |
| Custom subagent / delegate / parallel worker extension | **Built-in & stronger**: Talker/Worker split + `task` tool (`explore`, `implement`, `review` + custom `.flecten/agents/*.md`). | **Notify user.** Port only custom agent personas into `.flecten/agents/<name>.md`. |
| Git/file checkpoint or undo extension (`session_fork` / snapshots) | **Built-in & stronger**: Git-independent file checkpoints + shadow-Git shell rollback (`/undo`, `/redo`, `/checkpoints`). | **Notify user.** Do not port. |
| Status bar / footer / token meter / cost widget (`ctx.ui.setFooter`, `setStatus`, `setWidget`) | **Built-in**: Flecten desktop UI already displays live model, context meter, Talker/Worker token breakdown, cost/budget, and activity traces. | **Notify user.** Only port domain-specific dashboards (e.g., CI status, frame timeline) as a Module `surface`. |
| Custom compaction / summarizer (`session_before_compact`) | **Built-in**: Worker `context` page compaction + emergency pruning + `PageWriter` + circuit breaker. | **Notify user.** Port via `platform.entry` `contracts.compact` ONLY if the user needs a genuinely custom domain compactor. |
| Custom LLM provider registration (`pi.registerProvider`) | **Built-in (zero code!)**: `flecten.config.json` supports any OpenAI Chat, OpenAI Responses, Anthropic Messages, or Gemini endpoint with custom `baseUrl`, `headers`, `proxy`, `auth.command`, `compat`, and `variants`. | **Notify user.** Convert to a provider entry in `flecten.config.json` (see `self-config` skill) instead of writing code! |
| Memory / rules injector (`before_agent_start` mutating `systemPrompt`) | **Built-in & better**: `AGENTS.md` hierarchy + Quote-verified `memory` tool + Term Dictionary + Twin taste clone. | **Notify user.** Convert static rules to `AGENTS.md` or a Skill; convert dynamic project knowledge to `memory` or a Module with `instructions` + `resources`. |
| `!` / `!!` user bash interceptor (`user_bash`) | **Built-in**: `terminal` PTY, `bash`, OS sandbox, remote SSH jobs. | **Notify user.** If routing commands to a custom container/VM/remote executor, port via `platform.entry` `contracts.tool` or a Module tool. |
| TUI themes (`themes/*.json`) | **Different runtime**: Flecten is a Graphite + Iris desktop app (`ui/src/app.css`), not a TUI. | Only port if the user genuinely wants a desktop color skin -> convert palette tokens into a Module `styles` CSS file overriding `:root` tokens (`--bg`, `--surface`, `--sidebar`, `--panel`, `--primary`, etc.). |

## 3. Complete Pi API -> Flecten Mapping

### A. Tools (`pi.registerTool`)

Pi tool shape:
```ts
pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "...",
  parameters: Type.Object({ query: Type.String() }), // TypeBox
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    onUpdate?.({ content: [{ type: "text", text: "working..." }] });
    return { content: [{ type: "text", text: "done" }], details: { ... } };
  },
  renderCall(args, theme) { ... },
  renderResult(result, options, theme) { ... },
});
```

Flecten adaptation:
- **Target:** Module `runtime.entry` (`server.registerTool(name, { description, inputSchema }, handler)`).
- **Schema conversion:** Translate TypeBox (`Type.Object`, `Type.String`, `Type.Optional`, `Type.Union`, `Type.Literal`, `Type.Array`, `Type.Number`, `Type.Boolean`, `Type.Record`) into **Zod** using the host-injected `z` (`z.object`, `z.string()`, `.optional()`, `z.union` / `z.enum`, `z.array`, `z.number()`, `z.boolean()`, `z.record`).
- **Overriding built-in tools:** Pi extensions sometimes override `read`/`write`/`edit`/`bash` by registering the same name. **Do NOT shadow Flecten built-in tools** unless strictly necessary (Flecten's built-ins own read-tracking, AST alignment, checkpoints, sandboxing, and argument repair). If interception/redirection is truly needed (e.g., container execution), use `platform.entry` `contracts.tool` wrapper instead.
- **`onUpdate` streaming:** MCP tool calls return final `content` (plus optional `structuredContent`). For long-running jobs, either return structured progress via a companion status tool + HTML `surface`, or use `bash` `background: true` / `jobs`.
- **`renderCall` / `renderResult`:** Drop terminal ANSI/box rendering completely! Return clean Markdown or `structuredContent` (and optionally add a Module HTML `surface` if rich interactive visualization adds real value).
- **Read-only tools:** List canonical names (`mcp_module_<mod>__runtime_<tool>`) in `manifest.runtime.readOnlyTools` when side-effect-free.
- **Cleanup:** If the extension opens child processes/sockets/watchers, return an async cleanup callback from `runtime.entry`'s default export.

### B. Lifecycle Events (`pi.on(...)`)

| Pi event | Pi behavior | Flecten equivalent & adaptation |
|---|---|---|
| `tool_call` | Fires before tool execution; returns `{ block: true, reason }` or mutates input | **`hooks.preToolUse`** (blocking via exit code `2` or `{ decision: "deny", reason }`). Note: Flecten hooks cannot silently rewrite tool args; if arg transformation or execution wrapping is truly required, use `platform.entry` `contracts.tool`. |
| `tool_result` | Fires after tool execution; can inspect/mutate/truncate output | **`hooks.postToolUse`** for auditing/side effects/notifications. If transforming tool output before the model sees it is truly needed, wrap `contracts.tool` in `platform.entry`. |
| `tool_execution_start` / `update` / `end` | Progress observers | Flecten already streams live tool cards; use `hooks.preToolUse` / `hooks.postToolUse` for automation or `surface` `flecten.harness.subscribe` for custom UI. |
| `before_agent_start` | Fires per prompt; mutates `systemPrompt` / `systemPromptOptions` | **Do NOT mutate the system prompt per turn** (breaks KV cache). Use static `AGENTS.md`, a Skill, Module `instructions` (appended once at activation), or `hooks.userPromptSubmit` returning `additionalContext` for genuinely per-turn context. |
| `context` / `context_with_system` | Non-destructively transforms outgoing messages | Only if truly essential, wrap `contracts.model` in `platform.entry` (remember: `ModelRequest` is frozen on prefix/system/tools; only safe tail/adapter routing is permitted). Prefer Skills/Memory/Module instructions. |
| `input` | Intercepts/transforms user input | `hooks.userPromptSubmit` (can block or attach `additionalContext`; Flecten stores raw user messages verbatim by invariant and never rewrites them). |
| `session_start` / `session_shutdown` | Startup/teardown | `hooks.sessionStart` / `hooks.sessionEnd`, or Module `runtime.entry` setup + returned cleanup callback / `platform.entry` `effect()`. |
| `turn_start` / `turn_end` / `agent_start` / `agent_end` | Turn & run lifecycle | `hooks.sessionStart`, `hooks.stop` (natural completion), `hooks.sessionEnd` (all endings). For custom multi-step agent loops, `platform.entry` `contracts.agent`. |
| `session_before_compact` / `session_compact` | Compaction lifecycle | `hooks.compact` (can block history replacement or inspect summary) or `platform.entry` `contracts.compact`. |
| `session_before_switch` / `session_switch` / `session_fork` / `session_tree` | Branching/switching | Native in Flecten (`Dialogue Branches` + `sessions.fork`). For custom durable storage, `platform.entry` `contracts.storage` (`scope: "project"`). |
| `model_select` | Reacts to model switch | Usually unnecessary in Flecten (model metadata, reasoning, and modalities hydrate automatically). Custom routing uses `contracts.model`. |
| `resources_discover` | Dynamically contributes skills/prompts/themes | Declare `instructions`, `resources`, and `styles` statically in `.flecten-module/module.json`, or place skills/commands in `.flecten/skills/` and `.flecten/commands/`. |
| `user_bash` | Intercepts `!cmd` | No `!` shortcut in Flecten; users run commands via IDE Terminal or agent `bash`/`terminal`. For container/remote execution, wrap `contracts.tool`. |

### C. Commands, Shortcuts, Flags, Session Entries, and TUI UI

| Pi API | Flecten adaptation |
|---|---|
| `pi.registerCommand(name, { description, handler })` | If prompt-based -> **Slash Command** (`.flecten/commands/<name>.md`) or **Skill** (also appears in `/` menu). If interactive action/UI -> Module HTML `surface` button calling `flecten.call(...)` or `flecten.harness.request(...)`. |
| `pi.registerShortcut(key, opts)` | Drop terminal keybindings; expose actions in a Module `surface` or slash command. |
| `pi.registerFlag` / `pi.getFlag` | Flecten is a desktop app (no user CLI flags). Expose settings as tool parameters, a project JSON config file read by the module, or a Module `surface` settings panel. |
| `pi.sendMessage` / `pi.sendUserMessage` | From a Module `surface`: `flecten.harness.request({ type: "run", prompt })` (requires `"run"` in `surface.harness.commands`). From hooks: return `additionalContext`. |
| `pi.appendEntry` / `ctx.sessionManager` | Store module durable state in a workspace file (e.g. `.flecten-module-state/<mod>.json` or `bun:sqlite` under `workspace`, never `moduleRoot`). |
| `pi.exec(cmd, args)` | Inside `runtime.entry`: use `Bun.spawn` / `Bun.spawnSync` directly (honoring `AbortSignal` / cleanup). |
| `pi.getActiveTools` / `pi.setActiveTools` | Skills use `allowed-tools` frontmatter; Subagents use `allowedTools`; Modules activate/deactivate per chat via `module` tool. |
| `ctx.ui.select` / `confirm` / `input` / `editor` | For agent questions -> built-in `ask` tool or interactive HTML `<summary>` controls (`window.flectenSummary`). For rich module flows -> Module HTML `surface` or MCP elicitation. |
| `ctx.ui.notify` / `setStatus` / `setWidget` / `setFooter` / `setHeader` / `custom` / `registerMessageRenderer` | Drop TUI chrome. Use concise tool outputs, HTML `<summary>` cards, or a dedicated Module HTML `surface` tab / `placement` panel. |
| `prompts/*.md` | Convert to `.flecten/commands/<name>.md` (slash commands) or `.flecten/skills/<name>/SKILL.md`. |
| `skills/<name>/SKILL.md` | **Directly compatible!** Both follow Agent Skills; review `allowed-tools` tool names (Pi `find` -> Flecten `glob`, Pi `ls` -> Flecten `glob` `mode="entries"`). |

## 4. Pi -> Flecten Tool Name Translation in Prompts/Skills

When porting Pi skills, prompts, or instructions, update built-in tool references:
- `find` -> `glob`
- `ls` -> `glob` (with `mode: "entries"`)
- `read`, `write`, `edit`, `bash`, `grep` -> same names in Flecten (note Flecten also has `apply_patch`, `delete`, `move`, `terminal`, `jobs`, `web_fetch`, `web_search`, `memory`, `task`, `ask`, `todo`, `done`).
