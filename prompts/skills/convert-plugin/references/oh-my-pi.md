# Converting from Oh My Pi (`can1357/oh-my-pi` / `omp`)

Source ecosystem: **Oh My Pi (`omp`)**, published as `@oh-my-pi/pi-coding-agent` (created by Can Boluk / `can1357`, forked from Pi and heavily expanded into a full terminal IDE harness).

Read `references/pi.md` as well when an OMP extension uses shared Pi `ExtensionAPI` primitives; this guide focuses on **OMP's divergences, extra APIs, plugin bundles, and unique native features**.

## 1. Recognizing an Oh My Pi Extension or Plugin

- **Discovery locations:**
  - User: `~/.omp/agent/extensions/`, `~/.omp/agent/tools/`, `~/.omp/agent/hooks/`, `~/.omp/agent/agents/`, `~/.omp/agent/commands/`, `~/.omp/agent/skills/`
  - Project: `.omp/extensions/`, `.omp/tools/`, `.omp/hooks/`, `.omp/agents/`, `.omp/commands/`, `.omp/skills/`
  - CLI test flag: `omp -e ./.omp/extensions/my-ext.ts`
  - Installed via: `omp plugin install ...`
- **Multi-component plugin layout:**
  ```text
  my-omp-plugin/
    package.json          # Declares omp.extensions (or legacy pi.extensions)
    .omp-plugin/          # Marketplace / plugin manifest metadata
    extensions/           # ExtensionAPI factory modules
    tools/                # Standalone CustomTool modules
    hooks/                # pre/ and post/ lifecycle hooks
    agents/               # Subagent Markdown/YAML definitions
    commands/             # Custom slash commands
    skills/               # Agent Skills (SKILL.md)
  ```
- **Extension entry signature (notice `pi.zod` / `pi.typebox` / `pi.arktype`):**
  ```ts
  import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

  export default function myExtension(pi: ExtensionAPI) {
    const z = pi.zod; // also pi.typebox or pi.arktype in some extensions
    pi.on("session_start", async (_event, ctx: ExtensionContext) => { ... });
    pi.registerTool({
      name: "word_count",
      label: "Word Count",
      description: "...",
      parameters: z.object({ text: z.string() }),
      async execute(args, ctx) { // or handler(args, ctx)
        return { content: [{ type: "text", text: "..." }], details: {} };
      },
    });
    pi.registerCommand("greet", { description: "...", handler: async (args, ctx) => { ... } });
  }
  ```

## 2. Key Differences from Upstream Pi

1. **Schema builders on `pi`:** OMP injects `pi.zod`, `pi.typebox`, and `pi.arktype` directly on `ExtensionAPI`. When converting `pi.zod` tools to Flecten `runtime.entry`, Zod schemas transfer almost directly to Flecten's host-injected `z`! Convert `pi.typebox` or `pi.arktype` schemas to Zod (`z`).
2. **Tool handler signature:** OMP extensions may use `execute(args, ctx)` / `handler(args, ctx)` (2 args) OR upstream Pi's 5-arg `execute(toolCallId, params, signal, onUpdate, ctx)`. In Flecten's `runtime.entry`, `server.registerTool(name, { description, inputSchema }, async (args, mcpCtx) => ...)` receives validated `args` as the first parameter and MCP request context as the second.
3. **Unified hooks & tools directories:** OMP scans `hooks/pre/`, `hooks/post/`, and `tools/` in addition to `extensions/` and runs JS/TS hooks inside the extension runner.
4. **Richer built-in toolset:** OMP plugins often assume OMP built-in tools exist: `hashline` edit anchors, `lsp`, `python` (persistent IPython/Jupyter kernel), `browser`, `task` (subagents in git worktrees), `ast_grep` / `ast_edit`, `ssh`, `web_search`, `fetch`, `find`, `grep`, `tts`, and `mnemopi.db` memory.
5. **Extra lifecycle events:** `before_provider_request`, `session_stop`, `session_before_branch` / `session_branch`, `auto_compaction_*`, in addition to Pi's event set (`session_start`, `session_shutdown`, `before_agent_start`, `agent_start`, `tool_call`, `tool_result`, `session_before_compact`, `user_bash`, etc.).
6. **`sendMessage` attribution:** OMP `pi.sendMessage({ customType, content, display, attribution }, { triggerTurn })` supports attribution metadata.

## 3. Native-Overlap Check (OMP vs Flecten)

Many OMP plugins overlap with Flecten's native features or exist for terminal-only UX. Always check and notify the user before porting:

