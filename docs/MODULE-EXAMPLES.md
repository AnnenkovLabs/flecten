# Module Examples and Patterns

A module can combine instructions, lazy reference guides, MCP servers, a native Bun runtime, hooks, CSS, and custom HTML surfaces in any combination; none of those parts is mandatory on its own. See [MODULES.md](MODULES.md) for exact manifest and SDK contracts.

## SDK Test Fixtures

Reference modules live under `tests/fixtures/modules/` to exercise SDK contracts in automated tests. They are not bundled in the built-in marketplace or release installers, though you can load them from a repository checkout via **Install from folder**.

| Module | Implemented capabilities |
|---|---|
| [computer-use](../tests/fixtures/modules/computer-use/) | Isolated Linux X display, live screenshots, observation-ID-checked input actions, human control handoff, and the Computer workspace surface. See [COMPUTER-USE.md](COMPUTER-USE.md). |
| [better-trailer](../tests/fixtures/modules/better-trailer/) | Instructions, pacing guide, native frame-timing tool, and interactive HTML timeline for trailer pre-production (no video encoding or rendering). |
| [studio-harness](../tests/fixtures/modules/studio-harness/) | Full shell replacement atop the core: conversations, message stream, run/stop controls, approvals, theme switcher, and persistent project brief. |
| [frame-workflow](../tests/fixtures/modules/frame-workflow/) + [frame-service](../tests/fixtures/modules/frame-service/) | Custom deterministic agent driver plus typed cross-module service calls computing frame counts from a local brief. |
| [sqlite-journal](../tests/fixtures/modules/sqlite-journal/) | Custom SQLite-backed event journal and session index supporting reopen, fork, and crash recovery. |

## Custom Interfaces and Standalone Products

The patterns below illustrate packages you can build on the module system (they are not preinstalled integrations):

| Example package | User workflow | Building blocks |
|---|---|---|
| `theme-studio` | Custom color palette, bundled fonts, density, sizing, spacing, and in-module theme switcher. | Bundled CSS, HTML surface, `interface.styles` grant. |
| `focus-workspace` | Strip secondary panes, widen the editor, replace the composer, and relocate navigation. | CSS overrides, selector `placement`, host commands. |
| `accessible-workspace` | High-contrast palette, large typography, simplified controls, and custom layout. | CSS plus targeted HTML surface replacements. |
| `my-harness` | Standalone product with custom navigation, session history, composer, and workflow. | `shell` region replacement, `snapshot`/`subscribe`, host commands, native runtime. |
| `research-desk` | Sources on the left, notes in the center, claim verification inline. | Custom shell, search MCP, methodology resources, notes runtime. |
| `review-room` | Diff-first code review with findings and decisions upfront and chat as a side pane. | Workspace replacement, `files.*`/`files.git` commands, hooks, review guides. |
| `operations-console` | Task monitor, log viewer, spend tracker, and one-click runbooks. | `snapshot`/`subscribe`, HTML dashboard, backend tools. |

Surfaces compile down to a single self-contained HTML bundle using Svelte, React, Vue, or vanilla JavaScript; the SDK imposes no proprietary widget DSL. Major regions expose stable `data-harness-region` attributes, while finer overrides can target standard CSS selectors. Native OS windows and core loop state machines remain outside DOM placement scope.

## Agent Workflows, Creative Tools, and Engineering

