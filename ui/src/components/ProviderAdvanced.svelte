<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { settings } from "../lib/settings.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    providerId: string;
  }

  let { providerId }: Props = $props();

  const provider = $derived(settings.settings?.providers[providerId]);

  const outputWarning = $derived.by(() => {
    if (!provider) return "";
    const limit = provider.maxOutputTokens;
    const smallest = Object.values(provider.models)
      .map((model) => model.context)
      .filter((value): value is number => typeof value === "number" && value > 0)
      .sort((left, right) => left - right)[0];
    if (limit && smallest && limit >= smallest) {
      return t("The response limit of {0} is at least as large as the smallest model context ({1}). Saving may fail.", [limit, smallest]);
    }
    const bad = Object.entries(provider.models)
      .filter(([, model]) => model.context && model.output && model.output >= model.context)
      .map(([id]) => id);
    if (bad.length > 0) {
      return t("For models {0}, the response limit is at least as large as the context.", [bad.slice(0, 3).join(", ")]);
    }
    return "";
  });

  let headersText = $state("{}");
  let bodyText = $state("{}");
  let headersError = $state("");
  let bodyError = $state("");
  let useCommandAuth = $state(false);
  let authArgsText = $state("[]");
  let authArgsError = $state("");
  let loaded = "";

  $effect(() => {
    if (!provider) return;
    if (loaded === providerId) return;
    loaded = providerId;
    headersText = JSON.stringify(provider.headers ?? {}, null, 2);
    bodyText = JSON.stringify(provider.extraBody ?? {}, null, 2);
    useCommandAuth = Boolean(provider.auth?.command);
    authArgsText = JSON.stringify(provider.auth?.args ?? [], null, 2);
    headersError = "";
    bodyError = "";
    authArgsError = "";
  });

  function applyHeaders(): void {
    if (!provider) return;
    try {
      const value = JSON.parse(headersText) as unknown;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(t("A JSON object is required"));
      }
      const headers: Record<string, string> = {};
      for (const [key, entry] of Object.entries(value)) {
        if (typeof entry !== "string") throw new Error(t("{0}: a string value is required", [key]));
        headers[key] = entry;
      }
      provider.headers = headers;
      headersError = "";
    } catch (error) {
      headersError = error instanceof Error ? error.message : t("Invalid JSON");
    }
  }

  function applyBody(): void {
    if (!provider) return;
    try {
      const value = JSON.parse(bodyText) as unknown;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(t("A JSON object is required"));
      }
      if (Object.keys(value).length > 0) provider.extraBody = value as Record<string, unknown>;
      else delete provider.extraBody;
      bodyError = "";
    } catch (error) {
      bodyError = error instanceof Error ? error.message : t("Invalid JSON");
    }
  }

  function toggleCommandAuth(enabled: boolean): void {
    if (!provider) return;
    useCommandAuth = enabled;
    if (enabled) {
      provider.auth = {
        command: provider.auth?.command ?? "",
        args: provider.auth?.args ?? [],
        timeoutMs: provider.auth?.timeoutMs ?? 5000,
        refreshIntervalMs: provider.auth?.refreshIntervalMs ?? 300000,
      };
    } else {
      delete provider.auth;
    }
  }

  function applyAuthArgs(): void {
    if (!provider?.auth) return;
    try {
      const value = JSON.parse(authArgsText) as unknown;
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        throw new Error(t("Expected an array of strings"));
      }
      provider.auth.args = value as string[];
      authArgsError = "";
    } catch (error) {
      authArgsError = error instanceof Error ? error.message : t("Invalid JSON");
    }
  }
</script>

