# Privacy and Observability

This document specifies what Flecten stores locally, how to delete or export it, and what data leaves the machine.

## Local Storage

- `.flecten/sessions/<id>/events.jsonl`: session event log, including raw user messages stored verbatim.
- `.flecten/sessions/<id>/logs/`: full redacted tool outputs.
- Session attachments: copies of submitted images, PDFs, audio, and text attachments stored with mode `0600`. Events store metadata references rather than inline base64 so sessions can reopen or fork even if the original source file is deleted.
- `.flecten/sessions/<id>/pages/N.md`: context compaction pages (`Changed`, `Where`, `Rules`, `Next`, `Risks`).
- `.flecten/checkpoints/`: pre-image and post-image file snapshots.
- `.flecten/diagnostics/`: bounded operational log, counters, recent errors, crash reports, and user-generated diagnostics bundles.
- `.flecten/sessions/exports/` and `.flecten/exports/`: explicit user-initiated session exports.
- Backend secret store: provider API keys and MCP OAuth tokens stored in the OS keychain or a mode-`0600` fallback file; the renderer receives only `isSet` and source metadata.

All project paths live under the workspace root, and the core never uploads these files automatically.

## Deletion and Export

Deleting a session from the UI (`sessions.delete` with `confirm: true`) moves its directory to `.flecten/trash/` so accidental deletions can be recovered manually until expired. **Settings > History** configures `retentionDays`, `maxSessions`, and `trashDays`: retention archives old completed sessions without touching active, interrupted, or queued tasks, while trash purges entries past `trashDays`.

**Export history** (`sessions.export`) writes a private mode-`0700` export bundle under `.flecten/exports/` containing redacted `events.jsonl` plus copied session attachments, published atomically with symlinks rejected. Exported bundles survive deletion of the source session, are never transmitted over the network, and remain on disk until deleted manually.

## Redaction

Core redaction rules live in `src/util/redact.ts`, with structured diagnostics wrappers in `src/observability/redact.ts`:

- Strings are scrubbed for known API key prefixes, `Bearer` tokens, `api_key=`, `api-key:`, AWS/Google/GitHub credentials, JWTs, and PEM blocks.
- Object keys matching `apiKey`, `authorization`, `cookie`, `headers`, `password`, `token`, `secret`, and their variants are replaced wholesale with `"[redacted]"`.
- Streaming redaction runs before shared event listeners, live UI updates, and replay buffers, and again before writing `logs/`, `pages/N.md`, crash reports, and diagnostics bundles. Separate stream buffers for `stdout`, `stderr`, assistant text, and reasoning hold partial chunks across boundaries so split secrets cannot leak, and configured secret values are scrubbed regardless of token format.
- Object traversal depth is bounded and circular references are tagged safely.

## Crash Reports

`buildCrashReport` captures error name, message, code, stack trace, `traceId`, `sessionId`, app version, and recent log lines after running stack traces and messages through redaction. Provider keys and auth headers are never included.

## Diagnostics Bundle

`buildDiagnosticsBundle` collects:

- app version, Git commit, and OS platform;
- workspace, config, session, log, and diagnostics paths with `$HOME` collapsed to `~`;
- sanitized provider metadata (name, protocol, host, and env-var name, omitting `apiKey`, `headers`, and request bodies);
- recent redacted errors;
- config structure (field keys and value types only, without values).

Generate a bundle via **Settings > About** (which reveals the local output path and copies a summary) or via CLI: `bun scripts/diagnostics.mjs --out <path> --format directory|tar`. Operational counters and trace IDs stay in a bounded local log excluding prompts and tool outputs. Review the bundle for sensitive filenames or paths before sharing; generating a bundle transmits nothing on its own.

## Privacy Boundaries

- **Voice input**: microphone capture starts only on explicit button press, buffers audio in memory without writing audio files or logs, and places transcribed text in the composer draft until sent. Pressing `Escape` or **Cancel** releases the microphone and aborts any active request or local Python process. Recordings cap at 90 seconds:
  - **Provider API mode**: sends up to 2 MiB of audio to `/audio/transcriptions` on the configured `voice.provider` (defaulting to the active provider) using its credentials and network settings.
  - **Local `faster-whisper` / `Vosk` mode**: converts audio in memory to 16 kHz mono PCM16 WAV (max 2,900,044 bytes) and pipes it via `stdin` to a local Python process with Hugging Face offline mode forced, telemetry disabled, and zero cloud fallback.
  - **Engine & model setup**: clicking **Install engine and model** downloads packages and weights from PyPI, Hugging Face (Whisper), or `alphacephei.com` (Vosk), exposing standard HTTP download metadata (IP address, package/model name) without ever sending user audio. Cache locations and cleanup are documented in [VOICE.md](VOICE.md).
- Automated redaction is defense-in-depth and does not replace human review before sharing a diagnostics bundle.
- File checkpoints follow their own lifecycle independent of session deletion.
- **Telemetry**: disabled by default (`telemetry.enabled: false`). Even after explicit opt-in and configuring an `https://` endpoint (loopback `http://` allowed for local testing; redirects blocked), **Send counters** transmits only `schemaVersion`, app version, OS platform, and event counters, excluding prompts, file paths, credentials, diagnostics bundles, and tool outputs. Disabling telemetry preserves local diagnostics.
- Explicit user/agent actions connect to configured LLM providers, MCP servers, `web_fetch`/`web_search` targets, the public GitHub PR API, the model catalog, the release update feed, and voice model hosts; OAuth flows open the browser only after explicit user consent and store tokens in the backend secret store.
