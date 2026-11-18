# Modules

A module packages tools, instructions, reference guides, hooks, a native Bun runtime, platform service overrides, and custom HTML interfaces into a single unit. Agents discover and activate modules per chat through the built-in `module` tool: inactive packages add zero instructions, hooks, or tool schemas to model requests. Explicitly trusted project-scoped platform services load ahead of session recovery so storage adapters can replace the event journal cleanly.

In Talker/Worker chats, both roles and any mounted UI surfaces share one module instance bound via explicit `shareSession` at conversation creation (never inferred from session ID strings). Other chats keep isolated module instances, and model histories, event streams, permissions, and per-call actors remain separate. Talker receives a restricted `module` schema (`list`, `status`, `tools`, `read`), while Worker handles `activate`, `call`, and `deactivate`.

## Installation and Trust

Open **Settings > Modules > Marketplace** to browse configured catalogs. **Install module** downloads and verifies the package snapshot plus missing dependencies into `.flecten/modules/<name>` without executing code, granting trust, or overwriting existing directories. Switch to **Installed**, inspect each new package, and click **Trust this version**; agents see trusted modules immediately without restarting the app.

If a project contains executable configuration when opened, the first module activation prompts **Trust project?** inline in chat, showing the folder path and requested capabilities. **Trust and continue** grants project trust for the current session of the open workspace and resumes the pending call; declining, stopping, or timing out keeps execution blocked. Project trust is independent from per-revision SHA-256 module trust, which is always required.

The built-in marketplace catalog is empty; add HTTPS catalogs under **Catalog sources** (removing a catalog source preserves already installed packages) or install local directories via **Installed > Install from folder**. Catalog and bundle schemas are documented in [MODULE-MARKETPLACE.md](MODULE-MARKETPLACE.md).

For local authoring, place a module in `.agents/modules/<name>`, trust its current revision, and optionally toggle **Reload local changes automatically** in its details pane (off by default, as enabling it explicitly trusts future edits in that folder).

Repository test fixtures illustrate key capabilities (installable from folder in a dev checkout, not bundled in release installers):

- [better-trailer](../tests/fixtures/modules/better-trailer/): instructions, pacing guide, native MCP runtime, and HTML timeline calculating frame counts and timing (without video encoding).
- [Computer Use](COMPUTER-USE.md): isolated Linux display, dedicated browser profile, native MCP images, observation-ID-checked input actions, and human takeover, with OS prerequisites and access boundaries shown upfront.
- [studio-harness](../tests/fixtures/modules/studio-harness/): full UI replacement providing custom chat navigation, composer, run controls, approvals, and a saved project brief. Enable it via **Use module interface** after trusting the revision; mounting a module interface applies project-wide (even before the first prompt) without calling the model or injecting instructions, while UI tool calls start the backend runtime lazily.

## Package Layout and Manifest

```text
better-trailer/
  .flecten-module/module.json
  instructions.md
  guides/pacing.md
  runtime.mjs
  timeline.html
```

Only `schemaVersion`, `name`, `version`, and `description` are required; all other fields are optional and strictly validated by `src/modules/manifest.ts`. Authors define arbitrary `capabilities` tags; the harness contains no hardcoded task classifier or module taxonomy.

```json
{
  "schemaVersion": 1,
  "name": "better-trailer",
  "version": "1.0.0",
  "description": "Plan, inspect and verify trailer timing",
  "capabilities": ["video", "trailers"],
  "requires": [],
  "conflicts": [],
  "instructions": ["instructions.md"],
  "resources": [
    { "id": "pacing", "path": "guides/pacing.md", "description": "Pacing guide" }
  ],
  "runtime": { "entry": "runtime.mjs" },
  "surfaces": [
    {
      "id": "timeline",
      "title": "Trailer timeline",
      "entry": "timeline.html",
      "tools": ["mcp_module_better-trailer__runtime_timeline"],
      "resources": ["pacing"]
    }
  ]
}
```