| OMP plugin / feature | Flecten native equivalent | Adaptation verdict |
|---|---|---|
| `hashline` edit helper / whitespace-safe patcher | **Built-in**: Flecten `edit` has fuzzy line-matching, content-hash `ReadTracker` enforcement, LF/CRLF preservation, batch non-overlapping edits, and `apply_patch`. | **Notify user.** Do not port hashline wrappers. |
| `mnemopi` / session memory plugin | **Built-in & stronger**: Quote-verified `.flecten/memory.json` (`memory` tool) + Twin (note: Twin even imports `mnemopi.db` directly!). | **Notify user.** Do not port. |
| Worktree / parallel subagent orchestrator (`agents/`, `task`) | **Built-in**: `task` tool with dedicated UI tabs, live logs, independent Stop, strict JSON report repair, and custom `.flecten/agents/*.md|json`. | **Notify user.** Port ONLY custom agent specs (`agents/*.md`) into `.flecten/agents/<name>.md` (converting frontmatter to Flecten's required `allowed-tools`, `permissions`, `budget`). |
| `ast_grep` / structural code search | **Built-in**: Flecten `grep` is already AST-ranked, expands top-3 matching symbol bodies, and falls back to BM25 multi-term search. | **Notify user.** Only port if the plugin provides structural AST *rewriting* (codemods) via `ast-grep` CLI -> wrap as a small Module `runtime.entry` tool. |
| `browser` / desktop automation | **Built-in SDK pattern**: Flecten Modules support native browser/Playwright/Computer Use runtimes with durable image attachments and HTML preview surfaces. | Port browser automation logic into a Module `runtime.entry` (returning MCP image content parts so Flecten stores them as durable session attachments!). |
| `python` persistent kernel / notebook tool | **Not built-in** (Flecten has persistent shell PTY `terminal`, not a Jupyter kernel). | **Genuine value!** Port cleanly as a Module `runtime.entry` managing a persistent Python worker process (with cleanup callback on unload!). |
| `lsp` / `dap` integrations | Flecten has IDE syntax/symbols and configurable formatters/LSP hooks, not a standalone DAP debugger tool. | Port DAP or specialized language-server tools as a Module `runtime.entry` (marking read-only queries in `runtime.readOnlyTools`). |
| `tts` / voice notification / dictation | Flecten has **Voice Input** (API, `faster-whisper`, `Vosk`), not TTS speech output. | Voice-input plugins: **Notify user** (already built-in). TTS output notifications: can port as an async `hooks.stop` / `hooks.notification` command hook! |
| `ssh` remote runner | **Built-in**: Flecten has remote SSH jobs with `SSH_AUTH_SOCK` + verified `known_hosts` preflight (`src/tools/jobs/remote.ts`). | **Notify user.** Do not duplicate SSH execution. |
| `web_search` / `fetch` plugins | **Built-in**: `web_search` and `web_fetch` tools. | **Notify user.** Only port specialized search backends (e.g. Exa, Tavily, internal wiki) as an MCP server or Module. |
| TUI widgets / keymaps / ANSI renderers | Desktop app (Svelte 5 + HTML summaries + Module `surfaces`). | Redesign useful visual state as an HTML `surface` tab or HTML `<summary>` output; drop terminal-only chrome. |

## 4. Mapping OMP Multi-Component Plugins to Flecten

When converting an OMP multi-folder plugin (`package.json` + `extensions/` + `tools/` + `hooks/` + `agents/` + `commands/` + `skills/`), split cleanly into Flecten's native equivalents rather than cramming everything into one file:

| OMP component | Flecten target | Exact conversion notes |
|---|---|---|
| `extensions/*.ts` (tools + logic) | **Module `runtime.entry`** (`runtime.mjs`) | Replace `pi.zod` with host `z`; convert `pi.typebox`/`pi.arktype` to `z`; register via `server.registerTool(...)`; return cleanup function for timers/subprocesses. |
| `extensions/*.ts` (`before_provider_request`) | **Module `platform.entry`** (`contracts.model`) or Provider `headers`/`extraBody` | If only adding static headers/body params -> **use `flecten.config.json` provider config instead of code!** If dynamic request shaping -> wrap `contracts.model` (never mutating frozen prefix/system/tools). |
| `tools/*.ts` (`CustomTool`) | **Module `runtime.entry`** | Register each tool on `server.registerTool(...)`; declare read-only tools in `runtime.readOnlyTools`. |
| `hooks/pre/*`, `hooks/post/*`, `pi.on("tool_call"\|"tool_result"\|"session_*")` | **Module `hooks`** or `flecten.config.json` `hooks` | Convert `tool_call` blockers to `preToolUse` (`responseFormat: "json"`, `failClosed: true`, literal `matcher`); convert `tool_result` observers to `postToolUse`; convert `session_stop` to `stop` / `sessionEnd`. |
| `agents/*.md` | **`.flecten/agents/<name>.md`** | Rewrite YAML frontmatter to Flecten's strict schema (`name` matching filename, `description`, `allowed-tools` array with Flecten tool names, `permissions` array, `budget: { maxTurns, maxTokens }`). |
| `commands/*.md` or `pi.registerCommand` | **`.flecten/commands/<name>.md`** | Keep prompt templates with `$ARGUMENTS` and `$1..$9`. Interactive non-prompt commands become Module `surface` actions or tools. |
| `skills/<name>/SKILL.md` | **`.flecten/skills/<name>/SKILL.md`** or Module `instructions` + `resources` | Update tool name references (`find` -> `glob`, `fetch` -> `web_fetch`, remove `hashline` edit syntax instructions!). |
| `.omp-plugin/` marketplace manifest | `.flecten-module/module.json` (plus optional HTTPS marketplace entry per `MODULE-MARKETPLACE.md`) | Discard OMP marketplace metadata; write strict `schemaVersion: 1` `module.json`. |

## 5. OMP -> Flecten Tool Name Translation in Instructions/Prompts

Always rewrite OMP-specific tool instructions so Flecten models don't hallucinate nonexistent parameters:
- Remove all `hashline` / line-hash anchor syntax instructions -> Flecten uses `read` + `edit` (`oldString`/`newString` or `edits`) or `apply_patch`.
- `find` -> `glob`
- `fetch` -> `web_fetch`
- `subagent` / OMP `task` worktree flags -> Flecten `task` (`operation: "run"|"list"|"wait"|"stop"`, `agent`, `prompt`, `context`).
- `$skill` mention syntax -> Flecten uses `/skill-name` in composer or `skill({ name })` tool call.
