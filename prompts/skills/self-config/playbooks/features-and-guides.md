# Flecten Features, Daily Workflows, Slash Commands, and Troubleshooting

## 1. Talker and Worker (Default Dual-Role Mode)

- **How it works:** Talker stays responsive (`< 1 s`) in your language, compiles requests into tight English briefs, answers questions mid-run, and renders final interactive HTML `<summary>` reports. Worker runs file edits, searches, subagents, and commands in parallel in its own context window.
- **Live steering:** Send a new message while Worker runs to steer Talker or Worker at the next safe turn boundary without restarting or breaking prompt cache.
- **Two-stage Stop:** First click on **Stop** requests graceful stop (finishes in-flight stream/command, cancels queued calls). Clicking red **Force stop** aborts immediately via `AbortSignal`. **Stop Worker** halts only Worker while keeping Talker open.
- **Worker Actions tab & Live Tool Cards:** Every Worker tool call streams live into the thread and the dedicated **Worker Actions** tab (split-pane on viewports >= 1000 CSS px after sidebar).
- **Switching to Single-Agent Mode:** Toggle **Separate conversation from execution** off in **Settings > Models** (`conversation.enabled: false`; applies to new chats).

## 2. Twin (3D Digital Taste Clone)

- **Purpose:** Objective project facts belong in Memory; **Twin** captures your subjective taste, tone, dealbreakers, and code-quality instincts.
- **Training from 10 AI tools:** Open the **Twin** view from the header to import local history/memories from **Claude Code**, **Codex**, **Cursor**, **Oh My Pi (`omp` + `mnemopi.db`)**, **Kilo**, **DeepSeek (`~/.dsh`)**, **OpenCode (v1/v2 SQLite)**, **Hermes**, **Command Code**, and **Flecten** itself. Automatically filters out subagents, sidechains, and internal service prompts. Stores up to 200 quote-backed traits and 50,000 processed message hashes in `.flecten/twin.json` (never fine-tunes weights).
- **Live operation:**
  - Silently observes user reactions/frustrations during chats (`twin.observe`) and learns editable traits.
  - Watches Worker progress in the background with read-only tools (`read`, `grep`, `glob`) and can barge straight into chat mid-run or on final review (`revise`) in your own first-person voice (inside a 3D furry bubble).
  - Answers subjective Worker `ask` questions first; real security approvals always stay in `PermissionEngine`.
  - Can also be taught directly from IDE code diffs (`twin.teach`) with zero model calls.
  - Toggle off/on per project in the header anytime (disabling cancels active training while keeping saved traits).

## 3. Quote-Verified Project Memory (`memory`)

- Stored per workspace in `.flecten/memory.json` (v2, up to 500 active entries, shared across all chats of the same project; no hidden global bank).
- Built-in kinds: `preference`, `lesson`, `decision`, `commitment`, `context`, `procedure` (plus custom lowercase kinds).
- **Zero hallucination rule:** `preference` and `lesson` require exact verbatim user quotes verified by SHA-256 against real user turns. Secrets are rejected before commit. Updates use compare-and-swap (`expectedRevision`) to supersede stale rules cleanly.
- Auto-delivers a compact topic catalog and bounded delta (up to 1,200 estimated tokens) before each request without mutating the system prompt prefix.

## 4. Term Dictionary (`Settings > Memory and dictionary`, `flecten://settings/dictionary`)

- **Public dictionary:** 114 bundled engineering/slang terms (EN/RU/UK) synced from `AnnenkovLabs/flecten` (`src/dictionary/data/`, auto-syncs at most once every 24 h; works offline from compiled seeds).
- **Local dictionary:** Project-specific acronyms/jargon stored in `.flecten/memory.json` (`kind: "vocabulary"`) with highest precedence; never uploaded.
- **Zero-latency matching (0 ms, zero extra model calls):** Handles mixed spacing/hyphens, single-edit typos on 8-64 char terms, and automatic wrong-keyboard-layout recovery across English, Russian, and Ukrainian (e.g., `ghbdtn`, `vibecoding` typed in RU layout). Injects bounded definitions beside the turn while preserving verbatim user text.

## 5. Voice Input (`Settings > General > Voice Input`, `flecten://settings/general`)

Click the mic button in the composer (up to 90 s; click again to stop and insert into draft without auto-sending; `Escape` cancels immediately). Three modes:
1. **Provider API (`engine: "api"`):** Posts multipart audio to `/audio/transcriptions` on `voice.provider` (e.g. OpenAI `whisper-1` or Groq Whisper).
2. **Local `faster-whisper` (`engine: "faster-whisper"`):** Offline multilingual dictation (`tiny`, `base`, `small`, `medium`, `large-v3-turbo`, `large-v3`) on CPU (`int8`) or NVIDIA CUDA (`float16`, requires CUDA 12 + cuBLAS + cuDNN 9). Zero network calls during dictation.
3. **Local `Vosk` (`engine: "vosk"`):** Lightweight offline single-language CPU models (`vosk-model-small-ru-0.22`, `vosk-model-small-en-us-0.15`, `vosk-model-small-uk-v3-nano`).
- Setup requires Python `3.9+` with `venv` and `pip`. Click **Install engine and model**, then **Check installation**, then **Save**.
- Cache paths: Linux `~/.cache/flecten/voice` (`$XDG_CACHE_HOME/flecten/voice`), macOS `~/Library/Caches/flecten/voice`, Windows `%LOCALAPPDATA%\flecten\voice` (override via `FLECTEN_VOICE_HOME`).