`instructions` load into chat context upon activation, while larger reference manuals belong in `resources` for paginated on-demand reads. Every path must be relative to the package root: `..` traversal, absolute paths, symlinks, and special files are rejected. Packages are capped at 32 MiB and 5,000 files; keep large binaries or model weights external.

`requires` lists module names that must activate before the consumer and stay active until the consumer deactivates. Dependency cycles, missing or untrusted dependencies, and `conflicts` fail validation atomically before mutating active state.

## Native Runtime SDK

`runtime.entry` exports a default setup function executed in a dedicated child process of Flecten's embedded Bun runtime (including inside packaged desktop builds, requiring no external Bun, MCP SDK, or Zod installation):

```javascript
export default ({ apiVersion, server, z, workspace, moduleRoot }) => {
  server.registerTool("measure", {
    description: "Convert a duration to whole frames",
    inputSchema: z.object({ seconds: z.number().positive() })
  }, async ({ seconds }) => ({
    content: [{ type: "text", text: String(Math.round(seconds * 24)) }]
  }));
};
```

`ModuleHost` and `ModuleSetup` types live in `src/modules/sdk.ts` (`apiVersion` is `1`). `server` is a standard `@modelcontextprotocol` `McpServer` supporting tools, resources, prompts, and catalog-change notifications, exposed through the module gateway.

Optional `runtime.readOnlyTools` lists exact canonical tool names (for example, `mcp_module_computer-use__runtime_status`) covered by the trusted revision's SHA-256. Listed tools evaluate against the `read` permission policy rather than mutating `mcp` policy (external MCP `readOnlyHint` annotations alone never grant this), while explicit `mcp` deny rules, parent restrictions, and human checkpoints still take precedence. Changing `readOnlyTools` invalidates the revision hash and requires re-trusting; authors remain responsible for ensuring listed tools have no side effects, as trusted native processes run with the user's OS account privileges.

Setup may return a sync or async cleanup callback, invoked once and awaited on transport close, `SIGTERM`, or `SIGINT` to tear down child processes, temp profiles, and sockets cleanly (do not rely on `process.on("exit")` for async teardown).

Waiting on an interactive permission approval pauses execution timeouts on both the tool call and enclosing module gateways, resuming with remaining budget once resolved (approvals keep their own expiration deadline, and user stop or run abort signals still cancel immediately).

`workspace` points to the project root, while `moduleRoot` points to an immutable per-revision staging snapshot deleted when the runtime closes; persist durable state under `workspace` or an external data directory rather than `moduleRoot`.

Native runtimes have full access to Bun/Node APIs, child processes, OS interfaces, browser automation, and network services. MCP image and audio tool outputs are validated and stored as durable session attachments (delivered natively to multimodal models and restored on reopen without writing base64 into JSONL or text logs). Never bundle credentials inside a module directory, as all package files are hashed and copied into snapshots.

## Platform Service Overrides (`platform`)

A module can also declare `platform.entry` to wrap or replace internal core services within the same SDK model:

```json
{
  "platform": { "entry": "platform.mjs", "scope": "session" }
}
```

`scope: "session"` activates within the current chat (driver replacements take effect on the next run; model, tool, and compaction overrides apply before their next invocation). `scope: "project"` loads after both project and revision trust are granted, prior to session history recovery, and is surfaced explicitly in Settings before trusting; `harness.storage@1` requires `scope: "project"`.

Types live in `src/modules/platform-sdk.ts`. Setup receives `{ workspace, moduleRoot, sessionId, signal, z, defineService, contracts, services, effect }` and runs in-process inside the sidecar with full sidecar privileges. Schema validation and permission checks do not sandbox in-process code: authors must honor `AbortSignal`, emit valid protocol events, respect resource limits, and write state outside `moduleRoot`.

| Contract | Replaced seam |
|---|---|
| `contracts.agent` (`harness.agent@1`) | Run driver (`prompt` + `LoopOptions` -> `LoopResult`); wrap or fully replace the agent loop |
| `contracts.model` (`harness.model@1`) | Primary agent model stream (`ModelRequest`, `signal`, `provider` -> `AsyncIterable<ModelEvent>`) |
| `contracts.tool` (`harness.tool@1`) | Post-validation, post-permission tool execution under standard timeouts, retries, and logging |
| `contracts.compact` (`harness.compact@1`) | Automatic and manual history compaction, including in idle chats |
| `contracts.storage` (`harness.storage@1`) | Session event journal and index (`append`, `read`, `list`/`search`, `rename`, `fork`, `delete`), plus replay, recovery, and retention |

