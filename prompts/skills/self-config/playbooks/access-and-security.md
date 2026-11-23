# Access Modes, Permissions, OS Sandbox, Trust, and Security

Navigate users in UI via `flecten://settings/permissions` (**Settings > Access**).

## 1. Access Modes (`shared/access-mode.ts`)

Flecten synchronizes permission policies and OS sandboxing under three presets (diverging any baseline field reports `"custom"`):

| Mode | `read` | `write` | `shell` | `network` | `mcp` | `skill` | `externalPath` | `destructive` | `sandbox.enabled` | `sandbox.allowNetwork` |
|---|---|---|---|---|---|---|---|---|---|---|
| `agent` *(default)* | `allow` | `allow` | `allow` | `allow` | `allow` | `allow` | `ask` | `ask` | `true` (Linux/macOS), `false` (Windows) | `true` |
| `confirm` | `allow` | `ask` | `ask` | `allow` | `ask` | `allow` | `ask` | `ask` | `true` (Linux/macOS), `false` (Windows) | `true` |
| `full` | `allow` | `allow` | `allow` | `allow` | `allow` | `allow` | `allow` | `allow` | `false` | `true` |

Key invariants:
- Even in `full` mode, **explicit `deny` rules** and **mandatory human checkpoints** (`checkpoint: true` and Provider Protection actions) still apply and cannot be bypassed!
- Switching modes keeps saved custom `permissions.rules`, `readDenyPrefixes`, `writeDenyPrefixes`, `envAllowlist`, and `approvalTimeoutMs` intact.

## 2. Permissions Configuration (`permissions`)

```json
{
  "permissions": {
    "read": "allow",
    "write": "allow",
    "shell": "allow",
    "network": "allow",
    "mcp": "allow",
    "skill": "allow",
    "externalPath": "ask",
    "destructive": "ask",
    "approvalTimeoutMs": 300000,
    "rules": [
      {
        "action": "write",
        "tool": "edit",
        "pathPrefix": "src",
        "policy": "allow",
        "note": "Allow editing project source files"
      },
      {
        "action": "shell",
        "risk": "git-push-force",
        "policy": "deny",
        "note": "Never force push"
      },
      {
        "action": "write",
        "pathPrefix": "migrations",
        "policy": "ask",
        "checkpoint": true,
        "note": "Always require fresh human approval for DB migrations"
      }
    ]
  }
}
```

- **Policy values:** `"deny" | "ask" | "allow" | "auto"` (`auto` allows bounded safe calls, sends ambiguous unbounded calls to an independent reviewer model, and escalates uncertainty to the user).
- **Actions:** `"read" | "write" | "shell" | "network" | "mcp" | "skill" | "external_path"`.
- **Rule precedence:** Explicit `deny` always wins, then `humanOnly` / `checkpoint: true`, then highest specificity (`requestKey` > `pathPrefix` > `tool`), then longest `pathPrefix`, then strictest policy (`deny` > `ask` > `allow` > `auto`).
- **`approvalTimeoutMs`:** `10000..86400000` ms (default `300000` = 5 minutes). Expired prompts deny cleanly without hanging the session.
- **Destructive shell detection:** Driven by a real shell lexer (`src/security/shell-lexer.ts`, `destructive.ts`), not fragile regexes. Detects force pushes, recursive deletes outside workspace, raw disk writes, etc.

## 3. External Directory Access (`external_path`)

Accessing files outside the open workspace prompts on the canonical containing directory (or nearest existing ancestor for new files):
- **Allow once (`allow_once`):** Authorizes only that single prepared call.
- **Allow for this chat (`allow_session`):** Grants directory read/write scope in memory for the current chat (shared across Talker, Worker, and child subagents of that chat, never across other chats or forks) and updates both logical `SandboxPolicy` and OS sandbox `writablePaths`.
- **Always allow (`allow_always`):** Persists an `external_path` rule with `pathPrefix` into global `flecten.config.json`.
- Editing any permission rule invalidates active session grants immediately; pending approval cards re-evaluate live (`by: "policy"`).

## 4. OS Sandbox and Logical `SandboxPolicy` (`sandbox`)

