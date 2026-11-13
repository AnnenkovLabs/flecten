<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { requestAgent } from "../lib/desktop";
  import { settings } from "../lib/settings.svelte";
  import { PROTOCOLS } from "../lib/settings-utils";
  import Icon from "./Icon.svelte";
  import ProviderHeaders from "./ProviderHeaders.svelte";
  import ProviderTest from "./ProviderTest.svelte";

  interface Props {
    providerId: string;
  }

  let { providerId }: Props = $props();

  const provider = $derived(settings.settings?.providers[providerId]);
  const keyState = $derived(settings.keyState(providerId));
  const clearing = $derived(settings.clearApiKeys.includes(providerId));
  const modelCount = $derived(Object.keys(provider?.models ?? {}).length);
  const envName = $derived(provider?.apiKeyEnv?.trim() ?? "");
  const hasDraftKey = $derived(Boolean(provider?.apiKey));
  const savedSource = $derived(settings.info?.providers.find((entry) => entry.id === providerId)?.keySource);
  const storage = $derived(
    settings.info?.secretBackend === "keychain"
      ? t("system credential store")
      : t("secrets.json file"),
  );

  let confirmClear = $state(false);
  let reauthorizing = $state(false);
  let confirmFor = "";

  const urlError = $derived.by(() => {
    const raw = provider?.baseUrl.trim() ?? "";
    if (!raw) return t("Enter an API address.");
    try {
      const url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return t("Only http and https are supported.");
      }
      return "";
    } catch {
      return t("Full URL, for example https://api.example.com/v1.");
    }
  });

  const envError = $derived.by(() => {
    if (!envName) return "";
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)
      ? ""
      : t("Variable name: Latin letters, numbers, and underscores.");
  });

  const timeoutError = $derived.by(() => {
    const value = provider?.transportTimeoutMs;
    if (value === undefined) return "";
    return value >= 1000 && value <= 600_000 ? "" : t("Between 1000 and 600000 ms.");
  });

  const keySource = $derived.by(() => {
    if (!provider) return t("No key set.");
    if (savedSource === "env" && envName) return t("Source: variable {0}. It takes priority over the saved key.", [envName]);
    if (provider.auth?.command) return t("Source: authentication command.");
    if (hasDraftKey) return t("New key. It will be saved in {0}.", [storage]);
    if (clearing) return t("The key will be deleted when you save.");
    if (keyState === "set") {
      return envName
        ? t("Source: {0}. Variable {1} is not currently set.", [storage, envName])
        : t("Key set: {0}.", [storage]);
    }
    if (envName) return t("Waiting for variable {0}.", [envName]);
    return t("No key set.");
  });

  $effect(() => {
    if (!provider || confirmFor === providerId) return;
    confirmFor = providerId;
    confirmClear = false;
  });

  function updateKeySource(value: string): void {
    if (!provider) return;
    if (value) provider.apiKey = value;
    else delete provider.apiKey;
    if (clearing) settings.toggleClearKey(providerId);
    confirmClear = false;
  }

  function requestClear(): void {
    if (!provider) return;
    if (clearing) {
      settings.toggleClearKey(providerId);
      confirmClear = false;
      return;
    }
    confirmClear = true;
  }

  function clearStoredKey(): void {
    if (provider?.apiKey) delete provider.apiKey;
    if (!clearing) settings.toggleClearKey(providerId);
    confirmClear = false;
  }

  async function reauthorize(): Promise<void> {
    const model = settings.settings?.provider === providerId
      ? settings.settings.model : Object.keys(provider?.models ?? {})[0];
    if (!model) return;
    reauthorizing = true;
    settings.error = "";
    try {
      const response = await requestAgent({ type: "provider.reauthorize", id: providerId, model }, 60_000);
      if (!response.ok) throw new Error(response.error ?? t("Could not refresh authentication"));
      const result = response.result as { ok: boolean; message: string } | undefined;
      if (!result?.ok) throw new Error(result?.message ?? t("The provider did not confirm authentication"));
      settings.notice = t("Authentication refreshed and verified.");
    } catch (error) {
      settings.error = error instanceof Error ? error.message : String(error);
    } finally { reauthorizing = false; }
  }
</script>

