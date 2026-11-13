<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { countLabel } from "../lib/format";
  import { formatModelName } from "../lib/model-name";
  import { settings } from "../lib/settings.svelte";
  import Icon from "./Icon.svelte";
  import ProviderAdvanced from "./ProviderAdvanced.svelte";
  import ProviderConnection from "./ProviderConnection.svelte";
  import ProviderModels from "./ProviderModels.svelte";

  const TABS = $derived([
    { id: "connection", label: t("Connection") },
    { id: "models", label: t("Models") },
    { id: "advanced", label: t("Advanced") },
  ] as const);

  type TabId = (typeof TABS)[number]["id"];

  const id = $derived(settings.selected ?? "");
  const provider = $derived(settings.provider);
  const active = $derived(settings.settings?.provider === id);
  const modelCount = $derived(Object.keys(provider?.models ?? {}).length);
  const canRemove = $derived(Object.keys(settings.settings?.providers ?? {}).length > 1);

  let tab = $state<TabId>("connection");
  let lastId = "";
  let confirmDelete = $state(false);

  $effect(() => {
    if (id === lastId) return;
    lastId = id;
    tab = "connection";
    confirmDelete = false;
  });

  function setActive(): void {
    if (!provider) return;
    const current = settings.settings?.model;
    const model =
      current && provider.models[current] ? current : Object.keys(provider.models)[0];
    if (model) void settings.setActive(id, model);
  }

  function modelsLabel(count: number): string {
    if (count === 0) return t("No models");
    return `${countLabel(count, "model")}`;
  }

  function selectTab(next: TabId): void {
    tab = next;
    document.querySelector<HTMLElement>(".main-scroll")?.scrollTo({ top: 0 });
  }

  function onTabKeydown(event: KeyboardEvent, current: TabId): void {
    const index = TABS.findIndex((entry) => entry.id === current);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    const next = TABS[nextIndex];
    if (!next) return;
    event.preventDefault();
    selectTab(next.id);
    queueMicrotask(() => document.getElementById(`provider-tab-${next.id}`)?.focus());
  }
</script>

