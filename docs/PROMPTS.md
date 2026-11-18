# Prompts

Prompt templates live in `prompts/`, and system context assembly lives in `src/core/prompt.ts`. Model-facing context uses standard Markdown, unabbreviated field names, and native provider tool calls.

## System Context Assembly

`buildPrompt` concatenates required sections followed by optional budget-bounded extensions:

1. `base.md`, `talker.md`, or `worker.md`: defines the session role and behavioral boundaries without duplicating tool schemas or generic coding boilerplate. Talker communication rules live in `talker.md`.
2. `response-summary.md`: configures HTML summaries for final user-facing deliverables, inline UI controls, and references to native harness menus (simple facts use a plain HTML paragraph, while multi-part deliverables use structured sections, lists, tables, and actions; interim progress and questions stay in Markdown, and explicit user format requests take precedence). Excluded when `responseFormat: "structured"`; Worker receives Markdown-only `worker-response.md` instead.
3. `# Environment`: working directory, OS platform, and current UTC date.
4. `# Instructions`: discovered instruction files annotated with source tier, file path, and subtree scope.
5. Explicit caller sections: subagent role prompt, required output JSON Schema, skills catalog, and MCP catalogs/instructions.

Tool names, descriptions, and input JSON Schemas pass through native provider tool definitions: their token footprint counts toward prompt budget, but schemas are never duplicated inside system prompt prose. Prompt selection never branches on model name strings.

## Tool Contracts

Each tool's authoritative contract lives in its description and JSON Schema in the active registry rather than in redundant system-prompt summaries (an expanded capability-fragment base prompt showed no measurable gain in controlled runs and was dropped in favor of the compact default).

## Project Instructions and Trust

`src/context/instructions.ts` loads instruction files in tier order:

- **Managed**: system-wide `AGENTS.md` (`/etc/flecten/AGENTS.md` on Linux).
- **User**: `~/.config/flecten/AGENTS.md` and `~/.flecten/AGENTS.md`.
- **Project**: `AGENTS.md` and `CLAUDE.md` in the workspace root.
- **Local**: `AGENTS.local.md` in the workspace root.
- **Nested**: `AGENTS.md` and `CLAUDE.md` in subdirectories (annotated with `Applies to files under`), preloaded only when nested preloading is explicitly enabled.

By default, nested subdirectories are not crawled upfront: instead, the model is instructed to read `AGENTS.md` and `CLAUDE.md` along paths it touches and apply them only within their respective subtrees, preventing sibling projects from polluting context when opening a monorepo or parent folder.

Combined instruction text is capped at 65,536 bytes, enforced before reading oversized files into memory. Exceeding the cap in required tiers (`managed`, `user`, `project`, `local`) fails prompt assembly with an explicit error naming the offending path, while overflow during explicit nested preload defers excess files with an in-context notice. Nested discovery defaults to max depth `3` (configurable up to `16`), max `32` instruction files, `1,000` directories, and `10,000` directory entries, skipping symlinks, hidden directories, and build/cache folders. Duplicate Markdown headings with differing bodies emit diagnostic conflict warnings without attempting automatic semantic resolution.

Project trust gates executable extensions: untrusted workspaces block project hooks, project MCP servers, project subagent definitions, and module code until trusted, at which point extensions, tool registries, and system prompts rebuild. Merely reading `AGENTS.md` or `CLAUDE.md` never authorizes shell execution or extension loading.

Outputs from files, shell commands, web fetches, and MCP tools carry explicit provenance headers and remain untrusted data unable to grant permissions or override instruction hierarchy.

## Skills and MCP

System prompts include only a compact catalog of available skills (`skills-catalog.md`), while full `SKILL.md` bodies load on demand via `skill` (or `skill-command.md` on slash invocation, without interpolating raw user strings into `base.md`). Untrusted skills cannot activate; an active skill's `allowedTools` can narrow subsequent tool calls within the session (cached per file revision) without expanding permissions.

MCP server instructions (`mcp-instructions.md`) and resource/prompt catalogs (`mcp-catalogs.md`) enter context as advisory external data bounded by explicit trust markers, leaving argument validation and permission checks intact on every call.