```json
{
  "sandbox": {
    "enabled": true,
    "allowNetwork": true,
    "readDenyPrefixes": ["private/"],
    "writeDenyPrefixes": ["infra/prod/"],
    "envAllowlist": ["PATH", "HOME", "USER", "SHELL", "LANG", "TERM"]
  }
}
```

- **Linux:** `bubblewrap` (`bwrap`) when installed, plus `procfs` + `prlimit` and inherited process-scope markers tracking descendants even across `setsid`/reparenting.
- **macOS:** `Seatbelt` (`sandbox-exec`) when available, plus `ps` RSS and `lsof` port tracking.
- **Windows:** `sandbox.enabled` defaults to `false` until native Windows AppContainer + per-command Job Objects land (Bun ConPTY + `no-orphans` kill-on-close + CIM process snapshots + `taskkill /T` are active, and `PermissionEngine` + destructive checkpoints remain active).
- Missing host sandbox binaries (e.g., `bwrap` not installed on Linux) surface explicitly in app status.

### Always-Protected Default Prefixes (when `SandboxPolicy` is active)

- **Protected from raw writes (`DEFAULT_PROTECTED_WRITE_PREFIXES`):** `.git`, `.agents`, `.codex`, `.mcp.json`, `.flecten`, `.liquid`, `.flecten-migration`, `flecten.config.json`, `liquid.config.json`, `AGENTS.md`, `secrets.json`, `.env`, `.env.local`, `.env.development`, `.env.production`, `.env.test`, `~/.ssh`, `~/.aws`.
- **Protected from raw reads (`DEFAULT_PROTECTED_READ_PREFIXES`):** `.flecten-migration`, `.flecten/secrets.json`, `.liquid/secrets.json`, `secrets.json`, `.env`, `.env.local`, `.env.development`, `.env.production`, `.env.test`, `~/.ssh`, `~/.aws`.
- Native capabilities bypass only their own dedicated verified channels: `memory` writes `.flecten/memory.json` via `checkMemory`, while raw file tools (`write`/`edit`) respect `DEFAULT_PROTECTED_WRITE_PREFIXES` whenever `sandbox.enabled` is `true` (so edit `flecten.config.json` only when sandbox is disabled / `full` mode, or instruct the user to apply changes in Settings UI / IDE).

## 5. Workspace Trust and Projectless Mode

- **Workspace Trust:** Stored per canonical folder path in profile `projects.json` (`unknown`, `trusted`, `untrusted`), editable anytime from the sidebar folder menu.
  - `untrusted` keeps built-in tools active (under permissions & sandbox) while disabling repo-local executable extensions: project MCP servers, project command/HTTP hooks, project subagents, and executable project modules.
  - Built-in skills (`convert-plugin`, `self-config`) come from Flecten itself and remain safe.
- **Projectless Mode (`FLECTEN_PROJECTLESS=1`, `projectRoot: null`):** Fresh installs start without forcing a fake folder. Runs in an isolated profile directory, skips project `AGENTS.md`, project skills, project commands, and shadow Git, and requires external-path confirmation for workspace access.

## 6. Untrusted Data, Redaction, Subagents, and SSH

- **Untrusted data wrapping:** Outputs from `read`, `grep`, `bash`, `web_fetch`, `web_search`, and MCP arrive inside fenced `Untrusted data` Markdown blocks tagged with provenance (`Source`, `Source reference`, `Trust`).
- **Streaming redaction:** Scrubs configured secrets plus AWS, Google, GitHub, Bearer, JWT, and PEM patterns across chunk boundaries before live UI events, replay buffers, `events.jsonl`, tool logs, pages, crash reports, and diagnostics bundles.
- **Child subagents:** Effective permissions are the intersection of child rules, parent permissions, and active parent skill `allowed-tools`. Calls resolving to `ask` or `humanOnly` fail closed immediately (no hidden approval prompts from background children).
- **Remote SSH jobs:** Preflight live `SSH_AUTH_SOCK` and verified per-host `known_hosts` entries without mounting `~/.ssh` or exposing private keys, and disable remote agent forwarding.
