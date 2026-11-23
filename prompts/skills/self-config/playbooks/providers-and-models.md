# Providers, Models, Failover, Protection, and Role Routing

Navigate users in UI via `flecten://settings/providers` (Providers) and `flecten://settings/models` (Models) or `flecten://models` (composer model picker).

## 1. Supported Wire Protocols (`protocol`)

Flecten attaches any compatible provider with zero code changes across 4 native wire protocols:
1. `"openai-responses"` - OpenAI Responses API (default for `openai`).
2. `"openai-chat"` - OpenAI Chat Completions API (compatible with OpenRouter, DeepSeek, Moonshot, Z.AI, Alibaba DashScope, Groq, Cerebras, Ollama, LM Studio, vLLM, LocalAI, corporate proxies).
3. `"anthropic-messages"` - Anthropic Messages API (native prompt caching, thinking blocks, Claude endpoints/proxies).
4. `"gemini"` - Google Gemini REST API (`v1beta`, native audio/PDF/image/thinking).

## 2. All 11 Built-In Providers (`src/config/defaults.ts`)

| Provider ID | Display Name | Protocol | Default `baseUrl` | Default `apiKeyEnv` | Special defaults |
|---|---|---|---|---|---|
| `openai` | OpenAI | `openai-responses` | `https://api.openai.com/v1` | `OPENAI_API_KEY` | - |
| `anthropic` | Anthropic | `anthropic-messages` | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` | - |
| `google` | Google | `gemini` | `https://generativelanguage.googleapis.com/v1beta` | `GEMINI_API_KEY` | - |
| `openrouter` | OpenRouter | `openai-chat` | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` | `reasoningReplay: "always"`, `reasoningDetails: "always"` |
| `deepseek` | DeepSeek | `openai-chat` | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` | `reasoningReplay: "always"`, `thinkingParam: "thinking"` |
| `moonshotai` | Moonshot AI | `openai-chat` | `https://api.moonshot.ai/v1` | `MOONSHOT_API_KEY` | `reasoningReplay: "always"`, `thinkingParam: "thinking"`, `thinkingKeep: "all"` |
| `zai` | Z.AI | `openai-chat` | `https://api.z.ai/api/paas/v4` | `ZHIPU_API_KEY` | `reasoningReplay: "always"`, `thinkingParam: "thinking"`, `clearThinking: "keep"` |
| `alibaba` | Alibaba | `openai-chat` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `DASHSCOPE_API_KEY` | `thinkingParam: "enable_thinking"`, `preserveThinking: "on"` |
| `groq` | Groq | `openai-chat` | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` | `reasoningReplay: "alias"` |
| `cerebras` | Cerebras | `openai-chat` | `https://api.cerebras.ai/v1` | `CEREBRAS_API_KEY` | `reasoningReplay: "alias"` |
| `ollama` | Ollama | `openai-chat` | `http://127.0.0.1:11434/v1` | *(none required)* | Auto-detects local Ollama/LM Studio/vLLM/LocalAI |

## 3. Credentials and Destination Binding

Precedence order:
1. Environment variable named in `apiKeyEnv` (e.g., `OPENROUTER_API_KEY`).
2. Destination-bound secret in OS keychain (`secret-tool` on Linux, `security` on macOS) or mode-`0600` `.flecten/secrets.json` fallback (Windows or headless without keychain; override with `FLECTEN_SECRET_BACKEND=file|keychain`).
3. Dynamic credential helper in `auth`:
   ```json
   "auth": {
     "command": "my-token-helper",
     "args": ["--scope", "llm"],
     "timeoutMs": 5000,
     "refreshIntervalMs": 300000
   }
   ```

**Destination binding:** Stored keys bind to `{ protocol, baseUrl, proxy }` and canonical profile path. Changing a provider's `baseUrl` or `proxy` never leaks an existing stored key to the new host; legacy unbound keys prompt for re-entry.

**Self-config rule:** NEVER write plaintext `apiKey` into `flecten.config.json`. Configure `apiKeyEnv` or `auth.command`, or guide the user to paste the key safely in **Settings > Providers** (`flecten://settings/providers`).

## 4. Complete `ProviderConfig` Schema

```json
{
  "providers": {
    "my-gateway": {
      "name": "My Gateway",
      "protocol": "openai-chat",
      "baseUrl": "https://gateway.example.com/v1",
      "apiKeyEnv": "MY_GATEWAY_KEY",
      "proxy": "http://127.0.0.1:8080",
      "headers": { "X-Team": "eng" },
      "transportTimeoutMs": 120000,
      "transport": { "timeoutMs": 120000, "idleTimeoutMs": 60000, "retries": 2 },
      "failoverModels": ["backup-model-id"],
      "modelAutoRefresh": { "enabled": true, "overwriteManual": false },
      "reasoningReplay": "auto",
      "reasoningDetails": "auto",
      "thinking": "auto",
      "thinkingParam": "auto",
      "thinkingKeep": "auto",
      "clearThinking": "auto",
      "preserveThinking": "auto",
      "promptCaching": true,
      "streamUsage": true,
      "strictTools": false,
      "parallelToolCalls": true,
      "promptCacheKey": "optional-stable-key",
      "maxOutputTokens": 16384,
      "extraBody": {},
      "models": {
        "my-model": {
          "name": "My Model",
          "apiId": "upstream/model-id",
          "context": 200000,
          "output": 16384,
          "tools": true,
          "reasoning": true,
          "reasoningMode": "effort",
          "reasoningLevels": ["low", "medium", "high"],
          "vision": true,
          "pdf": false,
          "audio": false,
          "promptCache": true,
          "parallelToolCalls": true,
          "interleavedReasoning": false,
          "maxTokensParameter": "auto",
          "cost": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 },
          "modalities": { "input": ["text", "image"], "output": ["text"] },
          "variants": {
            "fast": { "name": "Fast", "reasoning": "low", "temperature": 0.2 }
          },
          "compat": {
            "reasoningReplay": "auto",
            "thinkingParam": "auto",
            "promptCaching": true,
            "strictTools": false
          }
        }
      }
    }
  }
}
```