{#if provider}
  <section class="provider-editor" aria-label={t("Provider settings")}>
    <header class="provider-head">
      <div class="provider-title">
        <input
          class="name-input"
          bind:value={provider.name}
          placeholder={formatModelName(id)}
          aria-label={t("Provider name")}
        />
        <div class="provider-meta">{modelsLabel(modelCount)}</div>
      </div>
      {#if !active}
        <div class="provider-action">
          <button
            class="st-btn st-btn--quiet st-btn--sm"
            type="button"
            disabled={modelCount === 0}
            onclick={setActive}
          >
            <Icon name="check" size={13} /> {t("Set as active")} </button>
          {#if modelCount === 0}
            <span class="st-hint">{t("Add a model first.")}</span>
          {/if}
        </div>
      {/if}
    </header>

    <div class="tabs" role="tablist" aria-label={t("Provider sections")}>
      {#each TABS as entry (entry.id)}
        <button
          class="tab"
          class:is-on={tab === entry.id}
          id={`provider-tab-${entry.id}`}
          type="button"
          role="tab"
          aria-selected={tab === entry.id}
          aria-controls={`provider-panel-${entry.id}`}
          tabindex={tab === entry.id ? 0 : -1}
          onclick={() => selectTab(entry.id)}
          onkeydown={(event) => onTabKeydown(event, entry.id)}
        >
          {entry.label}
        </button>
      {/each}
    </div>

    <div class="panels">
      <div
        class="panel"
        id="provider-panel-connection"
        role="tabpanel"
        aria-labelledby="provider-tab-connection"
        hidden={tab !== "connection"}
      >
        <ProviderConnection providerId={id} />
      </div>

      <div
        class="panel"
        id="provider-panel-models"
        role="tabpanel"
        aria-labelledby="provider-tab-models"
        hidden={tab !== "models"}
      >
        <ProviderModels providerId={id} />
      </div>

      <div
        class="panel"
        id="provider-panel-advanced"
        role="tabpanel"
        aria-labelledby="provider-tab-advanced"
        hidden={tab !== "advanced"}
      >
        <section class="section">
          <h2 class="st-title">{t("Cache and limits")}</h2>
          <div class="fields">
            <label class="st-field">
              <span class="st-label">{t("Prompt cache key")}</span>
              <input
                class="st-input"
                bind:value={provider.promptCacheKey}
                placeholder={t("optional")}
                spellcheck="false"
              />
              <span class="st-hint">{t("Shared request prefix across turns.")}</span>
            </label>
            <label class="st-field">
              <span class="st-label">{t("Response limit (tokens)")}</span>
              <input
                class="st-input"
                type="number"
                min="1"
                bind:value={provider.maxOutputTokens}
                placeholder={t("inherit")}
              />
            </label>
          </div>
        </section>

        <div class="advanced-gap">
          <ProviderAdvanced providerId={id} />
        </div>

        <div class="danger-zone">
          <div class="danger-copy">
            <h3 class="st-block-title">{t("Delete provider")}</h3>
            <p class="st-hint">{t("Models and the key will be removed after saving.")}</p>
          </div>
          {#if confirmDelete}
            <div class="st-confirm-actions">
              <span class="st-hint">{t("Delete “{0}”?", [provider.name || id])}</span>
              <button
                class="st-btn st-btn--quiet st-btn--sm"
                type="button"
                onclick={() => (confirmDelete = false)}
              > {t("Cancel")} </button>
              <button
                class="st-btn st-btn--danger st-btn--sm"
                type="button"
                onclick={() => {
                  confirmDelete = false;
                  settings.removeProvider(id);
                }}
              > {t("Delete")} </button>
            </div>
          {:else}
            <button
              class="st-btn st-btn--danger st-btn--sm"
              type="button"
              disabled={!canRemove}
              title={canRemove ? undefined : t("Cannot delete the last provider")}
              onclick={() => (confirmDelete = true)}
            >
              <Icon name="trash" size={13} /> {t("Delete")} </button>
          {/if}
        </div>
      </div>
    </div>
  </section>
{:else}
  <div class="st-empty placeholder">
    <Icon name="server" size={26} />
    <span>{t("Select a provider on the left or add a new one.")}</span>
  </div>
{/if}

<style>
  .provider-editor {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .provider-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
  }

  .provider-title {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    flex: 1;
  }

  .name-input {
    width: 100%;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: 0;
    background: none;
    color: var(--text);
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.03em;
    line-height: 1.2;
  }

  .name-input:focus-visible {
    outline: 1px solid color-mix(in srgb, var(--primary) 55%, transparent);
    outline-offset: 3px;
    border-radius: 3px;
  }

  .provider-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 10px;
    color: var(--muted);
    font-size: 12px;
  }

  .provider-action {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }

  .tabs {
    display: flex;
    gap: 24px;
    border-bottom: 1px solid var(--line);
  }

  .tab {
    position: relative;
    height: 40px;
    padding: 0;
    color: var(--muted);
    font-size: 13px;
    transition: color var(--t-touch) var(--ease);
  }

@media (hover: hover) and (pointer: fine) {
  .tab:hover {
    color: var(--text-2);
  }
}
  .tab.is-on {
    color: var(--text);
  }

  .tab::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    border-radius: 2px;
    background: transparent;
    transition: background var(--t-touch) var(--ease);
  }

  .tab.is-on::after {
    background: var(--primary);
  }

  .panels {
    padding-top: 20px;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    align-items: start;
  }

  .advanced-gap {
    margin-top: 32px;
  }

  .danger-zone {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-top: 32px;
    padding-top: 20px;
    border-top: 1px solid var(--line);
  }

  .danger-copy {
    min-width: 0;
  }

  .danger-copy .st-hint {
    margin-top: 4px;
  }

  .placeholder {
    min-height: 320px;
    justify-content: center;
    gap: 10px;
  }

  @media (max-height: 720px) {
    .provider-editor {
      gap: 12px;
    }

    .tab {
      height: 40px;
    }

    .panels {
      padding-top: 16px;
    }

    .section {
      gap: 12px;
    }

    .fields {
      gap: 12px;
    }
  }
</style>
