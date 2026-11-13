<script lang="ts">
  import type { HookRun } from "../../../shared/hooks";
  import type { DictionaryStore } from "../lib/dictionary.svelte";
  let { hookRuns = [], dictionary }: { hookRuns?: HookRun[]; dictionary: DictionaryStore } = $props();
  import { t } from "../lib/i18n.svelte";
  import { modal } from "../lib/modal";
  import "./settings-surface.css";
  import "./settings-layout.css";
  import "./settings-sections.css";
  import "./settings-polish.css";
  import { countLabel, formatNumber } from "../lib/format";
  import { formatModelName } from "../lib/model-name";
  import { isModifier, shortcutLabel } from "../lib/platform";
  import { settingsSection } from "../lib/motion";
  import { settings } from "../lib/settings.svelte";
  import { closeAction } from "../lib/settings-utils";
  import { searchSettingsSections, type SettingsSectionId } from "../lib/settings/sections";
  import AddProviderModal from "./AddProviderModal.svelte";
  import Icon from "./Icon.svelte";
  import ProviderEditor from "./ProviderEditor.svelte";
  import ProviderGlyph from "./ProviderGlyph.svelte";
  import ModulesSettings from "./settings/ModulesSettings.svelte";
  import AboutSettings from "./settings/AboutSettings.svelte";
  import GeneralSettings from "./settings/GeneralSettings.svelte";
  import HistorySettings from "./settings/HistorySettings.svelte";
  import PermissionsSettings from "./settings/PermissionsSettings.svelte";
  import SandboxSettings from "./settings/SandboxSettings.svelte";
  import ServerSettings from "./settings/ServerSettings.svelte";
  import McpSettings from "./settings/McpSettings.svelte";
  import SkillsSettings from "./settings/SkillsSettings.svelte";
  import ToolsSettings from "./settings/ToolsSettings.svelte";
  import DictionarySettings from "./settings/DictionarySettings.svelte";

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let scrollEl = $state<HTMLDivElement | null>(null);
  let showLoading = $state(false);
  let section = $state<SettingsSectionId>("general");
  let confirmDiscard = $state(false);
  let wasOpen = false;

  const config = $derived(settings.settings);
  const providerCount = $derived(Object.keys(config?.providers ?? {}).length);
  const matches = $derived(searchSettingsSections(settings.search));
  const contextError = $derived(settings.validationIssue);
  const saveTitle = $derived(
    contextError
        ? contextError
        : settings.dirty
          ? t("Save ({0})", [shortcutLabel("s")])
          : t("No changes"),
  );

  $effect(() => {
    if (settings.open && !wasOpen) {
      section = settings.requestedSection ?? "general";
      settings.requestedSection = null;
      confirmDiscard = false;
    }
    wasOpen = settings.open;
  });

  $effect(() => {
    void section;
    void settings.selected;
    if (scrollEl) scrollEl.scrollTop = 0;
  });

  $effect(() => {
    if (!settings.open || !settings.loading || settings.settings) {
      showLoading = false;
      return;
    }
    const timer = setTimeout(() => (showLoading = true), 200);
    return () => clearTimeout(timer);
  });



  function modelCountLabel(count: number): string {
    if (count === 0) return t("No models");
    return `${countLabel(count, "model")}`;
  }

  function requestClose(): void {
    if (closeAction(settings.dirty) === "confirm") {
      confirmDiscard = true;
      return;
    }
    settings.close();
  }

  function discardAndClose(): void {
    settings.discard();
    settings.close();
    confirmDiscard = false;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!settings.open || settings.addOpen) return;
    if (!isModifier(event) || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    if (settings.canSave) void settings.save();
  }

  function onProviderKeydown(event: KeyboardEvent, providerId: string): void {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>(".provider-row"));
    const index = rows.findIndex((row) => row.dataset.providerId === providerId);
    if (index < 0) return;
    let next = index;
    if (event.key === "ArrowDown") next = Math.min(index + 1, rows.length - 1);
    else if (event.key === "ArrowUp") next = Math.max(index - 1, 0);
    else if (event.key === "Home") next = 0;
    else next = rows.length - 1;
    const target = rows[next];
    if (!target) return;
    event.preventDefault();
    target.focus();
    if (target.dataset.providerId) settings.select(target.dataset.providerId);
  }