Key enum values:
- `reasoning`: `"none" | "minimal" | "low" | "medium" | "high" | "xhigh"` (check active model's supported `reasoningLevels`).
- `reasoningMode`: `"effort" | "budget" | "toggle" | "none"`.
- `reasoningReplay`: `"auto" | "always" | "never" | "alias"`.
- `thinkingParam`: `"auto" | "thinking" | "enable_thinking" | "none"`.
- `maxTokensParameter`: `"auto" | "max_tokens" | "max_completion_tokens"`.
- `model.output` and `model.input` must not exceed `model.context` (validated by Zod).
- Duplicate `id` or `apiId` (case-insensitive) within one provider fails validation.
- **Restricted corporate gateways:** If `/models` discovery is blocked, users can add models manually in **Settings > Providers** or add entries under `providers.<id>.models` in `flecten.config.json`.
- **Hourly Model Metadata Refresh:** `modelAutoRefresh.enabled: true` syncs API + catalog capabilities hourly while open. `overwriteManual: false` (default) preserves user-edited fields using `modelMetadataBaseline`, never deletes active models, and never runs test completions.

## 5. Provider Protection (`providers.<id>.protection`)

Protects sensitive context when using third-party / relay / proxy gateways (e.g., New API / One API gateways detected automatically when adding a provider):
- Scans outgoing system prompt, messages, tool schemas, and final JSON body, replacing detected secrets/keys/PEMs/JWTs/passwords/dotenv values with reversible session-local HMAC tags `[[secret_<64hex>]]` (the provider still receives its own auth header to authenticate).
- Resolves known tags back into native file edits/reads locally; rejects shell-metacharacter secret restoration in shell args.
- Enforces **mandatory human-only approval** for writes, shell, network, MCP, skills, modules, and subagents triggered by a protected provider (cannot be bypassed by `full` mode or saved grants).
- Validates strict declared-tool responses and withholds/scans streaming tool arguments and buffered outputs.
- Toggle per provider in **Settings > Providers > [Provider] > Advanced** or via `providers.<id>.protection: { enabled: true }`.

## 6. Failover and Circuit Breaker (`failover`)

Two levels of failover:
1. **Within-provider fallback:** `providers.<id>.failoverModels` or `providers.<id>.models.<model>.failoverModels` (up to 16 model IDs).
2. **Cross-provider failover (`failover`):**
   ```json
   {
     "failover": {
       "enabled": true,
       "providers": [
         { "provider": "anthropic", "model": "claude-sonnet-4-5" },
         { "provider": "openrouter", "model": "anthropic/claude-sonnet-4.5" }
       ],
       "retryBudget": 2,
       "cooldownMs": 30000,
       "failureThreshold": 3
     }
   }
   ```
   - Validation rule: if `failover.enabled: true`, `failover.providers` must have at least 1 entry.
   - Quarantines failing endpoints after `failureThreshold` failures for `cooldownMs` ms, routes seamlessly to backups, and shows an explicit failover badge in the UI.

## 7. Role Models (`Settings > Models`, `flecten://settings/models`)

- **Primary model:** top-level `provider`, `model`, optional `reasoning`, optional `variant`. Used for single-agent chats and as inheritance fallback.
- **Talker & Worker (`conversation`):**
  ```json
  {
    "conversation": {
      "enabled": true,
      "talker": { "provider": "anthropic", "model": "claude-haiku-4-5" },
      "worker": { "provider": "anthropic", "model": "claude-sonnet-4-5", "reasoning": "high" }
    }
  }
  ```
  - Toggling `conversation.enabled` applies to newly created chats (existing chats keep their original architecture).
  - Unset `worker` inherits primary model; unset `talker` inherits `worker`.
  - When reasoning is unset, Talker and Vision default to no reasoning (saving latency/cost) rather than inheriting Worker's thinking budget.
  - Per-chat model changes in the composer picker persist per session (`model.selected`) without overwriting global defaults.
- **Subagent models (`subagents.models`):** map role ID (`explore`, `implement`, `review`, or custom agent ID) to `{ provider, model, reasoning?, variant? }`. Resolution order: `subagents.models[id]` -> agent file `model`/`provider` -> caller model.
- **Vision fallback (`vision`):** `{ provider, model, reasoning?, variant? }`. Runs ONLY when the active working model lacks native image input (`modalities.input` does not include `"image"` / `vision !== true`). Empty `provider` follows working provider; empty `model` picks lowest `cost.input + cost.output` vision model with known pricing (requires explicit choice if pricing is unknown). Selected model must declare image input and not be disabled.
- **Agent Language (`translation`):** `{ enabled, provider, model, language: "auto" | "<BCP-47>", timeoutMs }`. When `conversation.enabled: false`, `translation.model` must support tool calling (`tools !== false`). In Talker+Worker mode, Talker speaks the user's language natively while briefing Worker in English, eliminating separate translation calls.
