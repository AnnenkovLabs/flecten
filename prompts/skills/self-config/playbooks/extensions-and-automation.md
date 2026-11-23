# Configuring Extensions and Automation (Skills, Commands, Subagents, MCP, Hooks, Modules)

## 1. Skills (`skills`, `flecten://settings/skills`)

```json
{
  "skills": {
    "builtin": true,
    "sources": [
      "user-claude",
      "user-agents",
      "user-flecten",
      "project-claude",
      "project-agents",
      "project-flecten"
    ],
    "trust": {
      "some-skill": "untrusted"
    }
  }
}
```

- **Built-in skills (`builtin: true` default):** `convert-plugin` and `self-config`. Always lowest precedence so user/project skills can override them if desired. Can be toggled globally via `skills.builtin` or individually via `skills.trust`.
- **Filesystem discovery precedence (lowest -> highest):**
  1. `builtin` (Flecten built-ins)
  2. `user-claude` (`~/.claude/skills`)
  3. `user-agents` (`~/.agents/skills`)
  4. `user-flecten` (`~/.flecten/skills`)
  5. `project-claude` (`.claude/skills`)
  6. `project-agents` (`.agents/skills`)
  7. `project-flecten` (`.flecten/skills`)
- **Format (`<skill-name>/SKILL.md`, max 256 KiB):** YAML frontmatter with required `name`, `description`, optional `version`, `argument-hint`, `compatibility`, `license`, `metadata`, `allowed-tools` (space/comma list narrowing session tools immediately on activation; never expands permissions).
- **Lazy loading:** Only name + short description enter the system prompt (catalog capped at 200 skills and 8,000 chars). Full `SKILL.md` loads on `skill({ name })` or `/skill-name` slash invocation; companion files load on demand via `skill({ name, resource })` or previewed in **Settings > Skills**.
- **Reloading:** Skills refresh automatically before each new run, when opening the `/` menu, or via **Reload skills** in Settings.

## 2. Custom Slash Commands (`commands`)

- **Discovery folders (later overrides earlier):** `~/.claude/commands`, `~/.flecten/commands`, `.claude/commands`, `.flecten/commands`, plus any extra project directories in `commands.dirs`.
- **Format (`<name>.md`, max 64 KiB, lowercase `a-z0-9-_`):**
  ```markdown
  ---
  description: Review staged git changes for regressions
  argument-hint: "[focus-area]"
  ---
  Inspect staged git diff with focus on $ARGUMENTS (primary topic: $1).
  ```
- Placeholders: `$ARGUMENTS` (all args), `$1..$9` (positional words). If no placeholder is present, user arguments append automatically. Read fresh on every invocation (no restart required).

## 3. Custom Subagents (`subagents`)

- **Built-in roles:** `explore` (read-only research, 16 turns / 140k tokens), `implement` (coding/commands, 40 turns / 420k tokens), `review` (read-only verification, 20 turns / 200k tokens).
- **Custom roles:** Place `<kebab-name>.md` or `<kebab-name>.json` in `~/.flecten/agents/`, `.flecten/agents/` (requires workspace trust), or `subagents.dirs`. Filename stem must match `name`.
  ```markdown
  ---
  name: sql-auditor
  description: Audit SQL migrations for locking and index regressions
  allowed-tools:
    - read
    - grep
    - glob
  permissions:
    - action: read
      policy: allow
    - action: write
      policy: deny
    - action: shell
      policy: deny
  budget:
    maxTurns: 12
    maxTokens: 100000
  ---
  You review SQL migration files and report locking hazards, missing indexes, and rollback risks.
  ```
- Override any subagent role's model under `subagents.models.<role-id>` or **Settings > Models**.

## 4. MCP Servers (`mcp.servers`, `flecten://settings/mcp`)

Up to 32 servers; server IDs must match `^[a-z0-9][a-z0-9_-]{0,31}$`. Saving hot-reloads connections with no app restart.

### Stdio Server
```json
{
  "mcp": {
    "servers": {
      "docs": {
        "command": "bun",
        "args": ["mcp/docs-server.ts"],
        "env": { "DOCS_ROOT": "./docs" },
        "protocol": "auto",
        "timeoutMs": 60000,
        "maxTools": 64,
        "readOnly": false,
        "allowTools": ["search_docs", "read_doc"]
      }
    }
  }
}
```