{#if provider}
  <section class="section">
    <div class="fields">
      <label class="st-field">
        <span class="st-label">{t("API URL")}</span>
        <input
          class="st-input"
          bind:value={provider.baseUrl}
          placeholder="https://api.example.com/v1"
          spellcheck="false"
          data-settings-field={t("Base URL API address")}
          aria-invalid={urlError ? "true" : undefined}
        />
        {#if urlError}
          <span class="st-error" role="alert">{urlError}</span>
        {/if}
      </label>

      <label class="st-field">
        <span class="st-label">{t("Protocol")}</span>
        <select
          class="st-select"
          bind:value={provider.protocol}
          data-settings-field={t("Protocol")}
        >
          {#each PROTOCOLS as protocol}
            <option value={protocol.value}>{protocol.label}</option>
          {/each}
        </select>
      </label>

      <label class="st-field">
        <span class="st-label">{t("Proxy")}</span>
        <input
          class="st-input"
          value={provider.proxy ?? ""}
          placeholder="http://127.0.0.1:8080"
          spellcheck="false"
          data-settings-field={t("Proxy")}
          oninput={(event) => {
            const value = event.currentTarget.value.trim();
            if (value) provider.proxy = value;
            else delete provider.proxy;
          }}
        />
      </label>

      <label class="st-field">
        <span class="st-label">{t("Request timeout, ms")}</span>
        <input
          class="st-input"
          type="number"
          min="1000"
          max="600000"
          value={provider.transportTimeoutMs ?? ""}
          placeholder="120000"
          data-settings-field={t("Request timeout")}
          aria-invalid={timeoutError ? "true" : undefined}
          oninput={(event) => {
            const value = Number(event.currentTarget.value);
            if (Number.isFinite(value) && value > 0) provider.transportTimeoutMs = value;
            else delete provider.transportTimeoutMs;
          }}
        />
        {#if timeoutError}
          <span class="st-error" role="alert">{timeoutError}</span>
        {/if}
      </label>

      <div class="st-field key-field">
        <span class="st-label">{t("API key")}</span>
        <div class="key-row">
          <input
            class="st-input"
            type="password"
            aria-label={t("API key for provider {0}", [providerId])}
            value={provider.apiKey ?? ""}
            data-settings-field={t("API key Key")}
            oninput={(event) => updateKeySource(event.currentTarget.value)}
            placeholder={clearing
              ? t("key will be deleted")
              : keyState === "command"
                ? t("using a command")
                : keyState === "set"
                  ? t("key saved, enter a new one")
                  : keyState === "new"
                    ? t("new key")
                    : t("not set")}
            autocomplete="off"
            spellcheck="false"
          />
          {#if keyState !== "command" && (keyState === "set" || keyState === "new" || clearing)}
            <button
              class="st-btn st-btn--quiet st-btn--sm"
              type="button"
              onclick={requestClear}
            >
              {clearing ? t("Keep") : t("Delete")}
            </button>
          {/if}
        </div>
        <span class="key-source">
          <Icon name="key" size={12} />
          {keySource}
        </span>
        {#if provider.auth?.command}
          <button class="st-btn st-btn--quiet" type="button" disabled={settings.dirty || reauthorizing || modelCount === 0} onclick={reauthorize}>
            {reauthorizing ? t("Checking authentication…") : t("Refresh authentication")}
          </button>
          <span class="st-hint">{t("Run the saved authentication command again and check the model.")}</span>
        {/if}
        {#if confirmClear}
          <div class="st-confirm key-confirm" role="alert">
            <span>
              {#if hasDraftKey} {t("Remove the new key from the draft for provider “{0}”?", [provider.name || providerId])} {:else} {t("Delete the saved key for provider “{0}”?", [provider.name || providerId])} {/if}
              {#if envName} {t("Variable {0} will remain. You need to remove it from the environment.", [envName])} {:else} {t("The key will be removed when you save.")} {/if}
            </span>
            <div class="st-confirm-actions">
              <button
                class="st-btn st-btn--quiet st-btn--sm"
                type="button"
                onclick={() => (confirmClear = false)}
              > {t("Cancel")} </button>
              <button class="st-btn st-btn--danger st-btn--sm" type="button" onclick={clearStoredKey}> {t("Delete key")} </button>
            </div>
          </div>
        {/if}
      </div>

      <label class="st-field">
        <span class="st-label">{t("Environment variable")}</span>
        <input
          class="st-input"
          bind:value={provider.apiKeyEnv}
          placeholder="PROVIDER_API_KEY"
          spellcheck="false"
          data-settings-field={t("Environment variable")}
          aria-invalid={envError ? "true" : undefined}
        />
        {#if envError}
          <span class="st-error" role="alert">{envError}</span>
        {/if}
      </label>

      <ProviderHeaders {provider} {providerId} />
    </div>

    <ProviderTest {providerId} {modelCount} {urlError} />
  </section>
{/if}

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .fields {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }

  .key-field {
    grid-column: 1 / -1;
  }

  .key-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .key-row .st-input {
    flex: 1;
    min-width: 0;
  }

  .key-source {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.5;
  }

  .key-confirm {
    align-items: flex-start;
    flex-direction: column;
  }

  @media (max-width: 900px) {
    .fields {
      grid-template-columns: minmax(0, 1fr);
    }

    .key-field {
      grid-column: auto;
    }
  }

  @media (max-height: 720px) {
    .section {
      gap: 12px;
    }

    .fields {
      gap: 12px;
    }
  }
</style>
