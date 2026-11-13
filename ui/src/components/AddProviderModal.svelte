<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { modal } from "../lib/modal";
  import { modelsCount } from "../lib/format";
  import { settings } from "../lib/settings.svelte";
  import { PROTOCOLS, protocolShort } from "../lib/settings-utils";
  import type { ProviderProtocol } from "../lib/types";
  import Icon from "./Icon.svelte";
  import ProviderGlyph from "./ProviderGlyph.svelte";

  let searchEl = $state<HTMLInputElement | null>(null);

  function choose(protocol: ProviderProtocol): void {
    settings.custom.protocol = protocol;
  }

  function close(): void {
    settings.addOpen = false;
  }


</script>

{#if settings.addOpen}
  <dialog
    class="add-dialog st-dialog"
    use:modal={() => searchEl}
    tabindex="-1"
    aria-labelledby="add-provider-title"
    oncancel={(event) => {
      event.preventDefault();
      close();
    }}
  >
    <header class="add-head">
      <div>
        <h2 id="add-provider-title">{t("Add provider")}</h2>
        <p>{t("Choose a service from the catalog or connect your own server.")}</p>
      </div>
      <button
        class="st-icon-btn"
        type="button"
        aria-label={t("Close")}
        title={t("Close")}
        onclick={close}
      >
        <Icon name="x" size={16} />
      </button>
    </header>

    <div class="tabs" role="group" aria-label={t("How to add")}>
      <button
        class="tab"
        class:is-on={settings.addMode === "ready"}
        type="button"
        aria-pressed={settings.addMode === "ready"}
        onclick={() => (settings.addMode = "ready")}
      > {t("From catalog")} </button>
      <button
        class="tab"
        class:is-on={settings.addMode === "custom"}
        type="button"
        aria-pressed={settings.addMode === "custom"}
        onclick={() => (settings.addMode = "custom")}
      > {t("Custom server")} </button>
    </div>

    <div class="add-body">
      {#if settings.addMode === "ready"}
        <label class="st-search">
          <Icon name="search" size={14} />
          <input
            bind:this={searchEl}
            bind:value={settings.catalogSearch}
            placeholder={t("Provider name")}
            aria-label={t("Search the provider catalog")}
          />
        </label>

        {#if settings.catalogLoading}
          <div class="st-empty" role="status">
            <span>{t("Loading model catalog…")}</span>
          </div>
        {:else}
          <div class="provider-list">
            {#each settings.filteredCatalog as provider (provider.id)}
              <button
                class="provider-row"
                type="button"
                disabled={settings.discovering}
                onclick={() => settings.addReady(provider.id)}
              >
                <ProviderGlyph id={provider.id} baseUrl={provider.baseUrl} title={provider.name} size={24} />
                <span class="provider-main">
                  <span class="provider-name">{provider.name}</span>
                  <span class="provider-url st-mono" title={provider.baseUrl}>{provider.baseUrl}</span>
                </span>
                <span class="provider-meta">
                  <span class="st-badge">{protocolShort(provider.protocol)}</span>
                  <span class="st-badge">{modelsCount(provider.modelCount)}</span>
                  {#if provider.apiKeyEnv}
                    <span class="st-badge st-mono">{provider.apiKeyEnv}</span>
                  {/if}
                </span>
                <span class="add-icon"><Icon name="plus" size={15} /></span>
              </button>
            {/each}
            {#if settings.filteredCatalog.length === 0}
              <div class="st-empty">
                <span>{t("No results found.")}</span>
                <span>{t("Change your search or switch to the “Custom server” tab.")}</span>
              </div>
            {/if}
          </div>
        {/if}
      {:else}
        <div class="custom">
          <div class="protocols" role="radiogroup" aria-label={t("Protocol")}>
            {#each PROTOCOLS as protocol}
              <button
                class="protocol"
                class:is-on={settings.custom.protocol === protocol.value}
                type="button"
                role="radio"
                aria-checked={settings.custom.protocol === protocol.value}
                onclick={() => choose(protocol.value)}
              >
                <strong>{protocol.short}</strong>
                <span>{protocol.hint}</span>
              </button>
            {/each}
          </div>

          <label class="st-field">
            <span class="st-label">{t("API URL")}</span>
            <input
              class="st-input"
              bind:value={settings.custom.baseUrl}
              placeholder="https://api.example.com/v1"
              spellcheck="false"
            />
            <span class="st-hint">{t("Base URL, usually ending in /v1.")}</span>
          </label>

          <label class="st-field">
            <span class="st-label">{t("API key")}</span>
            <input
              class="st-input"
              type="password"
              bind:value={settings.custom.apiKey}
              placeholder={t("optional for a local server")}
              autocomplete="off"
              spellcheck="false"
            />
          </label>

          <div class="discover">
            <button
              class="st-btn st-btn--primary"
              type="button"
              disabled={settings.discovering || settings.custom.baseUrl.trim().length === 0}
                    onclick={() => settings.discover()}
            >
              <Icon name="refresh" size={14} />
              {settings.discovering ? t("Scanning API…") : t("Connect and find models")}
            </button>
            <p class="st-hint"> {t("The app will get the model list from the API and fill in context limits and capabilities from the catalog.")} </p>
          </div>
        </div>
      {/if}

      {#if settings.error}
        <div class="st-status st-status--error" role="alert">
          <Icon name="x" size={14} />
          <span>{settings.error}</span>
        </div>
      {/if}
    </div>
  </dialog>
{/if}

<style>
  .add-dialog {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    width: min(880px, calc(100vw - 48px));
    height: min(680px, calc(100vh - 48px));
    border-radius: 12px;
    overflow: hidden;
    box-shadow:
      0 0 0 1px rgba(240, 239, 237, 0.08),
      0 28px 90px rgba(0, 0, 0, 0.55),
      inset 0 1px 0 rgba(240, 239, 237, 0.05);
  }

  .add-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    padding: 20px 24px 12px;
  }

  h2 {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }

  .add-head p {
    margin-top: 4px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.5;
  }

  .tabs {
    display: flex;
    gap: 4px;
    width: fit-content;
    margin: 0 24px 4px;
    padding: 3px;
    border-radius: 9px;
    background: rgba(240, 239, 237, 0.04);
  }

  .tab {
    height: 40px;
    padding: 0 12px;
    border-radius: 7px;
    color: var(--muted);
    font-size: 13px;
    transition:
      background var(--t-touch) var(--ease),
      color var(--t-touch) var(--ease);
  }

@media (hover: hover) and (pointer: fine) {
  .tab:hover {
    color: var(--text-2);
  }
}
  .tab.is-on {
    background: var(--raised);
    color: var(--text);
    box-shadow: inset 0 1px 0 rgba(240, 239, 237, 0.06);
  }

  .add-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 24px 24px;
  }

  .provider-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
  }

  .provider-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 66px;
    padding: 8px 10px;
    border-radius: 8px;
    text-align: left;
    transition: background var(--t-touch) var(--ease);
  }

@media (hover: hover) and (pointer: fine) {
  .provider-row:hover {
    background: rgba(240, 239, 237, 0.045);
  }
}
  .provider-row:disabled {
    opacity: 0.5;
  }

  .provider-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .provider-name {
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
  }

  .provider-url {
    overflow: hidden;
    color: var(--muted);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .provider-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }

  .add-icon {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 7px;
    color: var(--muted);
    transition:
      background var(--t-touch) var(--ease),
      color var(--t-touch) var(--ease);
  }

@media (hover: hover) and (pointer: fine) {
  .provider-row:hover .add-icon {
    background: rgba(240, 239, 237, 0.07);
    color: var(--text);
  }
}
  .custom {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .protocols {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .protocol {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 76px;
    padding: 12px;
    border-radius: 9px;
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line);
    text-align: left;
    transition:
      background var(--t-touch) var(--ease),
      box-shadow var(--t-touch) var(--ease);
  }

@media (hover: hover) and (pointer: fine) {
  .protocol:hover {
    background: var(--raised);
  }
}
  .protocol strong {
    color: var(--text-2);
    font-size: 13px;
    font-weight: 600;
  }

  .protocol span {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
  }

  .protocol.is-on {
    background: color-mix(in srgb, var(--primary) 7%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary) 42%, transparent);
  }

  .protocol.is-on strong {
    color: var(--text);
  }

  .discover {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    margin-top: 2px;
  }

  .discover .st-hint {
    max-width: 62ch;
  }

  @media (max-width: 720px) {
    .provider-meta .st-badge:last-child {
      display: none;
    }

    .protocols {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