</script>

<svelte:window onkeydown={onKeydown} />

{#if settings.open}
  <dialog
    class="settings-dialog st-dialog"
    bind:this={dialogEl}
    use:modal={() => dialogEl}
    tabindex="-1"
    aria-labelledby="settings-title"
    oncancel={(event) => {
      event.preventDefault();
      if (confirmDiscard) {
        confirmDiscard = false;
        return;
      }
      requestClose();
    }}
  >
    <header class="settings-head">
      <h1 id="settings-title">{t("Settings")}</h1>
      <button
        class="st-icon-btn"
        type="button"
        aria-label={t("Close settings")}
        title={t("Close settings (Esc)")}
        onclick={requestClose}
      >
        <Icon name="x" size={17} />
      </button>
    </header>

    <div class="settings-body">
      <aside class="rail" aria-label={t("Settings sections")}>
        {#if section === "providers"}
          <button class="rail-back" type="button" onclick={() => (section = "general")}>
            <Icon name="chevron-right" size={14} class="back-icon" /> {t("Previous")} </button>

          <div class="rail-head">
            <div class="rail-title">
              <span>{t("Providers")}</span>
              {#if config}<span class="st-count">{formatNumber(providerCount)}</span>{/if}
            </div>
            <button
              class="st-btn st-btn--quiet st-btn--sm"
              type="button"
              disabled={settings.loading || !config || settings.discovering}
              onclick={() => {
                settings.addOpen = true;
                settings.addMode = "ready";
                settings.error = "";
              }}
            >
              <Icon name="plus" size={14} /> {t("Add")} </button>
          </div>

          <label class="st-search provider-search">
            <Icon name="search" size={14} />
            <input
              bind:value={settings.providerSearch}
              placeholder={t("Search providers")}
              aria-label={t("Search providers")}
            />
          </label>

          <div class="provider-list">
            {#if !config}
              {#if settings.loading}
                {#each [0, 1, 2] as row (row)}
                  <div class="rail-skeleton" aria-hidden="true">
                    <span class="skel skel-dot"></span>
                    <span class="skel-lines">
                      <span class="skel skel-line"></span>
                      <span class="skel skel-line skel-line--short"></span>
                    </span>
                  </div>
                {/each}
              {:else if settings.error}
                <div class="st-empty">{t("List unavailable.")}</div>
              {/if}
            {:else}
              {#each settings.filteredProviders as entry (entry.id)}
                <button
                  class="provider-row"
                  class:is-active={entry.id === settings.selected}
                  type="button"
                  data-provider-id={entry.id}
                  aria-current={entry.id === settings.selected ? "true" : undefined}
                  onclick={() => settings.select(entry.id)}
                  onkeydown={(event) => onProviderKeydown(event, entry.id)}
                >
                  <ProviderGlyph id={entry.id} baseUrl={entry.provider.baseUrl} title={entry.provider.name} size={22} />
                  <span class="provider-copy">
                    <span class="provider-name">
                      {entry.provider.name || formatModelName(entry.id)}
                    </span>
                    <span class="provider-meta">
                      {modelCountLabel(Object.keys(entry.provider.models).length)}
                    </span>
                  </span>
                  {#if entry.active}
                    <span class="provider-active" aria-label={t("Active provider")}>
                      <Icon name="check" size={13} />
                    </span>
                  {/if}
                </button>
              {/each}
              {#if settings.filteredProviders.length === 0}
                <div class="st-empty">
                  {settings.providerSearch.trim() ? t("No results found.") : t("No providers.")}
                </div>
              {/if}
            {/if}
          </div>
        {:else}
          <label class="st-search settings-search">
            <Icon name="search" size={14} />
            <input
              bind:value={settings.search}
              placeholder={t("Search settings")}
              aria-label={t("Search sections and fields")}
              onkeydown={(event) => {
                if (event.key !== "Enter") return;
                const first = matches[0];
                if (!first) return;
                event.preventDefault();
                section = first.id;
                settings.search = "";
              }}
            />
          </label>

          <nav class="section-nav">
            {#each matches as entry (entry.id)}
              <div class="section-row" class:is-active={section === entry.id}>
                <button
                  class="section-main"
                  type="button"
                  aria-current={section === entry.id ? "true" : undefined}
                  onclick={() => {
                    section = entry.id;
                    settings.search = "";
                  }}
                >
                  <Icon name={entry.icon} size={16} />
                  <span class="section-name">{entry.label}</span>
                </button>
              </div>
            {/each}
            {#if matches.length === 0}
              <div class="st-empty rail-empty">{t("No results found.")}</div>
            {/if}
          </nav>
        {/if}
      </aside>

      <div class="settings-main">
        <div
          class="main-scroll"
          bind:this={scrollEl}
          use:settingsSection={section === "providers" ? `${section}:${settings.selected ?? ""}` : section}
        >
          {#if !config && settings.error}
            <div class="st-empty load-error" role="alert">
              <span>{t("Could not load settings.")}</span>
              <span class="st-hint">{settings.error}</span>
              <button
                class="st-btn st-btn--quiet st-btn--sm"
                type="button"
                onclick={() => settings.load()}
              > {t("Retry")} </button>
            </div>
          {:else if !config && showLoading}
            <div class="main-skeleton" role="status" aria-label={t("Loading settings")}>
              <span class="skel skel-title"></span>
              <span class="skel skel-line"></span>
              <span class="skel skel-line"></span>
              <div class="skel-grid">
                <span class="skel skel-field"></span>
                <span class="skel skel-field"></span>
                <span class="skel skel-field"></span>
                <span class="skel skel-field"></span>
              </div>
            </div>
          {:else if config}
            {#if section === "general"}
              <GeneralSettings />
            {:else if section === "providers"}
              <ProviderEditor />
            {:else if section === "permissions"}
              <PermissionsSettings />
            {:else if section === "sandbox"}
              <SandboxSettings />
            {:else if section === "history"}
              <HistorySettings />
            {:else if section === "dictionary"}
              <DictionarySettings {dictionary} />
            {:else if section === "tools"}
              <ToolsSettings />
            {:else if section === "mcp"}
              <McpSettings />
            {:else if section === "hooks"}
              <ServerSettings runs={hookRuns} />
            {:else if section === "skills"}
              <SkillsSettings />
            {:else if section === "modules"}
              <ModulesSettings />
            {:else if section === "about"}
              <AboutSettings />
            {/if}
          {/if}
        </div>

        {#if settings.runningTasks > 0}
          <div class="run-banner" role="status">
            <Icon name="spark" size={15} />
            <span> {t("Tasks in progress: {0}. Permissions apply to the next action; other settings apply to the next run.", [settings.runningTasks])} </span>
          </div>
        {/if}

        <footer class="settings-foot">
          {#if confirmDiscard}
            <div class="discard-bar" role="alert">
              <span>{t("Close without saving?")}</span>
              <div class="discard-actions">
                <button
                  class="st-btn st-btn--quiet st-btn--sm"
                  type="button"
                  onclick={() => (confirmDiscard = false)}
                > {t("Stay")} </button>
                <button class="st-btn st-btn--danger st-btn--sm" type="button" onclick={discardAndClose}> {t("Don't save")} </button>
              </div>
            </div>
          {:else}
            <div class="foot-message">
              {#if settings.error && config}
                <span class="st-error foot-error" role="alert">{settings.error}</span>
              {:else if settings.dirty && contextError}
                <span class="st-error foot-error" role="alert">{contextError}</span>
              {:else if settings.notice}
                <span class="foot-notice" role="status">
                  <Icon name="check" size={13} />
                  {settings.notice}
                </span>
              {:else if settings.dirty}
                <span class="st-hint">{t("Not saved")}</span>
              {/if}
            </div>
            <div class="foot-actions">
              <button class="st-btn st-btn--quiet" type="button" onclick={requestClose}> {t("Close")} </button>
              <button
                class="st-btn st-btn--primary"
                type="button"
                title={saveTitle}
                disabled={!settings.canSave}
                onclick={() => settings.save()}
              >
                {settings.saving ? t("Saving…") : t("Save")}
              </button>
            </div>
          {/if}
        </footer>
      </div>
    </div>
  </dialog>

  <AddProviderModal />
{/if}
