# Hooks

Hooks run a local shell command or an HTTP `POST` request on specific agent lifecycle events. A hook can inject context, report diagnostics, or block a pending operation before execution. External hook code always runs in the sidecar, never in the renderer.

## Configuration

Open **Settings > Hooks** (Automatic Actions), create an entry, and configure:

1. **Name**: human-readable label shown in lists and test results.
2. **Event**: lifecycle stage (prompt submission, tool call, run completion, etc.).
3. **Command or HTTP URL**: local shell command or `http`/`https` endpoint.
4. **Match conditions**: optional literal filters by tool name, path, or shell command.
5. **Advanced options**: failure policy (`failClosed`), timeout, and response format (`text` or `json`).

New form-created hooks default to `responseFormat: "text"`, so commands like `bun test` or a formatter work out of the box. Choose `responseFormat: "json"` explicitly when returning `allow`/`deny` decisions or `additionalContext`; output format is never inferred from stdout contents.

Hooks registered on the same event run sequentially in list order, skipping disabled entries. The first `deny` short-circuits the chain for that event; a later `allow` cannot override an earlier `deny`.

Testing a draft executes the current unsaved form state with a sample event payload (tool name, path, and command specified separately). When match conditions fail, the runner reports a non-match without spawning the command or sending an HTTP request.

Manual hook tests execute the real command or HTTP endpoint even if the hook is currently disabled, always run synchronously, do not roll back filesystem or network side effects, and enforce project trust.

**Recent runs** displays the latest 50 real hook executions in the active task (newest first) with name, event, outcome, duration, output preview, and provenance (`project` or module name). History reconstructs from durable `hook.finished` events on session reopen and excludes manual editor tests.

## Events

Event keys in the first column are stable config identifiers:

| Event | Trigger point | Can block |
|---|---|---|
| `sessionStart` | Before starting a run | Run startup |
| `userPromptSubmit` | Before delivering the user prompt to the model | Prompt delivery |
| `preToolUse` | After schema validation, before tool execution | Tool call |
| `postToolUse` | After tool execution completes or errors | No |
| `toolBatch` | Before executing a batch of tool calls | Entire batch |
| `permission` | After policy evaluation, before final authorization | Tool call |
| `compact` | After summary generation, before replacing history | History replacement |
| `subagent` | Before launching and after finishing `task` | Launch when `subagent.phase === "start"` |
| `notification` | When delivering a runtime notice (e.g., background job) | No |
| `stop` | After natural model turn completion | No |
| `sessionEnd` | At the end of a run, including error or cancellation | No |

Run-level semantics: `sessionStart` and `sessionEnd` fire on every run, including follow-up prompts in an existing chat. `stop` fires only when the model finishes naturally; forced user cancellation and run failures trigger `sessionEnd` instead. Blocking `compact` preserves uncompacted history but cannot refund tokens already spent generating the candidate summary.

## Match Conditions

All condition fields use exact literal matching:

- `tool`: canonical tool name; `*` or omitted matches any tool.
- `path`: exact path; relative paths resolve against the project root.
- `pathPrefix`: directory prefix on path boundaries (`src` matches `src/a.ts` but not `src-other/a.ts`).
- `command`: exact full shell command string.
- `commandPrefix`: exact command or prefix bounded by space or tab (`git status` matches `git status --short` but not `git statuses`).

Populated fields combine with logical AND; regular expressions and shell globs are not used. On `toolBatch`, all populated fields must match a single call within the batch rather than mixing `tool` from one call with `path` from another.

Tool, path, and command filters apply only to events carrying those fields; `tool: "write"` never matches an event without tool metadata. Create separate hook entries to express OR combinations.

Path matching inspects structured argument fields (`path`, `file_path`, `filePath`, `paths`, `source`, `destination`, `target`) plus `read`/`write`/`external_path` permission targets. Command matching inspects `command`, `cmd`, and `shell` permission targets without scanning arbitrary JSON substrings.

## Execution Policy

`failClosed` (**Block on failure**) covers timeouts, aborts, transport errors, non-zero exit codes, oversized responses, and invalid JSON. It affects only interceptable events; when `failClosed` is `false`, the failure is logged and execution proceeds.

Explicit `decision: "deny"` or exit code `2` always blocks an interceptable event regardless of `failClosed`, while observer events cannot undo an already completed action. Returning `allow` never escalates privileges or bypasses permissions or OS sandboxing.

Background (`async`) execution is available only on observer events: the agent continues immediately, and any `additionalContext` from an async hook is discarded. Use synchronous hooks whenever the model must read injected context.

Per-hook `timeoutMs` ranges from `100` to `60000` ms (default `10000` ms). Input payloads and each output stream (`stdout`, `stderr`, HTTP body) are capped at 64 KiB; exceeding 64 KiB fails the hook rather than parsing truncated JSON. Bounded previews are logged after secret redaction.