Message queues, attachments, checkpoints, context pages, and background jobs remain in standard workspace files, and dedicated translation or `PageWriter` requests bypass `contracts.model` (override `contracts.agent` or `contracts.compact` to customize them). Switching `contracts.storage` does not auto-migrate existing JSONL sessions; disabling the module restores the built-in file backend while leaving module database files intact.

```javascript
export default async ({ services, contracts, effect }) => {
  const controller = new AbortController();
  await effect(() => () => controller.abort());
  services.wrap(contracts.model, next => async (request, signal, provider) => {
    return next(request, signal, provider);
  });
}
```

`services.provide(contract, handler)` registers a new typed service (rejecting duplicate IDs), `services.replace` swaps an existing implementation, and `services.wrap` chains around `next` in deterministic order (dependencies before consumers, `project` scope before `session` scope):

```javascript
const frames = defineService(
  "trailer.frames@1",
  z.object({ seconds: z.number().positive(), fps: z.number().int().positive() }),
  z.object({ frames: z.number().int().positive() })
);
services.provide(frames, async ({ seconds, fps }, signal) => {
  signal.throwIfAborted();
  return { frames: Math.round(seconds * fps) };
});
// In a consumer module declaring requires: ["frame-service"] with matching schemas:
const measure = services.require(frames);
// Invoke inside a handler after setup completes:
const result = await measure({ seconds: 2, fps: 24 }, signal);
```

Every service call validates inputs and outputs with Zod. Schema mismatches, missing dependencies, or duplicate `provide` registrations abort activation atomically. `effect` cleanups run in reverse order on rollback or unload before deleting source snapshots, surfacing any cleanup errors in module status.

Each in-flight call leases a consistent snapshot of composed services until its `Promise` or async stream settles, so hot-reloading a dependency mid-call affects only subsequent calls and cancels the old lifecycle `signal` once the last lease drains. Note that synchronous infinite loops inside in-process JS cannot be preempted, and Bun retains imported ESM modules in process memory until sidecar restart (offload frequently reloaded heavy code to a worker or `runtime.entry`).

Custom `contracts.agent` drivers return a validated `LoopResult` and emit typed `LoopEvent` items via `options.emit` to share UI projection, budgets, and durable logging. See [frame-workflow](../tests/fixtures/modules/frame-workflow/) (paired with [frame-service](../tests/fixtures/modules/frame-service/)) and [sqlite-journal](../tests/fixtures/modules/sqlite-journal/) (`bun:sqlite` storage backend in `.flecten/module-journal.sqlite`). Active service owners, IDs, and modes appear in Settings and `module status`, consuming zero prompt tokens when no instructions are attached.

## MCP-Only Modules

A module needs neither `runtime`, `instructions`, nor `surfaces` to wrap an external MCP server:

```json
{
  "schemaVersion": 1,
  "name": "twitter",
  "version": "1.0.0",
  "description": "Search and read posts using the configured Twitter MCP service",
  "mcp": { "servers": { "x": { "url": "http://127.0.0.1:3100/mcp" } } }
}
```

Both `stdio` and Streamable HTTP transports are supported alongside `allowTools`, `readOnly`, timeouts, custom headers, and OAuth (reusing the native consent dialog and backend secret store; pending OAuth keeps the module active and appends the refreshed tool catalog once authorized). Servers use namespace `module_<module>__<server>` and tool names `mcp_module_<module>__<server>_<tool>` (shortened deterministically with a hash by `mcpToolName` when exceeding length limits; inspect exact names via `module tools`).

## Module Hooks

Manifest `hooks` reuse the standard hook event, command, and HTTP schemas (`HOOKS.md`), running only in chats where the module is active and respecting timeouts, aborts, schema validation, logging, and permission policies:

