# Complete Configuration Schema, Profile Paths, Settings UI, and Environment Variables

## 1. Where Configuration Lives

- **Desktop App (Global Unified Profile):** Electron passes `FLECTEN_PROFILE` pointing to `userData`, consolidating ALL settings into one global `flecten.config.json` (repo-local `flecten.config.json` files are ignored unless `FLECTEN_CONFIG` is explicitly set):
  - **Linux:** `~/.config/Flecten/flecten.config.json` (or `$XDG_CONFIG_HOME/Flecten/flecten.config.json`)
  - **macOS:** `~/Library/Application Support/Flecten/flecten.config.json`
  - **Windows:** `%APPDATA%\Flecten\flecten.config.json`
  - *(Upgraded Liquid Harness installs keep their existing `liquid-harness` / `Liquid Harness` userData folder if no `Flecten` folder exists yet.)*
- **Explicit Override / Headless / Tests:** `FLECTEN_CONFIG=/path/to/flecten.config.json` (or legacy `LIQUID_CONFIG`).
- **Workspace Data (`.flecten/` inside each project root):**
  - `sessions/<id>/events.jsonl`, `queue.json`, `logs/`, `pages/`, `modules.json`, attachments
  - `memory.json` (project memory + local dictionary entries)
  - `twin.json` (Twin persona traits & processed message hashes)
  - `checkpoints/` (file pre/post snapshots) and `shadow/` (isolated shadow Git for shell `/undo`)
  - `dictionary/public.json` (cached synced public dictionary)
  - `modules/` (installed marketplace/folder modules)
  - `diagnostics/` and `exports/` and `trash/`
  - `sidecar.lock` (single sidecar per workspace)
- **Schema Version:** `schemaVersion: 3` (`.strict()` top-level validation - unknown top-level keys are rejected!).

## 2. Settings Navigation and Deep Links (`flecten://settings/<section>`)

Use these exact deep links inside HTML `<summary>` answers so users can click straight to the right tab:

| Deep Link | UI Section Label | What lives there |
|---|---|---|
| `flecten://settings/general` | General | Send shortcut, follow-up behavior, auto-resume, concurrent tasks, UI language (7 locales), interface scale (75-125%), voice input, translation |
| `flecten://settings/models` | Models | Primary model, Talker & Worker split + models, per-subagent models, Vision fallback model |
| `flecten://settings/providers` | Providers | Provider catalog, local auto-discovery, API keys, custom gateways, models, hourly auto-refresh, failover, Provider Protection |
| `flecten://settings/permissions` | Access | Access modes (`agent` / `confirm` / `full`), saved rules, per-action policies, destructive actions, approval timeout, OS sandbox, blocked read/write paths, env allowlist |
| `flecten://settings/tools` | Terminal and tools | Shell executable, scrollback, command/job timeouts, ANSI, exit notices, process/RAM/port limits, tool output byte/line caps, `bash` timeout, `read` line limit |
| `flecten://settings/history` | History and rollback | File/shell checkpoints (`shell`, `maxFiles`, `maxMegabytes`, `keep`, `maxAgeDays`), session retention (`retentionDays`, `maxSessions`, `trashDays`) |
| `flecten://settings/dictionary` | Memory and dictionary | Public 114-term dictionary sync & browser, local project vocabulary editor |
| `flecten://settings/mcp` | MCP | `stdio` and Streamable HTTP servers, OAuth sign-in, health/logs, `allowTools`, `readOnly`, timeouts, resources & prompts |
| `flecten://settings/hooks` | Hooks | All 11 lifecycle hooks, literal matchers, command/HTTP, `text`/`json`, `failClosed`, live draft dry-run test, 50-run history |
| `flecten://settings/skills` | Skills | Built-in skills toggle, user/project discovery folder toggles, loaded skills list, per-skill trust switches, bundled resource preview, diagnostics |
| `flecten://settings/modules` | Modules | Marketplace catalogs, Install from folder, Installed packages, SHA-256 revision trust, dev auto-reload, Use module interface |
| `flecten://settings/about` | About | Version, config/diagnostics paths, secret backend, Copy diagnostics report, Auto-update channel/source/actions, Opt-in telemetry |

Other valid `flecten://` links in HTML summaries:
- `flecten://models` - opens the composer model picker.
- `flecten://panel/thread`, `flecten://panel/changes`, `flecten://panel/history`, `flecten://panel/terminal`, `flecten://panel/worker`.
- `flecten://file?path=src/index.ts&amp;line=42` - opens a real project file in the built-in IDE at that line.

## 3. Complete `flecten.config.json` Reference (Non-Provider Sections)

Every section below lives at the top level of `flecten.config.json` (inspect with `read`, update with `edit`/`write` when writable or guide the user via Settings):

### General & UI (`ui`)
```json
{
  "ui": {
    "sendShortcut": "enter",
    "followUpBehavior": "queue"
  }
}
```
- `sendShortcut`: `"enter"` (Enter sends, Shift+Enter newline) or `"modifier-enter"` (Ctrl/Cmd+Enter sends, Enter newline).
- `followUpBehavior`: `"queue"` (wait until current run ends) or `"steer"` (inject at next safe turn boundary).

### Context & Output (`context`, `maxOutputTokens`)
```json
{
  "maxOutputTokens": 0,
  "context": {
    "window": 200000,
    "reserve": 16000,
    "promptBudget": 24000,
    "compactWarn": [70, 85, 95],
    "outputBudgetRatio": 0.1
  }
}
```
- `maxOutputTokens: 0` automatically derives output cap from the active model's metadata (`context.reserve` ensures headroom).
- `promptBudget`: token cap shared by base prompt, `AGENTS.md`, skills catalog, MCP summary, and active tool schemas (default `24000`; optional sections trim before required ones).
- `compactWarn`: three ascending percentages `[70, 85, 95]` for context meter warning thresholds.