{#if provider}
  <details class="st-details advanced">
    <summary>
      <span class="summary-copy">
        <span class="st-title">{t("Advanced protocol settings")}</span>
        <span class="st-sub">{t("Reasoning, requests, and raw JSON.")}</span>
      </span>
      <Icon class="st-chevron" name="chevron-down" size={16} />
    </summary>

    <div class="st-details-body">
      {#if outputWarning}
        <div class="st-status st-status--warn" role="status">
          <span>{outputWarning}</span>
        </div>
      {/if}
      <div class="st-block">
        <div>
          <h3 class="st-block-title">{t("Reasoning")}</h3>
          <p class="st-hint">{t("How to send and store reasoning between turns.")}</p>
        </div>
        <div class="st-grid">
          <label class="st-field">
            <span class="st-label">{t("Resend reasoning")}</span>
            <select class="st-select" bind:value={provider.reasoningReplay}>
              <option value="auto">{t("Auto")}</option>
              <option value="always">reasoning_content</option>
              <option value="alias">reasoning</option>
              <option value="never">{t("Do not send")}</option>
            </select>
          </label>
          <label class="st-field">
            <span class="st-label">{t("Reasoning details")}</span>
            <select class="st-select" bind:value={provider.reasoningDetails}>
              <option value="auto">{t("Auto")}</option>
              <option value="always">{t("Always")}</option>
              <option value="never">{t("Never")}</option>
            </select>
          </label>
          <label class="st-field">
            <span class="st-label">{t("Reasoning mode")}</span>
            <select class="st-select" bind:value={provider.thinking}>
              <option value="auto">{t("Auto")}</option>
              <option value="enabled">{t("On")}</option>
              <option value="disabled">{t("Off")}</option>
            </select>
          </label>
          <label class="st-field">
            <span class="st-label">{t("thinking parameter")}</span>
            <select class="st-select" bind:value={provider.thinkingParam}>
              <option value="auto">{t("Auto")}</option>
              <option value="thinking">thinking</option>
              <option value="enable_thinking">enable_thinking</option>
              <option value="none">{t("None")}</option>
            </select>
          </label>
          <label class="st-field">
            <span class="st-label">{t("Store reasoning")}</span>
            <select class="st-select" bind:value={provider.thinkingKeep}>
              <option value="auto">{t("Auto")}</option>
              <option value="all">{t("Full history")}</option>
              <option value="none">{t("Do not store")}</option>
            </select>
          </label>
          <label class="st-field">
            <span class="st-label">{t("Clear reasoning (GLM)")}</span>
            <select class="st-select" bind:value={provider.clearThinking}>
              <option value="auto">{t("Auto")}</option>
              <option value="keep">{t("Keep")}</option>
              <option value="clear">{t("Clear")}</option>
            </select>
          </label>
          <label class="st-field">
            <span class="st-label">{t("Preserve reasoning (Qwen)")}</span>
            <select class="st-select" bind:value={provider.preserveThinking}>
              <option value="auto">{t("Auto")}</option>
              <option value="on">{t("On")}</option>
              <option value="off">{t("Off")}</option>
            </select>
          </label>
        </div>
      </div>

      <div class="st-block">
        <div>
          <h3 class="st-block-title">{t("Request mode")}</h3>
          <p class="st-hint">{t("What to send with the response and how to call tools.")}</p>
        </div>
        <label class="st-field">
          <span class="st-label">{t("Parallel tool calls")}</span>
          <select
            class="st-select"
            value={provider.parallelToolCalls === undefined
              ? "auto"
              : provider.parallelToolCalls
                ? "on"
                : "off"}
            onchange={(event) => {
              const value = event.currentTarget.value;
              if (value === "auto") delete provider.parallelToolCalls;
              else provider.parallelToolCalls = value === "on";
            }}
          >
            <option value="auto">{t("Auto")}</option>
            <option value="on">{t("On")}</option>
            <option value="off">{t("Off")}</option>
          </select>
        </label>
        <label class="st-switch">
          <span class="st-switch-copy">
            <strong>{t("Cache prompt")}</strong>
            <span>{t("The provider reuses the shared request prefix.")}</span>
          </span>
          <input type="checkbox" bind:checked={provider.promptCaching} />
          <span class="st-switch-track" aria-hidden="true"></span>
        </label>
        <label class="st-switch">
          <span class="st-switch-copy">
            <strong>{t("Token usage in stream")}</strong>
            <span>{t("Include token usage with the response.")}</span>
          </span>
          <input type="checkbox" bind:checked={provider.streamUsage} />
          <span class="st-switch-track" aria-hidden="true"></span>
        </label>
        <label class="st-switch">
          <span class="st-switch-copy">
            <strong>{t("Strict tool schemas")}</strong>
            <span>{t("Require tool calls to match the schema exactly.")}</span>
          </span>
          <input type="checkbox" bind:checked={provider.strictTools} />
          <span class="st-switch-track" aria-hidden="true"></span>
        </label>
      </div>

      <div class="st-block">
        <div>
          <h3 class="st-block-title">{t("API key from command")}</h3>
          <p class="st-hint"> {t("The app runs a command and reads the API key from its output. Useful for short-lived tokens.")} </p>
        </div>
        <label class="st-switch">
          <span class="st-switch-copy">
            <strong>{t("Get API key from command")}</strong>
            <span>{t("Instead of the key in the Access field.")}</span>
          </span>
          <input
            type="checkbox"
            checked={useCommandAuth}
            onchange={(event) => toggleCommandAuth(event.currentTarget.checked)}
          />
          <span class="st-switch-track" aria-hidden="true"></span>
        </label>
        {#if useCommandAuth && provider.auth}
          <div class="st-grid">
            <label class="st-field span-2">
              <span class="st-label">{t("Command")}</span>
              <input
                class="st-input"
                bind:value={provider.auth.command}
                placeholder="/usr/local/bin/get-token"
                spellcheck="false"
              />
            </label>
            <label class="st-field">
              <span class="st-label">{t("Arguments (JSON array)")}</span>
              <input
                class="st-input"
                bind:value={authArgsText}
                onblur={applyAuthArgs}
                placeholder='["--audience","flecten"]'
                spellcheck="false"
                aria-invalid={authArgsError ? "true" : undefined}
              />
              {#if authArgsError}<span class="st-error">{authArgsError}</span>{/if}
            </label>
            <label class="st-field">
              <span class="st-label">{t("Timeout, ms")}</span>
              <input class="st-input" type="number" min="1" bind:value={provider.auth.timeoutMs} />
            </label>
            <label class="st-field">
              <span class="st-label">{t("Key refresh interval, ms")}</span>
              <input
                class="st-input"
                type="number"
                min="1"
                bind:value={provider.auth.refreshIntervalMs}
              />
            </label>
          </div>
        {/if}
      </div>

      <div class="st-block">
        <div>
          <h3 class="st-block-title">{t("Raw overrides")}</h3>
          <p class="st-hint"> {t("Added to every request. For custom servers.")} </p>
        </div>
        <div class="st-grid">
          <label class="st-field">
            <span class="st-label">{t("Headers (JSON)")}</span>
            <textarea class="st-textarea" bind:value={headersText} onblur={applyHeaders} spellcheck="false" rows="3" aria-invalid={headersError ? "true" : undefined}></textarea>
            {#if headersError}<span class="st-error">{headersError}</span>{/if}
          </label>
          <label class="st-field">
            <span class="st-label">{t("Request body (JSON)")}</span>
            <textarea class="st-textarea" bind:value={bodyText} onblur={applyBody} spellcheck="false" rows="3" aria-invalid={bodyError ? "true" : undefined}></textarea>
            {#if bodyError}<span class="st-error">{bodyError}</span>{/if}
          </label>
        </div>
      </div>
    </div>
  </details>
{/if}

<style>
  .advanced {
    margin-top: 2px;
  }

  .summary-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .span-2 {
    grid-column: 1 / -1;
  }

  @media (max-width: 900px) {
    .st-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .span-2 {
      grid-column: auto;
    }
  }
</style>
