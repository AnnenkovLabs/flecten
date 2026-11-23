---
name: convert-plugin
description: Convert an extension or plugin from Pi, Oh My Pi (OMP), OpenCode 1, OpenCode 2, or DeepSeek Harness (DSH) into idiomatic Flecten modules, skills, hooks, MCP servers, subagents, or commands, adapting to Flecten architecture and flagging capabilities Flecten already ships natively.
version: 1.0.0
argument-hint: "[source-path-or-repo]"
---

# Convert Plugin to Flecten

Port plugins and extensions from other coding-agent harnesses into Flecten by **adapting the underlying idea to Flecten's real architecture**, not line-by-line API translation.

## Core Rules

1. **Check native Flecten overlap first.** Many popular plugins from other harnesses solve problems Flecten already solves natively (often deeper or safer: Talker/Worker split, Twin 3D taste clone, AST+BM25 grep, quote-verified memory, shadow-Git shell undo, dialogue branching, interactive HTML summaries, provider failover, secret-vault provider protection, 114-term slang/layout dictionary, OS sandboxing, persistent PTY and background jobs, voice dictation, built-in IDE). If the source plugin's core idea already exists in Flecten or is better natively, **stop and notify the user** before writing code: explain what Flecten already provides, where to enable or use it, and offer to port only the genuine missing delta if any.
2. **Pick the smallest idiomatic Flecten primitive.** Do not wrap a prompt-only workflow in a `platform.entry` module or build a custom TUI widget for a desktop app that already has HTML summaries and sandboxed `surfaces`.
3. **Never blindly copy source-harness patterns that violate Flecten invariants:**
   - Keep system prompt prefixes and provider tool schemas byte-stable (use module `instructions` append-only context, not per-turn system-prompt mutation).
   - Validate all external inputs/outputs with Zod schemas; never drive core behavior with regexes or string heuristics.
   - Never store credentials or tokens inside a module directory (every module file is SHA-256 hashed into snapshots).
   - Never use `console.*` in core/module hooks that speak structured JSON on `stdout`, and never use em dashes (`U+2014`) in UI copy or docs.

## Reference Guides (Load On Demand)

Read only the guides relevant to the current conversion using `skill({ name: "convert-plugin", resource: "<path>" })`:

- `references/flecten-target.md` - **Read first.** Flecten native feature checklist (native-overlap detector), primitive decision matrix, and exact Flecten target contracts (Modules, `runtime.entry`, `platform.entry`, HTML `surfaces`, Hooks, Skills, Subagents, Slash Commands, MCP).
- `references/pi.md` - **Pi** (`badlogic/pi-mono`, `@earendil-works/pi-coding-agent`, legacy `@mariozechner/pi-coding-agent`).
- `references/oh-my-pi.md` - **Oh My Pi / OMP** (`can1357/oh-my-pi`, `@oh-my-pi/pi-coding-agent`).
- `references/opencode-1.md` - **OpenCode 1 (latest v1.x)** (`@opencode-ai/plugin`, `PluginInput`, `Hooks`, `.opencode/`).
- `references/opencode-2.md` - **OpenCode 2 (latest v2.x)** (`@opencode/plugin` `Plugin.define`, Server / TUI / `./gui-experimental`, `cli.json`).
- `references/deepseek-harness.md` - **DeepSeek Harness / DSH** (`deepseek-ai/deepseek-harness`, `@deepseek-ai/dsh`, `@deepseek-ai/cordis`, `cordis.patch.yml`).

## Conversion Workflow

1. **Inspect the source plugin.** Read its manifest (`package.json`, `cordis.patch.yml`, `opencode.json`, `.omp-plugin/`, etc.) and real implementation files. Identify its source harness and list every concrete capability it provides (tools, hooks, commands, prompt injections, subagents, providers, UI panels/widgets, storage).
2. **Load references.** Read `references/flecten-target.md` and the single matching source-harness guide via `skill({ name: "convert-plugin", resource: "..." })`.
3. **Run the native-overlap audit.** Compare each capability against Flecten's native features.
   - If the entire plugin is redundant or already better in Flecten: explain the exact Flecten equivalent (including Settings deep links or commands), note any subtle edge differences, and ask whether the user still wants a thin custom delta.
   - If only part of the plugin is genuinely new: drop the redundant pieces, explain why, and design only the valuable delta.
4. **Map to idiomatic Flecten targets.** Choose the right combination of:
   - **Skill** (`.flecten/skills/<name>/SKILL.md`) for reusable workflows, domain guidance, and reference playbooks.
   - **Slash Command** (`.flecten/commands/<name>.md`) for user-triggered prompt templates (`$ARGUMENTS`, `$1..$9`).
   - **Subagent** (`.flecten/agents/<name>.md` or `.json`) for specialized child roles with scoped tools/permissions/budgets.
   - **Hook** (`flecten.config.json` `hooks` or module `hooks`) for pre/post tool guards, formatters, or lifecycle automation.
   - **MCP Server** (`flecten.config.json` `mcp.servers` or MCP-only module) for external API/service connectors.
   - **Module** (`.agents/modules/<name>/` with `.flecten-module/module.json`) for bundled tools (`runtime.entry`), lazy guides (`resources`), scoped hooks, custom desktop HTML tabs or shell replacements (`surfaces` + `styles`), or deep runtime overrides (`platform.entry`).
5. **Implement and verify.** Write clean, schema-validated files with `AbortSignal` handling and cleanup hooks. Run available checks (syntax/typecheck/tests) on generated code.
6. **Report activation steps clearly.** Tell the user exact trust and enablement steps (for modules: **Settings > Modules > Installed > Trust this version**, plus **Use module interface** if it ships `placement`/`styles`; for hooks/MCP: reload/save config; for skills/commands: ready on next run or `/` menu) and list every intentional adaptation or omitted redundant feature.