Command hooks run in the project root through shared platform shell helpers (`/bin/bash` on Unix, `cmd.exe` on Windows). Environment variables come solely from the platform allowlist plus explicit hook `env` entries; provider API keys are never inherited automatically. HTTP hooks send `POST` over `http`/`https` and do not follow redirects.

## Authoring Protocol

`responseFormat: "text"` treats `stdout` (or the HTTP response body) as diagnostic output without parsing decisions or context; exit code `2` still blocks, and other failures follow `failClosed`.

`responseFormat: "json"` enables the structured response contract below. Omitting `responseFormat` in `flecten.config.json` keeps `"json"` for backward compatibility, whereas new UI form entries write `"text"` explicitly.

Command hooks receive a single JSON object on `stdin`; HTTP hooks receive the same object as the `POST` body:

```json
{
  "event": "preToolUse",
  "sessionId": "s_example",
  "cwd": "/workspace/project",
  "toolName": "write",
  "toolArgs": { "path": ".secrets/config.json", "content": "..." }
}
```

Event-specific fields include `prompt`, `toolOk`, `toolOutput`, `toolError`, `stopReason`, `permission`, `compact`, `notification`, `subagent`, and `toolBatch`. Raw user prompts remain verbatim in session logs; hooks cannot rewrite recorded user messages.

In `json` mode, the response is a JSON object with optional fields:

```json
{
  "decision": "deny",
  "reason": "Edit this file manually and retry.",
  "additionalContext": "Extra context for the current turn."
}
```

`decision` accepts `"allow"` or `"deny"`. Empty `stdout` or `{}` means no decision and no added context. Unknown keys fail schema validation. In `json` mode, write diagnostics to `stderr` and keep `stdout` either empty or containing a single JSON object; HTTP hooks must return a `2xx` status with that JSON body.

| Command outcome | Meaning |
|---|---|
| Exit `0` in `text` mode | Success; `stdout` is recorded as diagnostic text |
| Exit `0` with empty `stdout` or valid JSON in `json` mode | Success; valid `decision` and `additionalContext` apply |
| Exit `2` | Explicit deny; explanation comes from `reason` or `stderr` |
| Any other non-zero exit code | Hook error; `failClosed` determines whether to block |
| Timeout, abort, output > 64 KiB, or invalid JSON | Hook error; partial responses are never applied |

Transport success alone does not imply authorization: hook results separately record `ok`, `blocked`, `decision`, `error`, `timedOut`, `aborted`, `exitCode`, `outputTruncated`, duration, optional `id`/`name`, and pre-filter `index` (project hooks followed by active module hooks, counting disabled and unmatched entries).

The runtime stamps each result with `source: { type: "project" }` or `{ type: "module", name, revision }` from the loaded module snapshot; `source` is read-only provenance rather than a configurable field.

## Guard Hook Example

Configure a `preToolUse` hook matching `tool: "write"` and `pathPrefix: ".secrets"`, enable `failClosed`, select `responseFormat: "json"`, and set command `bun .hooks/protect-secrets.ts`:

```ts
await Bun.stdin.text();
process.stdout.write(JSON.stringify({
  decision: "deny",
  reason: "Files under .secrets must be edited manually. Choose a different path.",
}));
```

Testing `write` against `.secrets/config.json` blocks the call, whereas `src/config.ts` skips spawning the script. Guarding filesystem mutations comprehensively requires matching rules for `edit`, `apply_patch`, `bash`, and other write paths; a single `write` rule is not a full filesystem sandbox.

## Advanced Config and Modules

Advanced configuration in `flecten.config.json` stores arrays keyed by event name:

```json
{
  "hooks": {
    "preToolUse": [{
      "id": "protect-secrets",
      "name": "Protect .secrets",
      "type": "command",
      "responseFormat": "json",
      "command": "bun .hooks/protect-secrets.ts",
      "matcher": { "tool": "write", "pathPrefix": ".secrets" },
      "timeoutMs": 10000,
      "enabled": true,
      "failClosed": true
    }]
  }
}
```

Legacy string `matcher` values remain supported as exact tool-name filters, while the form editor writes structured matcher objects. Up to 64 hooks are allowed per event.

Trusted modules register session-scoped hooks through their module manifest and lifecycle, whereas replacing the agent driver, model stream, tool executor, or compactor uses module platform services (`MODULES.md`). Arbitrary user JavaScript never runs inside the renderer outside sandboxed iframes. Canonical schemas live in `shared/hooks.ts`, the execution engine in `src/core/hooks/`, and manual dry-run testing in `src/app/hook-test.ts`.