### Streamable HTTP Server (with optional OAuth PKCE)
```json
{
  "mcp": {
    "servers": {
      "linear": {
        "url": "https://mcp.example.com/mcp",
        "protocol": "auto",
        "timeoutMs": 60000,
        "maxTools": 64,
        "oauth": {
          "clientId": "optional-client-id",
          "scopes": ["read", "write"]
        }
      }
    }
  }
}
```
- **Lazy schema activation (`tool_catalog`):** External MCP tool schemas stay out of prompts until the model runs `tool_catalog({ operation: "list" })` and `tool_catalog({ operation: "activate", names: [...] })` (up to 128 tools per chat; persists across compaction and reopen).
- **Security:** `readOnlyHint` from upstream servers NEVER bypasses permissions. Setting `readOnly: true` blocks all server tools while keeping resources and prompts usable. Never put plaintext auth tokens into `headers` in `flecten.config.json`; configure OAuth or enter secret headers in **Settings > MCP**.
- **Resources & Prompts:** Attach MCP resources via `@` or `read_resource`; invoke MCP prompts via `/` or `use_prompt`. UI elicitation forms work over both `stdio` and HTTP.

## 5. Hooks (`hooks`, `flecten://settings/hooks`)

Up to 64 hooks per event; run sequentially in list order (first `deny` short-circuits).

- **11 events:**
  - *Interceptable (can block):* `sessionStart`, `userPromptSubmit`, `preToolUse`, `toolBatch`, `permission` (deny-only), `compact`, `subagent` (blocks only `phase === "start"`).
  - *Observer-only (supports `async: true`):* `postToolUse`, `notification`, `stop` (natural completion), `sessionEnd` (all run endings).
- **Exact literal matcher fields (combined with AND; NO regex, NO glob):** `tool`, `path`, `pathPrefix`, `command`, `commandPrefix`. Use separate hook entries for OR.
- **Command vs HTTP:**
  ```json
  {
    "hooks": {
      "preToolUse": [
        {
          "id": "guard-prod",
          "name": "Block writes to prod config",
          "type": "command",
          "responseFormat": "json",
          "command": "bun .hooks/guard-prod.ts",
          "matcher": { "tool": "write", "pathPrefix": "deploy/prod" },
          "timeoutMs": 10000,
          "enabled": true,
          "failClosed": true
        }
      ],
      "stop": [
        {
          "id": "notify-done",
          "name": "Webhook on completion",
          "type": "http",
          "url": "https://hooks.example.com/flecten",
          "responseFormat": "text",
          "async": true,
          "timeoutMs": 5000,
          "enabled": true
        }
      ]
    }
  }
  ```
- **Contract:** JSON payload arrives on `stdin` (or HTTP `POST` body, redirects disabled). Cap: 64 KiB each for input, stdout, stderr, HTTP body. `timeoutMs`: `100..60000` (default `10000`).
  - `responseFormat: "text"`: stdout is diagnostic text; exit code `2` blocks interceptable events.
  - `responseFormat: "json"`: stdout empty or `{ "decision": "allow"|"deny", "reason": "...", "additionalContext": "..." }` (unknown keys fail validation; write diagnostics to `stderr`).
  - `failClosed: true` blocks interceptable events on timeout, non-zero exit, oversized output, or invalid JSON.
- **Testing:** **Settings > Hooks** supports dry-running unsaved drafts against sample tool/path/command inputs and viewing the last 50 real executions per task.

## 6. Modules (`modules`, `flecten://settings/modules`)

```json
{
  "modules": {
    "enabled": true,
    "marketplaces": ["https://example.org/flecten-catalog.json"],
    "dirs": [],
    "roots": [".agents/modules"],
    "trusted": {},
    "development": [],
    "disabled": [],
    "interfaces": [],
    "maxActive": 16,
    "contextCharacters": 32000
  }
}
```
- **Built-in marketplace:** Intentionally empty. Add HTTPS catalog URLs (max 8) under **Marketplace > Catalog sources** or install local directories under **Installed > Install from folder**.
- **Trust lifecycle:** Installed modules start untrusted and disabled. Open **Settings > Modules > Installed**, review capabilities (including whether `platform.entry` or `surfaces` are declared), and click **Trust this version** (SHA-256 hash covers every file in the package; editing any byte invalidates trust unless **Reload local changes automatically** dev mode is enabled).
- **Module Interfaces:** Enable **Use module interface** to mount custom CSS `styles` and DOM `placement` surfaces project-wide. Press **`Ctrl+Shift+F12`** (or click **Restore native interface**) anytime for instant emergency rollback to Flecten's native UI without interrupting running tasks.
