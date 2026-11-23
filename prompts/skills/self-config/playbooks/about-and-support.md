# Flecten: About, Creator, Architecture, Support, Diagnostics, and Updates

## 1. Identity, Creator, and Licensing

- **Name:** Flecten (formerly **Liquid Harness**).
- **Creator / Organization:** **AnnenkovLabs** (`https://github.com/AnnenkovLabs/flecten`), maintained by Flecten contributors.
- **License:** **AGPL-3.0-only** (`LICENSE` in repo root and `licenses/LICENSE` in packaged installers). Users have full legal freedom to use, study, modify, and share Flecten (including commercially) under AGPL-3.0 terms.
- **Community Ethics & Conduct:** Governed by `ETHICS.md` and `CODE_OF_CONDUCT.md` (free software, respect, good faith, do no harm, honesty).
- **Supported Platforms:** Windows (`.exe` NSIS installer), Linux (`.AppImage` / `.deb`), macOS (`.dmg` / `.zip`, Apple Silicon & Intel).
- **UI Languages (7 locales):** English (`en`, default), Simplified Chinese (`zh-Hans`), Brazilian Portuguese (`pt-BR`), Spanish (`es`), Japanese (`ja`), Ukrainian (`uk`), Russian (`ru`). Switching UI locale persists in the window profile (`flecten.locale`) without changing agent prompt or model reply language.
- **Design Standard:** Deep graphite chrome, warm light text, iris (`#b7a1e8`) active focus accent, `Manrope` brand font + system monospace stack, WCAG 2.2 AA contrast, full `prefers-reduced-motion` support.

## 2. Upgrading from Liquid Harness

Existing Liquid Harness installations migrate safely without data loss:
- Legacy `liquid.config.json`, `LIQUID_*` environment variables, `liquid-harness://` deep links, and legacy `userData` profile folders (`liquid-harness` / `Liquid Harness`) continue to work.
- When opening a project with pre-existing `.liquid/` data, `StorageBootstrap` runs a mandatory blocking migration screen before acquiring locks or replaying sessions, keeping untouched originals under `.flecten-migration/v1/` (hidden from models, IDE, search, and checkpoints).
- Legacy `skills.sources` values `"user-liquid"` and `"project-liquid"` auto-map to `"user-flecten"` and `"project-flecten"`.
- Retired `plugins` and `lsp` top-level keys from older configs are silently dropped on load (leaving files on disk untouched) and omitted on next save.

## 3. High-Level Architecture

- **Three strict layers:**
  1. **Electron 45 Shell (`shell/`):** OS windowing, single-instance profile lock, allowlisted `preload.cjs` IPC bridge, `flecten://app` + opaque-origin `flecten-summary://` protocols, Ed25519 updater, and sidecar process supervision (auto-restarts on crash with 1, 2, 4, 8, 15 s backoff). Zero harness logic.
  2. **Svelte 5 + Vite Renderer (`ui/`):** Pure UI projection from canonical backend snapshots and events. Zero direct filesystem access, zero direct LLM network calls, zero `core` imports.
  3. **Bun 1.4 Core Sidecar (`dist/flecten-agent` / `src/app/server.ts`):** Standalone process communicating strictly via newline-delimited JSON over `stdin`/`stdout` (zero open listening ports, except transient `127.0.0.1` callbacks during explicit user-initiated MCP OAuth login). Acquires `.flecten/sidecar.lock` (single sidecar per workspace).
- **Core Goal:** Higher engineering quality at lower token cost through context discipline, byte-stable KV-cache prefixes, quote-verified memory, AST+BM25 search, Talker/Worker separation, Twin taste alignment, and deterministic runtime gates.

## 4. How to Report a Bug