### Agent Loop (`loop`)
```json
{
  "loop": {
    "maxTurns": 0,
    "continuations": 8,
    "parallelTools": true
  }
}
```
- `maxTurns: 0` means no artificial turn ceiling (recommended; set a positive integer only if explicitly requested).
- `continuations`: max automatic recovery continuations on `max_tokens`, empty turns, or mid-thought cutoffs (default `8`).
- `parallelTools`: run read-safe tools concurrently while serializing file mutations behind a mutex (default `true`).

### Tool Limits (`tools`)
```json
{
  "tools": {
    "maxOutputBytes": 50000,
    "maxOutputLines": 2000,
    "bashTimeoutMs": 120000,
    "readLimitLines": 2000,
    "retryAttempts": 1,
    "retryBackoffMs": 500,
    "outputBudgetRatio": 0.1
  }
}
```
- `retryAttempts`: `0..10` (transient structured failures only). `retryBackoffMs`: `0..60000`.

### Terminal & Background Jobs (`terminal`)
```json
{
  "terminal": {
    "shell": "/bin/bash",
    "scrollback": 1000,
    "commandTimeoutMs": 120000,
    "jobWaitMs": 30000,
    "jobTimeoutMs": 600000,
    "ansi": true,
    "notifyOnExit": true,
    "envAllowlist": ["PATH", "HOME"],
    "maxProcesses": 64,
    "maxMemoryMb": 4096,
    "ports": { "min": 3000, "max": 9999 }
  }
}
```
- `shell`, `jobTimeoutMs`, `envAllowlist`, and `ports` are optional (`ports: null` disables port restriction). `scrollback`: `1..100000`; `commandTimeoutMs`: `1..600000`; `jobWaitMs`: `1..1800000`; `maxProcesses`: `1..4096`; `maxMemoryMb`: `1..1048576`.

### Checkpoints & Rollback (`checkpoints`)
```json
{
  "checkpoints": {
    "shell": true,
    "maxFiles": 2000,
    "maxMegabytes": 128,
    "keep": 500,
    "maxAgeDays": 14
  }
}
```
- `shell`: enable/disable `.flecten/shadow` Git-independent snapshots around `bash`/`terminal` commands.

### Sessions & Concurrency (`sessions`)
```json
{
  "sessions": {
    "retentionDays": 30,
    "maxSessions": 100,
    "trashDays": 7,
    "maxConcurrent": 4,
    "autoResume": true
  }
}
```
- `maxConcurrent`: `1..16` parallel active chats (each with isolated queues, approvals, jobs, and budgets).
- `autoResume`: automatically resume unfinished runs after a sidecar crash once from durable `events.jsonl`.
- Retention never deletes active, interrupted, or queued sessions.

### Chat & Run Budgets (`budgets`)
```json
{
  "budgets": {
    "maxTokens": 1000000,
    "maxCostUsd": 5.0,
    "maxWallClockMs": 1800000
  }
}
```
- All three fields are optional (omit or remove a key from `flecten.config.json` to clear it). Token and USD limits accumulate across the whole chat (including Talker, Worker, Twin, Vision, and subagents); wall-clock applies per run.

### Transport & Catalog (`transport`, `catalog`)
```json
{
  "transport": { "timeoutMs": 120000, "idleTimeoutMs": 60000, "retries": 2 },
  "catalog": { "autoRefresh": true, "ttlMs": 43200000 }
}
```
- `transport.timeoutMs` and `idleTimeoutMs` cap at `600000` ms; `retries`: `0..10`.
- `catalog.ttlMs` defaults to 12 hours (`43200000` ms).

### Extra Directories (`commands`, `subagents`, `modes`)
```json
{
  "commands": { "dirs": [] },
  "subagents": { "dirs": [], "models": {} },
  "modes": { "dirs": [] }
}
```

## 4. Environment Variables (`FLECTEN_*`, backward-compatible with `LIQUID_*`)

| Variable | Effect |
|---|---|
| `FLECTEN_PROFILE` | Global desktop profile directory containing `flecten.config.json` and `projects.json` |
| `FLECTEN_CONFIG` | Explicit path to a `flecten.config.json` file (overrides `FLECTEN_PROFILE`) |
| `FLECTEN_CWD` | Startup working directory |
| `FLECTEN_PROJECTLESS` | `"1"` launches in isolated projectless mode (`projectRoot: null`) |
| `FLECTEN_PROVIDER` / `FLECTEN_MODEL` | Override active provider and/or model at launch |
| `FLECTEN_SECRET_BACKEND` | Force `"keychain"` or `"file"` secret storage |
| `FLECTEN_PROMPTS_DIR` | Override directory containing prompt templates and built-in skills |
| `FLECTEN_PROMPT_BUDGET_TOKENS` | Override default system prompt token budget |
| `FLECTEN_UPDATE_URL` | Custom HTTPS update feed URL (takes precedence over GitHub Releases) |
| `FLECTEN_VOICE_HOME` | Override local voice engine/model cache root |
| `FLECTEN_SCRATCH` | Set automatically inside agent shells/PTYs pointing to `.flecten-scratch/<sessionId>/` |
| `FLECTEN_MODULE_ROOT` | Set automatically inside module hooks pointing to active revision snapshot |
| `FLECTEN_HEADLESS` | `"1"` runs Electron window hidden/minimized (for E2E/automation) |
| `FLECTEN_DEV_URL` / `FLECTEN_DEVTOOLS` | Development Vite URL and detached DevTools |
| `FLECTEN_AGENT_BIN` | Override compiled sidecar binary path |