```json
{
  "hooks": {
    "preToolUse": [
      {
        "command": "node \"$FLECTEN_MODULE_ROOT/hooks/check.mjs\"",
        "matcher": { "tool": "write" },
        "timeoutMs": 1000
      }
    ]
  }
}
```

`FLECTEN_MODULE_ROOT` resolves to the active revision's snapshot directory. Mid-run activation applies hooks to subsequent events without replaying an already passed `sessionStart`, and installing a module never runs install scripts.

## Custom HTML Surfaces and Shell Replacement

Each `surfaces` entry mounts a workspace tab in active chats from a self-contained HTML bundle (`entry`) with inline CSS/JS built with any frontend framework.

When **Use module interface** is enabled, surfaces declaring `placement` mount into matching DOM selectors and `styles` load bundled CSS overrides from the trusted revision (removed immediately on disable or trust revocation):

```json
{
  "styles": ["theme.css"],
  "surfaces": [{
    "id": "shell",
    "title": "My harness",
    "entry": "shell.html",
    "placement": {
      "selector": "[data-harness-region=\"shell\"]",
      "position": "replace",
      "order": 10
    },
    "harness": {
      "state": true,
      "events": true,
      "commands": ["run", "stop", "sessions.new", "sessions.select", "settings.open"]
    }
  }]
}
```

`position` accepts `"replace"`, `"before"`, `"after"`, `"prepend"`, or `"append"` against the first matching element, tracked dynamically across component remounts via `MutationObserver`. Competing `"replace"` mounts resolve by highest `order`, breaking ties by module name and surface ID; style portal containers via `[data-module-portal="module:surface"]`. Prefer stable `[data-harness-region]` targets (`shell`, `titlebar`, `sidebar`, `workspace`, `header`, `composer`) over internal component classes.

Authorized surfaces access a typed host bridge:

```javascript
const state = await flecten.harness.snapshot();
await flecten.harness.request({ type: "run", prompt: "Build this project" });
const unsubscribe = await flecten.harness.subscribe(async (event) => {
  const next = await flecten.harness.snapshot();
  render(next);
});
```

Snapshots expose workspace info, active chat, messages, session list, phase, `running`, `provider`/`model`, available models, approvals, usage, budget, queue, and jobs (excluding raw settings payloads and secrets), while `subscribe` streams active chat events and deltas. Every bridge call re-verifies revision SHA-256, trust, and explicit `harness.commands` grants on the backend (no wildcards). `run`, `stop`, and `model.set` route through the shared UI store; UI-level commands include `sessions.new`, `sessions.select` (`id`), `settings.open`, and `window.control` (`minimize`, `maximize`, `close`), while other allowlisted commands forward to the sidecar.

Surfaces granted `"interface.styles"` in `harness.commands` can update runtime CSS up to 256,000 characters (static CSS files cap at 256,000 bytes; passing `""` clears dynamic rules):

```javascript
await flecten.harness.request({
  type: "interface.styles",
  css: ":root{--bg:#202122;--surface:#292c30}"
});
```

**Restore native interface** or `Ctrl+Shift+F12` (supported both inside and outside iframes, and persisted across restarts until **Resume module interfaces**) detaches all module CSS and placements without interrupting active chats or jobs.

Every surface iframe also receives theme tokens and a scoped tool/resource bridge:

```javascript
const tools = await flecten.tools();
const result = await flecten.call("mcp_module_better-trailer__runtime_timeline", {
  framesPerSecond: 24,
  shots: [{ title: "Opening", seconds: 2 }]
});
const guide = await flecten.read("pacing");
```

`tools`, `call`, and `read` return `ToolResult` (`ok`, `output`, `error`) restricted to the `tools` and `resources` declared on that surface, running through standard schema validation, permissions, approvals, hooks, timeouts, and logs without injecting synthetic tool turns into model history. MCP `structuredContent` arrives at `result.data.structuredContent`, verified media attachments hydrate into `result.media` (`mediaType`, `data`) without polluting text logs, and native runtimes receive `ctx.mcpReq._meta["flecten.dev/invocation-origin"] === "module-surface"` (unforgeable by model tool arguments) to distinguish human UI actions from agent calls.

