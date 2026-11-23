---
name: self-config
description: Inspect and configure Flecten itself (providers, models, settings, permissions, sandbox, MCP, hooks, skills, modules, Twin, voice, vision, translation, memory, dictionary), answer questions about Flecten (creator, architecture, license, guides), and help users report bugs or collect diagnostics.
version: 1.0.0
argument-hint: "[topic-or-setting]"
---

# Flecten Self-Configuration and Product Guide

Use this skill when the user wants to configure Flecten, troubleshoot its settings/providers/permissions/extensions, learn how any Flecten feature works, or ask about the product itself (creator, license, updates, diagnostics, bug reporting).

## Quick Base

- **Product:** Flecten (formerly Liquid Harness), an open-source AGPL-3.0 desktop workspace for coding agents built on Electron 45 + Svelte 5 + Bun 1.4 sidecar.
- **Creator and repository:** AnnenkovLabs - `https://github.com/AnnenkovLabs/flecten` (Releases: `/releases`, Bug reports: `/issues`, Security advisories: private GitHub Security Advisory).
- **Inspecting and editing configuration with built-in tools:**
  - Locate the active `flecten.config.json`: in the desktop app it lives in the global profile directory (`FLECTEN_PROFILE`: Linux `~/.config/Flecten/flecten.config.json`, macOS `~/Library/Application Support/Flecten/flecten.config.json`, Windows `%APPDATA%\Flecten\flecten.config.json`, or legacy `liquid-harness` / `Liquid Harness` on upgraded installs); `FLECTEN_CONFIG` overrides the path; headless/project runs fall back to `./flecten.config.json`.
  - Read current settings with `read` (if outside the workspace, Flecten prompts once for external folder access) and inspect local extensions with `glob`/`read` (`.flecten/`, `.agents/`, `AGENTS.md`).
  - Apply valid `schemaVersion: 3` updates with `edit` or `write` when writable (e.g. `full` access mode or unlocked paths), keeping valid JSON and never introducing unknown top-level keys (`.strict()` schema). After editing `flecten.config.json` on disk, remind the user to restart Flecten (or reload via Settings) so the sidecar picks up disk changes; skills, commands, subagents, `AGENTS.md`, and dev-mode modules reload without restart.
- **Strict safety rules:**
  1. **Always `read` the active `flecten.config.json` before editing or suggesting changes** so you merge against real current values and never clobber existing rules, providers, hooks, or MCP servers.
  2. **Never write plaintext API keys, bearer tokens, or auth headers** into `flecten.config.json` or repo files. Use `apiKeyEnv` (environment variable name) or `auth.command`, or direct the user to `flecten://settings/providers` / `flecten://settings/mcp` so keys store securely in the destination-bound OS keychain.
  3. **Respect `SandboxPolicy`:** When sandbox is active (`agent` / `confirm` modes), `flecten.config.json`, `.flecten/`, `.agents/`, `AGENTS.md`, `.mcp.json`, `secrets.json`, and `.env*` are write-protected. If `edit`/`write` is denied by sandbox, never attempt to bypass it - provide the exact validated JSON snippet / instructions and a clickable `flecten://settings/<section>` link (or let the user apply it in Settings / IDE / `full` mode).
  4. In final HTML summaries, include clickable `flecten://settings/<section>` links (`general`, `models`, `providers`, `permissions`, `tools`, `history`, `dictionary`, `mcp`, `hooks`, `skills`, `modules`, `about`) so the user can jump directly to the relevant settings page.

## Detailed Playbooks (Load On Demand)

Read only the playbook(s) needed for the user's request via `skill({ name: "self-config", resource: "<path>" })`:

- `playbooks/about-and-support.md` - Product identity, creator (AnnenkovLabs), Liquid Harness migration, AGPL-3.0 license, ethics, architecture overview, bug reporting, private security reporting, diagnostics bundles, privacy/telemetry, and signed auto-updates.
- `playbooks/providers-and-models.md` - All 4 wire protocols, all 11 built-in providers, custom/local gateways (Ollama, LM Studio, vLLM, proxies), credential binding, `ModelConfig` / `compat` / `variants` / auto-refresh, Provider Protection, failover & circuit breaker, and Role Models (Primary, Talker, Worker, Subagents, Vision, Translation).
- `playbooks/config-and-settings.md` - Complete `flecten.config.json` v3 schema, OS profile paths, all `FLECTEN_*` / `LIQUID_*` env vars, all Settings sections & `flecten://` deep links, UI/general, context/loop/tools/terminal, checkpoints/history/sessions, budgets, transport, and catalog.
- `playbooks/access-and-security.md` - Access modes (`agent`, `confirm`, `full`, `custom`), permissions & rules, external directory leases, OS sandbox (`bubblewrap`, `Seatbelt`, Windows boundary), protected paths, workspace trust, projectless mode, untrusted data, redaction, and SSH scoping.
- `playbooks/extensions-and-automation.md` - Skills, custom slash commands, custom subagents, MCP (`stdio`, HTTP, OAuth PKCE, elicitation, `tool_catalog`), Hooks (all 11 events, exact literal matchers, `text`/`json`, `failClosed`, dry-run), and Modules (Marketplace, SHA-256 trust, dev reload, HTML surfaces, `Ctrl+Shift+F12`).
- `playbooks/features-and-guides.md` - Step-by-step guides for Talker+Worker, Twin (3D clone & 10-tool training), Quote-verified Memory, Term Dictionary, Voice Input (API, `faster-whisper`, `Vosk`), Interactive HTML Summaries, Dialogue Branching, Built-in IDE, File & Shell Rollback (`/undo`/`/redo`), Scratch dir & Remote SSH, built-in slash commands, and troubleshooting.