| Example package | User workflow | Building blocks |
|---|---|---|
| `better-trailer-pro` | Brief, storyboard, clips, music sync, preview, and trailer export. | Instructions, guides, FFmpeg/video runtime, timeline surface, output-validation hooks. |
| `computer-use` | Additional OS, VM, or cloud desktop backends behind the computer-use contract. | Same observation/handoff contract verified against the product test suite. |
| `browser-lab` | Scripted browser flows, screenshots, visual diffs, and step inspector. | Headless browser runtime, tools, image attachments, custom inspector UI. |
| `blender-workshop` | Scene assembly, rendering, visual inspection, and iterative tweaks. | Blender CLI runtime, guides, tools, image attachments, scene panel. |
| `game-workshop` | Asset pipeline, game process launch, session control, and live telemetry. | Managed runtime processes, tools, instructions, HTML control surface. |
| `data-lab` | SQL queries, tabular views, charts, and reproducible notebooks. | Database MCP or local runtime tools, analysis guides, results surface. |
| `document-studio` | Docs, slide decks, PDFs, and post-render page inspection. | Rendering libraries in runtime, templates/resources, preview surface, hooks. |
| `voice-workspace` | Dedicated audio player, transcription browser, and recording analysis. | Runtime/MCP audio tools, audio attachments, custom UI. |
| `test-lab` | Test matrix runner, failure artifacts, diagnostics, and run comparison. | Backend runner tools, hooks, HTML report viewer. |
| `release-workspace` | Release checklist, changelog drafting, artifact build, and verification. | Instructions, guard hooks, Git/build tools, custom workflow surface. |
| `project-expert` | Domain architecture knowledge loaded only when relevant to a chat. | Concise instructions, lazy wiki `resources`, optional helper tools. |
| `team-rules` | Shared engineering conventions and automated pre-tool checks. | Instructions and hooks alone, without runtime code or UI. |

External binaries (such as FFmpeg or Blender), browser drivers, API keys, and paid upstream services come from the host environment or the package itself; the SDK manages wiring, permissions, and lifecycle.

## External Service Connectors

| Example package | Workflow |
|---|---|
| `twitter` | Search and read posts via MCP using a manifest with only an `mcp` block. |
| `github-workspace` | Triage issues, PRs, CI checks, and code reviews in a dedicated view. |
| `design-workspace` | Inspect design specs and export assets via a design-tool MCP server with live preview. |
| `knowledge-base` | Query internal documentation and pull relevant pages into chat context on demand. |
| `support-desk` | Load ticket context, customer history, draft replies, and support actions. |
| `calendar-workspace` | Inspect schedules, prep meeting briefs, and manage events through backend tools. |
| `observability` | Query metrics, error traces, and incident timelines during debugging. |

Capabilities follow the underlying MCP server or runtime API, OAuth credentials, and granted permissions; a connector can ship tools alone or pair them with domain instructions and custom surfaces.

## How Modules Compose

A user can enable `studio-harness` as the persistent project shell while the agent activates `better-trailer` on demand for a trailer task, pulling in its instructions, tools, and timeline tab. Modules declare hard dependencies via `requires` and mutually exclusive packages via `conflicts`.

Persistent UI shells, backend runtimes, and agent chat context have decoupled lifecycles: enabling a theme or shell neither triggers a model call nor injects agent instructions. Invoking a backend tool from a UI surface lazily activates its runtime for the active chat. In development mode, file edits hot-reload between calls while in-flight executions finish on their leased revision. Emergency UI recovery (**Restore native interface** or `Ctrl+Shift+F12`) strips module CSS and DOM placements immediately.

System prompts and provider tool definitions stay immutable within each role; module activations append snapshots to conversation history so upstream prompt caches remain valid (subject to provider cache TTL).

## Executable Core-Replacement Fixtures

- `frame-service` + `frame-workflow`: `frame-service` provides a schema-validated frame calculator, while `frame-workflow` replaces `contracts.agent` entirely and calls `frame-service` against a local `trailer-brief.json` with zero model calls. Integration tests verify UI event streaming, durable persistence/replay, and clean fallback to the built-in driver when a dependency is revoked.
- `sqlite-journal`: project-scoped `contracts.storage` adapter backed by `bun:sqlite`, implementing `append`, `list`/`search`, `read`, `rename`, `fork`, `delete`, reopen, and crash recovery (with in-database trash rather than migrating legacy JSONL files, while queues, attachments, and checkpoints stay in the workspace).
- `contracts.model` lets authors plug in custom inference transports or routers; `contracts.tool` redirects authorized tool execution to containers or remote hosts; `contracts.compact` supplies custom history compaction. All three seams are covered by integration tests.
- Combined with a full `shell` surface like `studio-harness`, module packages can ship a custom product UX, agent loop, model transport, tool backend, compaction policy, durable event store, and typed cross-module services without a separate host/client plugin API.