Surface iframes run on an opaque origin with `sandbox="allow-scripts allow-forms"` and a strict CSP (`form-action 'none'`, no direct network, filesystem, Node, nested frames, or top-level navigation; up to 8 MiB per HTML bundle with `data:`/`blob:` assets). See [studio-harness](../tests/fixtures/modules/studio-harness/) and [MODULE-EXAMPLES.md](MODULE-EXAMPLES.md).

## The `module` Agent Tool

| `operation` | Purpose |
|---|---|
| `list` | Paginated catalog (12 entries per page), optional exact `capability` filter |
| `activate` | Activate `name` and its `requires` graph in the current chat |
| `deactivate` | Drop explicit activation of `name` (shared dependencies stay while needed) |
| `status` | Active revisions, mounted surfaces, catalog summary, and errors |
| `tools` | Tool schemas for active module `name` (12 per page) |
| `call` | Invoke `tool` on active module `name` with `arguments` |
| `read` | Read chunk of `resource` from active module `name` (up to 12,000 characters) |

Catalogs and resources paginate via `offset` and `nextOffset`; module selection is driven explicitly by the model without regex or keyword heuristics.

## Hot-Load and Recovery

Filesystem watchers plus a 10-second fallback rescan detect edits while the UI polls every 2 seconds. New revisions apply before the next model turn while in-flight calls finish on their leased snapshot.

Modifying any byte of a standard module invalidates its SHA-256 trust and disables its runtime, hooks, and surfaces at the next safe boundary until re-trusted. In development mode, valid edits swap in automatically; if a new revision crashes on startup, the previous working active set stays intact, the failure reason is logged once to chat history, and retry waits for the next file revision.

Explicit chat activations persist in `.flecten/sessions/<id>/modules.json` alongside typed durable transcript snapshots (`fork` inherits activations from transcript state, and compaction re-delivers active instructions when prior snapshots fall out of the window). In Talker/Worker chats, `<id>` belongs to the parent conversation (migrating legacy Worker-only `modules.json` files on link when no parent file exists, while giving precedence to any existing parent file including `[]`).

## Prompt-Cache Prefix Preservation

Each role keeps a constant `module` tool schema, immutable system prompt, and fixed provider tool list across module activations, deactivations, catalog refreshes, trust changes, and hot-reloads; updates append as ordinary messages or tool results at the tail of history with monotonic `contextRevision`. Platform wrappers delegating to built-in `contracts.agent`/`contracts.model` receive frozen `ModelRequest` objects and are rejected if they mutate the system prompt, provider tool schemas, or historical prefix (actual upstream cache hits remain subject to provider TTL, eviction, model switches, and compaction).

Defaults allow up to 16 active modules (`modules.maxActive`) and 32,000 combined instruction characters (`modules.contextCharacters`); exceeding context headroom fails explicitly rather than silently dropping instructions.

## Implementation and Tests

- `src/modules/`: manifests, snapshots, catalog/watcher, dependency solver, runtime generations, and MCP gateway.
- `src/core/modules/`: session port and append-only context delivery.
- `src/app/modules.ts`, `module-handlers.ts`: installation, trust, and sidecar RPC handlers.
- `ui/src/components/settings/ModulesSettings.svelte`, `ModuleSurface.svelte`: settings UI and sandboxed surfaces.
- `src/core/services/`, `src/modules/platform.ts`, `project-platforms.ts`, `src/app/session-storage.ts`: typed service contracts, lifecycle leases, atomic project-service publication, and pluggable journal storage.
- `tests/integration/modules.test.ts`, `module-lifecycle.test.ts`, `conversation-modules.test.ts`, `module-read-only.test.ts`, `module-interface.test.ts`, `module-platform.test.ts`, `module-contracts.test.ts`, `module-journal.test.ts`, plus `tests/e2e/modules.spec.ts` and `tests/e2e/module-interface.spec.ts` (`1480x940` and `1180x640`).