Guide users to file clear, actionable bug reports:
1. **Where to report:** `https://github.com/AnnenkovLabs/flecten/issues`
2. **Collect a redacted diagnostics bundle first:**
   - In the app: **Settings > About** (`flecten://settings/about`) -> expand **Diagnostics** -> click **Copy report** (also saves a local bundle under `.flecten/diagnostics/` and displays the exact path).
   - Or via CLI (from a source checkout): `bun scripts/diagnostics.mjs --out <path> --format directory` (or `--format tar`).
   - **Review before sharing:** Automated redaction strips API keys, headers, tokens, and collapses `$HOME` to `~`, and includes only config shape (keys and value types, never values), app version, commit, OS platform, sanitized provider metadata, and recent redacted errors. Still review for sensitive local filenames/paths before posting publicly.
3. **What to include in the GitHub Issue:**
   - Flecten version (shown in **Settings > About**) and OS/architecture.
   - Provider + wire protocol + model ID (if model/streaming-related).
   - Clear reproduction steps, expected vs actual behavior, and whether it happens in Talker+Worker mode or single-session mode.
   - Relevant excerpts from the diagnostics report or screenshots (remembering never to paste raw API keys or `.env` contents).

## 5. How to Report a Security Vulnerability

- **NEVER open a public GitHub issue for security vulnerabilities!**
- Report privately via a **GitHub Security Advisory** on `https://github.com/AnnenkovLabs/flecten/security/advisories/new` or contact the repository owner privately.
- Include Flecten version, exact reproduction steps, and potential impact.
- Supported branch: `main`. Expected maintainer response: within **7 days**, with coordinated fix and disclosure.
- High-priority security areas: `flecten://` path traversal, `preload.cjs` IPC bridge, Electron `contextIsolation`/`sandbox`/`nodeIntegration`, CSP in summary/module iframes, secret redaction in logs/`events.jsonl`, `bash` sandbox escape, MCP/hook execution & env allowlists, and `SKILL.md`/MCP prompt injection.

## 6. Privacy and Opt-In Telemetry

- **Local-first by default:** Session logs (`.flecten/sessions/<id>/events.jsonl`), tool logs, attachments (mode `0600`), checkpoints, pages, memory, Twin persona, and diagnostics stay strictly on the user's machine.
- **Telemetry is OFF by default (`telemetry.enabled: false`).**
  - Even when explicitly enabled with an HTTPS `telemetry.endpoint` (or loopback HTTP for local testing; redirects blocked) and triggered via **Send metrics** in **Settings > About**, it sends ONLY `schemaVersion`, app version, OS platform, and event counters - never prompts, messages, file paths, code, keys, or tool outputs.
- **External network connections occur only on explicit actions/configured features:** configured LLM providers, MCP servers, `web_fetch`/`web_search`, public GitHub PR `@` context, model catalog sync (`models.dev` / `agent-one`), public term dictionary sync (`AnnenkovLabs/flecten`), signed update feed checks, and voice model downloads during explicit local engine installation.

## 7. Signed Auto-Updates (`update`)

Configured under **Settings > About** (`flecten://settings/about`) or `update` in `flecten.config.json`:
- `channel`: `"beta"` (default) or `"stable"`.
- `autoCheck`: `true` (checks 10 s after launch and every 4 h, with 15 min to 4 h error backoff).
- `autoDownload`: `true` (downloads in background).
- `installOnQuit`: `true` (installs on quit, or click **Install and restart**).
- `github`: optional `{ owner, repo }` override (default in packaged builds: `AnnenkovLabs/flecten`).
- `feedUrl`: optional custom HTTPS generic update server (overrides `github`; can also be set via `FLECTEN_UPDATE_URL`).
- **Verification:** Packaged builds verify pinned **Ed25519** channel manifest signatures before verifying installer **SHA-512** digest and exact byte size. Unsigned or tampered updates are always blocked. Dev runs without an explicit update source disable update checks.

## 8. Building or Contributing from Source

Requires **Bun >= 1.4.4** and **Node >= 22.12.0** (for Electron):
```bash
git clone https://github.com/AnnenkovLabs/flecten.git
cd flecten
bun install
bun run app:dev
```
Verification before PR (`CONTRIBUTING.md`): `bun test`, `bun run check`, `bun run lint`, `bun run docs:check`, `bun run build:ui`, `bun run build:agent` (or `bun run verify`).
