# Converting from DeepSeek Harness (`deepseek-ai/deepseek-harness` / DSH)

Source ecosystem: **DeepSeek Harness (`dsh`)**, published under `@deepseek-ai/dsh`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`, etc. (GitHub topic: `dsh-plugin`).

DeepSeek Harness follows an **"everything-is-a-plugin"** architecture built on **Cordis** (spatiotemporal composability: every capability is a dependency-injected `Service` on `ctx`, and every registration is a reversible effect bound to plugin scope).

## 1. Recognizing a DeepSeek Harness Plugin

- **Package & config layout:**
  - npm packages under `@deepseek-ai/dsh-*` or community `dsh-plugin-*` packages.
  - Profile stacks & overrides in `~/.dsh/profiles/<name>/cordis.patch.yml` (profiles: `web`, `headless`, `sdk`, `acp`) and `dsh.yml`.
- **Standard plugin entry (`apply` + `name` + `inject` + optional `Config` schema):**
  ```ts
  import { Service, type Context } from "@deepseek-ai/cordis";
  import { defineTool } from "@deepseek-ai/dsh-tools";

  export const name = "my-dsh-plugin";
  export const inject = ["tools"]; // waits until ctx.tools is ready

  export function apply(ctx: Context, config: Config) {
    // Register a tool (automatically unwound when plugin disposes)
    ctx.tools.register(
      defineTool({
        name: "greet",
        description: "Greet someone by name.",
        parameters: {
          name: { type: "string", required: true, description: "Name to greet" },
        },
        output: {
          schema: { type: "string" },
          render: (_args, value) => [{ type: "text", text: value }],
        },
        async execute(args, exec) {
          return `Hello, ${args.name}!`;
        },
      }),
    );

    // Subscribe to lifecycle events or register reversible side effects
    ctx.on("...", listener);
    ctx.effect(() => {
      const timer = setInterval(() => {}, 1000);
      return () => clearInterval(timer);
    });
  }
  ```
- **Custom Service plugin:**
  ```ts
  export class MyService extends Service {
    constructor(ctx: Context) {
      super(ctx, "myService"); // mounts on ctx.myService
    }
  }
  export function apply(ctx: Context) {
    ctx.plugin(MyService);
  }
  ```

## 2. Core DSH Services & Native-Overlap Check

Because DSH builds *everything* as a Cordis plugin, many DSH plugins are core harness subsystems that **Flecten already provides natively**! Audit carefully and notify the user before porting:

| DSH service / plugin category | Flecten native equivalent | Verdict |
|---|---|---|
| `ctx.llm` / `dsh-llm` (OpenAI-compatible / DeepSeek / Ollama model adapter) | **Built-in (zero code!)**: Flecten supports 4 wire protocols (`openai-chat`, `openai-responses`, `anthropic-messages`, `gemini`) with DeepSeek, Ollama, OpenRouter, etc. built-in + `compat` flags (`thinkingParam`, `reasoningReplay`, `clearThinking`). | **Notify user.** Convert to a provider entry in `flecten.config.json` (see `self-config` skill). Only use `platform.entry` `contracts.model` if the plugin implements a genuinely custom non-standard wire protocol. |
| `ctx.fs` (workspace file read/write/search) | **Built-in**: `read` (symbol-aligned), `write`, `edit`, `apply_patch`, `delete`, `move`, `grep` (AST+BM25), `glob`. | **Notify user.** Only port virtual/remote filesystems (e.g., S3, container FS, SSH FS) via a Module `runtime.entry` or `platform.entry` `contracts.tool`. |
| `ctx.sandbox` (`ctx.sandbox.confine(argv, policy)` via `bwrap`/Landlock) | **Built-in**: `SandboxPolicy` + Linux `bubblewrap` / macOS `Seatbelt` OS sandbox + `PermissionEngine`. | **Notify user.** Do not re-implement local OS sandboxing. Only port external container/microVM execution backends via `platform.entry` `contracts.tool`. |
| `ctx.session` / `dsh-session` (append-only session logs & replay) | **Built-in**: `DurableEventLog` (`events.jsonl`) with `fsync`, crash recovery, dialogue branching, session search/export. | **Notify user.** Only port custom database backends (e.g., PostgreSQL/SQLite sync) via `platform.entry` `contracts.storage` (`scope: "project"`). |
| `ctx.subagent` (`spawn` fresh / `fork` inherited child agents) | **Built-in**: `task` tool (`explore`, `implement`, `review` + custom `.flecten/agents/`), dedicated subagent tabs, Talker/Worker split. | **Notify user.** Port custom subagent personas into `.flecten/agents/<name>.md`. |
| `ctx.userInteraction` (`ask_user_question`, approvals) | **Built-in**: `ask` tool, `PermissionEngine` approval dock, interactive HTML `<summary>` feedback, MCP elicitation. | **Notify user.** Do not re-implement user prompts; use `ask`, MCP elicitation, or Module `surface` UI. |
| `ctx.skills` (modular skill loader) | **Built-in**: Agent Skills (`SKILL.md` + lazy `skill({ name, resource })`). | **Notify user.** Copy/adapt skill Markdown files directly into `.flecten/skills/<name>/SKILL.md`. |
| `ctx.memory` (`~/.dsh/memories`) | **Built-in & stronger**: Quote-verified `.flecten/memory.json` (`memory` tool) + Twin (note: Twin already imports `~/.dsh/memories` and `.jsonl.zst` DSH sessions!). | **Notify user.** Do not duplicate memory storage. |
| `dsh-web` / web UI skin / Tauri/CLI wrapper (`deepseek-harness-cli`) | **Built-in**: Flecten desktop app (Electron + Svelte 5 + IDE + HTML summaries). | **Notify user.** Port ONLY domain-specific interactive views (dashboards, timelines, visual inspectors) as Flecten Module `surfaces`. |
| Auxiliary vision / compression routing plugins | **Built-in**: `vision` fallback config, `translation` config, `PageWriter` compaction. | **Notify user.** Configure natively via `Settings > Models`. |

## 3. Complete DSH / Cordis -> Flecten Mapping

Notice the striking conceptual alignment between Cordis and Flecten's **Module Platform SDK (`platform.entry`)**! Both support reversible effects, typed cross-module services, dependency graphs, and hot-reloading without tearing down the host.

### A. Tool Plugins (`@deepseek-ai/dsh-tools` `defineTool` + `ctx.tools.register`)

DSH tool parameter schema uses declarative JSON-like parameter descriptors:
```ts
parameters: {
  path: { type: "string", required: true, description: "Target path" },
  limit: { type: "number", required: false, default: 20 },
}
```
Flecten adaptation in Module `runtime.entry`:
- Translate DSH parameter descriptors (`type: "string" | "number" | "integer" | "boolean" | "array" | "object"`, `required`, `default`, `enum`, `items`, `properties`) into **Zod** using host-injected `z` (`z.object({ path: z.string(), limit: z.number().default(20).optional() })`).
- Translate `output.render(args, value)` into standard MCP `content` blocks (`{ type: "text", text }`, or `{ type: "image", data, mimeType }` for visual tools; Flecten saves MCP images as durable attachments automatically!) plus optional `structuredContent`.
- List pure read-only tools in `manifest.runtime.readOnlyTools`.
- Replace `exec.signal` / Cordis disposal with cleanup callback returned from `runtime.entry`.

### B. Cordis Lifecycle, Effects, Services, and Dependency Injection

| Cordis / DSH primitive | Flecten equivalent | Exact adaptation |
|---|---|---|
| `export const name = "foo"` | `module.json` `"name": "foo"` | Must match kebab-case `ModuleIdSchema`. |
| `export const inject = ["svcA", "svcB"]` | `module.json` `"requires": ["mod-a", "mod-b"]` + `services.require(contract)` in `platform.entry` | Flecten enforces DAG dependency ordering atomically (rejecting cycles/missing/untrusted deps) and leases service snapshots across in-flight async calls! |
| `class MyService extends Service { super(ctx, "myService") }` | `defineService("my.service@1", InputSchema, OutputSchema)` + `services.provide(contract, handler)` in `platform.entry` | Flecten validates every cross-module service call's input and output with Zod schemas at the boundary. |
| `ctx.effect(() => { ...; return cleanup; })` | **`await effect(() => { ...; return cleanup; })`** in `platform.entry`, or returned cleanup function in `runtime.entry` | Identical reversible-effect semantics: cleanups run in reverse order on rollback or unload! |
| `ctx.plugin(ChildPlugin, cfg)` | Compose helper functions inside `runtime.entry`/`platform.entry`, or split into separate modules linked with `requires`. | Keep one responsibility per file (soft 300 / hard 500 lines). |
| `export const Config = Schema.object(...)` (Schemastery) | **Zod** (`z.object(...)`) validating a module config file or tool inputs. | Never add `schemastery` as a dependency; translate Schemastery (`Schema.string()`, `Schema.number()`, `Schema.boolean()`, `Schema.union()`, `Schema.array()`, `Schema.dict()`, `.default()`, `.description()`) directly to host-provided Zod `z`. |
| `ctx.on(event, fn)` (`emit` / `parallel` / `serial` / `bail` / `waterfall`) | **Blocking (`bail`):** Flecten `hooks` (`preToolUse`, `userPromptSubmit`, `sessionStart`, `permission`, `compact`, `subagent`, `toolBatch`) returning `{ decision: "deny" }`. **Middleware (`waterfall`):** `services.wrap(contracts.agent\|model\|tool\|compact\|storage, next => ...)` in `platform.entry`. **Observer (`emit`/`parallel`):** `hooks.postToolUse` / `stop` / `sessionEnd` / `notification`. | Choose `hooks` first for simple guards/observers; use `platform.entry` `services.wrap` only when chaining/transforming runtime calls in-process. |
| `cordis.patch.yml` / `dsh.yml` profiles | `flecten.config.json` + per-chat Module activation (`module` tool) + `modules.interfaces` for persistent UI shells | Flecten activates task modules per chat on demand (zero prompt tokens when inactive) and boots `platform.scope: "project"` modules before session replay. |
| Web UI bundle (`packages/bundle/web-app` / frontend slot) | Module `surfaces[]` (self-contained HTML bundle + `flecten.call` / `flecten.harness`) + optional `styles[]` | Build frontend bundle into a single inline HTML file (<= 8 MiB, zero external network loads) and expose backend operations via `runtime.entry` tools declared in `surface.tools`. |

## 4. Adapting DSH "Everything-Is-A-Plugin" Mindset to Flecten

1. **Resist over-modularizing:** A DSH plugin pack might split 1 feature across 4 Cordis plugins (service + tool + prompt + web component) wired via `cordis.patch.yml`. In Flecten, consolidate that single user capability into **one cohesive Module** (`module.json` + `instructions.md` + `runtime.mjs` + optional `panel.html`), or an even simpler Skill/Hook if no runtime code is needed.
2. **Respect Flecten's security boundary:** DSH `ctx` plugins run in-process with shared memory; Flecten isolates standard tools in a child Bun process (`runtime.entry`), sandboxes UI in opaque-origin iframes (`surfaces`), and reserves in-process `platform.entry` strictly for core service overrides with explicit Settings visibility. Always prefer `runtime.entry` over `platform.entry` unless replacing/wrapping `contracts.agent`, `contracts.model`, `contracts.tool`, `contracts.compact`, or `contracts.storage`, or exporting a shared `defineService`.
3. **Preserve KV cache:** Never translate a Cordis system-prompt contributor into per-turn `contracts.model` system-prompt mutation (Flecten rejects prefix mutation on wrapped `ModelRequest`s). Put instructions in `module.json` `"instructions"` so Flecten appends them cleanly at module activation.