## Subagents

`task` launches an isolated child session sharing the workspace tree while maintaining its own message history, tool registry, permission intersection, and budget. Parents pass an explicit task prompt and optional `context` snippet rather than cloning full conversation history.

Child system prompts include `base.md`, project instructions, the role prompt from `prompts/subagents/`, and `# Required result schema` (without user-facing HTML summary instructions):

| Role | Scope | Budget | Output schema fields |
|---|---|---|---|
| `Explore` | Read-only codebase reconnaissance (no writes or shell) | 12 turns, 24,000 tokens | `summary`, `files`, `findings`, `openQuestions` |
| `Implement` | Code changes and verification in shared worktree | 40 turns, 96,000 tokens | `summary`, `filesChanged`, `testsRun`, `blockers` |
| `Review` | Read-only audit with read-only Git inspection | 20 turns, 48,000 tokens | `verdict`, `findings`, `evidence` |

Child outputs are schema-validated on completion; aborts, token exhaustion, or turn caps return structured incomplete results, and any call requiring interactive approval fails immediately rather than prompting the user.

## Continuation and History Compaction

`continue.md` and state-specific fragments under `prompts/loop/` resume interrupted turns on explicit runtime states: provider `max_tokens` cutoff, empty model output, incomplete protocol state, open goal criteria, or truncated tool-call JSON (truncated calls never execute; the model must reissue full arguments).

`page-summary.md` runs in an isolated compaction call treating the entire transcript, prior summaries, and tool outputs as untrusted data. Instead of continuing the task, the summarizer returns a JSON object (`progress`, `locations`, `instructions`, `nextSteps`, `risks`) mapped into the five page fields (`changed`, `where`, `rules`, `next`, `risks`).

Compaction pairs tool calls with results by `Tool call ID` and name: an unanswered call does not prove execution, an error does not prove zero side effects, and a started background job does not prove successful completion. If model summarization fails (or `runLoop` runs without a model writer), a deterministic fallback builder produces the same five-field `ContextSummary`.

Typed `ContextSummary` payloads persist through `context.compacted` events and replay so subsequent compactions merge structured fields without reparsing Markdown, respecting `targetTokens` (accounting for page/log path references and evicting oldest excerpts first; raw user prompts stay intact while the summary's prompt copy caps at 4,000 characters).

When Worker has the `context` tool enabled, `context-pages.md` enforces single-subtask page lifecycles (`begin -> complete -> archive/compact`) and `loop/continue-page.md` blocks final replies until the active page is closed, keeping context-window thresholds as a fallback safety net (Talker compacts by window utilization). Archived pages remain searchable via session-scoped `list`, `read`, and `search`, returning untrusted data.

## Prompt Budget and Versioning

System prompt budget defaults to 24,000 estimated tokens (`context.promptBudget`, or `FLECTEN_PROMPT_BUDGET_TOKENS` at build/startup). Required rules, project instructions, role definitions, result schemas, and tool schemas are never truncated; optional catalogs shrink or drop first, and exceeding budget with required sections alone sets `overBudget: true`.

Every `session.started` event records a prompt stamp: semantic `version`, `base` hash, full `hash` (including tool schemas), token estimate, budget, and per-section status plus instruction file paths and tiers (never raw instruction text; whitespace-only edits preserve `version` and `base` while updating `hash`).

## Authoring and Packaging

`base.md` is resolved from disk at prompt-build time (`FLECTEN_PROMPTS_DIR`, executable directory, repository `prompts/`, then `cwd`), whereas remaining prompt fragments are bundled via Bun text imports (requiring a rebuild and sidecar restart for packaged binaries; active sessions keep their initial compiled prompt).

All prompts are written in English without secrets or machine-specific paths, raw user messages are preserved verbatim, and unused legacy templates (`twin-spec.md`, `critic.md`, `grounding.md`) have been removed. Schema-enforced field constraints are not duplicated in prose unless a downstream call omits native JSON Schema transport.