## 6. Interactive HTML Summaries, Dialogue Branching, Built-In IDE, and Rollback

- **Interactive HTML Summaries:** Final task replies render in an offline `sandbox="allow-scripts"` iframe with sortable/filterable tables, tabs, diagrams, copy buttons, clickable `flecten://` links into IDE/Settings, and verified human-gesture callbacks (`window.flectenSummary`).
- **Dialogue Branching:** Click edit on any previous user message to fork an alternate continuation in the same chat and switch versions with `< 1 / 2 >`. Unsent bottom-composer drafts stay isolated and restore on cancel.
- **Built-In IDE:** Click **IDE** in the header (or any `flecten://file?...` chip) for file explorer, workspace search/replace, Source Control, **Agent Changes** inline split diffs, CodeMirror tabs, line comments, integrated terminal, and docked chat.
- **File + Shell Rollback:** Every file tool mutation records pre/post checkpoints, and `bash`/`terminal` commands snapshot into `.flecten/shadow` (Git-independent; initial index capped at 5 s / 50,000 files / 256 MiB). Use `/undo`, `/redo`, and `/checkpoints` to rewind both file edits and command side effects without touching `.git`.
- **Attachments & `@` Mentions:** Paste or attach up to 5 files (10 MB each: PNG, JPEG, WebP, GIF, AVIF, PDF; plus WAV/MP3 audio on OpenAI Chat and supported audio on Gemini). Type `@` to attach files, editor selections/symbols, task items, public GitHub PRs, or MCP resources.
- **Scratch Directory (`FLECTEN_SCRATCH`):** Session-scoped scratch folder `.flecten-scratch/<sessionId>/` shared across `bash`, `jobs`, and `terminal` (excluded from `glob`, `grep`, and checkpoints).

## 7. Built-In Composer Slash Commands

| Command | Purpose |
|---|---|
| `/continue [clarification]` | Resume an interrupted or paused task from where it stopped |
| `/undo` | Undo the last action and restore files (including shell snapshots) |
| `/redo` | Reapply changes reverted by `/undo` |
| `/checkpoints [number]` | View change history with files and sizes |
| `/compact [topic]` | Manually compact conversation context to a page boundary |
| `/clear` | Clear the conversation and start fresh |
| `/model [model]` | Open model picker or switch provider/model for the chat |
| `/permissions` | Jump straight to Access / Permissions settings |
| `/terminal` | Open the project terminal |
| `/new` | Start a new task in the current project |
| `/search [query]` | Find text inside the current conversation (empty clears highlight) |
| `/export [file]` | Export the conversation bundle |

## 8. Key Keyboard Shortcuts

- `Ctrl/Cmd+S` (in Settings): Save settings changes.
- `Escape`: Cancel voice recording, dismiss tooltips/menus/modals.
- `Ctrl+Shift+F12`: Emergency **Restore native interface** (detaches all module CSS and UI placements immediately).
- Twin 3D character: drag to rotate, click/`Enter`/`Space` to greet, arrow keys to rotate/look, `Home` to reset framing.
- Interface scale: 75-125% zoom under **Settings > General** (`flecten://settings/general`).

## 9. Common Troubleshooting Playbook

| Symptom | Likely cause & exact fix |
|---|---|
| `"project_locked"` error when opening folder | Another Flecten window holds `.flecten/sidecar.lock`. Focus/close the other window; stale locks from dead PIDs reclaim automatically. |
| Provider returns auth error after editing `baseUrl` or `proxy` | Credentials are destination-bound to `{ protocol, baseUrl, proxy }`. Re-enter the API key in **Settings > Providers** (`flecten://settings/providers`) or configure `apiKeyEnv`. |
| Gateway cannot list models automatically | Corporate/relay gateway blocks `/models`. Add models manually in **Settings > Providers** or under `providers.<id>.models` in `flecten.config.json`. |
| "OS sandbox unavailable" warning on Linux | Install `bubblewrap` (`sudo apt install bubblewrap` / `pacman -S bubblewrap`), or switch Access mode if running in an unprivileged container without user namespaces. |
| Project hooks / MCP / modules do not run | Check workspace trust in the sidebar folder menu (`trusted` required for repo-local executable extensions). For modules, also click **Trust this version** under **Settings > Modules > Installed**. |
| `write`/`edit` denied on `flecten.config.json` or `.env` | Intentional `SandboxPolicy` protection while sandbox is enabled. Apply settings in **Settings** (`flecten://settings/general`), edit the file in the built-in IDE, or switch to `full` access mode before editing on disk (restart Flecten after disk edits to `flecten.config.json`). |
| Local voice CUDA fails to load | Ensure CUDA 12, cuBLAS, and cuDNN 9 libraries are visible to the configured Python binary, or switch `voice.local.device` to `"cpu"`. |
| Custom module UI broke the window layout | Press `Ctrl+Shift+F12` to restore the native interface immediately, then disable or fix the module in **Settings > Modules**. |
| Need to report a crash or bug | Open **Settings > About** (`flecten://settings/about`) -> **Diagnostics** -> **Copy report** and open an issue at `https://github.com/AnnenkovLabs/flecten/issues`. |
