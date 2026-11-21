<script lang="ts">
  import Select from "../controls/Select.svelte";
  import { onMount } from "svelte";
  import type { DictionaryStore } from "../../lib/dictionary.svelte";
  import { i18n, t } from "../../lib/i18n.svelte";
  import Icon from "../Icon.svelte";
  import DictionaryEditor from "./DictionaryEditor.svelte";
  import "./dictionary-settings.css";

  let { dictionary }: { dictionary: DictionaryStore } = $props();
  let expandedIds = $state<Record<string, boolean>>({});
  let showAllCategories = $state(false);
  const publicCount = $derived(dictionary.snapshot?.entries.filter((entry) => entry.source === "public").length ?? 0);
  const localCount = $derived(dictionary.snapshot?.entries.filter((entry) => entry.source === "local").length ?? 0);
  const scopeCategories = $derived(
    [...new Set((dictionary.snapshot?.entries ?? []).filter((entry) => entry.source === dictionary.scope).map((entry) => entry.category))].sort(),
  );
  const visibleCategories = $derived.by(() => {
    if (showAllCategories || scopeCategories.length <= 7) return scopeCategories;
    const base = scopeCategories.slice(0, 6);
    if (dictionary.category && !base.includes(dictionary.category) && scopeCategories.includes(dictionary.category)) {
      return [...base.slice(0, 5), dictionary.category];
    }
    return base;
  });
  const hiddenCategoryCount = $derived(Math.max(0, scopeCategories.length - visibleCategories.length));
  const singleResult = $derived(dictionary.entries.length === 1);

  function isOpen(key: string): boolean {
    return singleResult || Boolean(expandedIds[key]);
  }

  function toggleOpen(key: string): void {
    if (singleResult) return;
    expandedIds[key] = !expandedIds[key];
  }

  onMount(() => { void dictionary.load(); });
</script>

<section class="settings-section dictionary-settings" aria-labelledby="settings-dictionary">
  <div class="dictionary-top">
    <div class="dictionary-intro">
      <h2 id="settings-dictionary">{t("Memory and dictionary")}</h2>
      <p class="st-section-description">{t("Definitions are supplied automatically when a term appears in your prompt. Local meanings take priority.")}</p>
    </div>
    {#if !dictionary.draft}
      <button class="st-btn st-btn--primary" type="button" disabled={dictionary.busy || !dictionary.snapshot} onclick={() => dictionary.edit()}>
        <Icon name="plus" size={14} />{t("Add term")}
      </button>
    {/if}
  </div>

  {#if dictionary.error}
    <div class="dictionary-error" role="alert">
      <p class="st-error">{dictionary.error}</p>
      <button class="st-btn st-btn--quiet st-btn--sm" type="button" disabled={dictionary.busy} onclick={() => dictionary.load()}>{t("Reload dictionary")}</button>
    </div>
  {/if}

  {#if dictionary.draft}
    <DictionaryEditor {dictionary} />
  {:else}
    <div class="dictionary-controls-card">
      <div class="dictionary-toolbar">
        <nav class="dictionary-tabs" aria-label={t("Dictionary source")}>
          <button class="dictionary-tab" class:current={dictionary.scope === "public"} aria-pressed={dictionary.scope === "public"} type="button" onclick={() => { dictionary.scope = "public"; dictionary.deleting = null; }}>
            <span>{t("Public dictionary")}</span>
            {#if dictionary.snapshot}<span class="dictionary-tab-count">{publicCount}</span>{/if}
          </button>
          <button class="dictionary-tab" class:current={dictionary.scope === "local"} aria-pressed={dictionary.scope === "local"} type="button" onclick={() => { dictionary.scope = "local"; dictionary.deleting = null; }}>
            <span>{t("Local dictionary")}</span>
            {#if dictionary.snapshot}<span class="dictionary-tab-count">{localCount}</span>{/if}
          </button>
        </nav>

        {#if dictionary.scope === "public"}
          <div class="dictionary-sync-bar">
            {#if dictionary.snapshot?.syncedAt}
              <span class="st-hint dictionary-synced">{t("Updated: {0}", [new Date(dictionary.snapshot.syncedAt).toLocaleString(i18n.locale)])}</span>
            {/if}
            <button class="st-btn st-btn--quiet st-btn--sm" type="button" disabled={dictionary.busy} onclick={() => dictionary.load(true)}>
              <Icon name="refresh" size={14} />{dictionary.busy ? t("Updating…") : t("Update dictionary")}
            </button>
          </div>
        {/if}
      </div>

      <div class="dictionary-origin">
        {#if dictionary.scope === "public"}
          <p class="st-hint">{t("Shared definitions from AnnenkovLabs/flecten. The last verified copy is available offline.")}</p>
        {:else}
          <p class="st-hint">{t("Project memory keeps terms learned from your explanations or verified sources. You can also add them here.")}</p>
        {/if}
      </div>

      {#if dictionary.scope === "public" && dictionary.snapshot?.error}
        <div class="dictionary-sync-error" role="status">
          <p class="st-hint">{t("Public update failed. Saved definitions are still available.")}</p>
          <details><summary>{t("Details")}</summary><p class="st-hint">{dictionary.snapshot.error}</p></details>
        </div>
      {/if}

      <div class="dictionary-filters">
        <label class="st-search">
          <Icon name="search" size={14} />
          <input bind:value={dictionary.query} aria-label={t("Search dictionary")} placeholder={t("Search dictionary")} />
        </label>
        <Select class="st-select" bind:value={dictionary.category} aria-label={t("Term category")}
          options={[{ value: "", label: t("All categories") }, ...dictionary.categories.map((category) => ({ value: category, label: category }))]} />
      </div>

      {#if dictionary.snapshot && scopeCategories.length > 1}
        <div class="dictionary-category-pills">
          <button class="dictionary-pill" class:is-active={dictionary.category === ""} type="button" onclick={() => (dictionary.category = "")}>
            {t("All categories")}
          </button>
          {#each visibleCategories as category (category)}
            <button class="dictionary-pill" class:is-active={dictionary.category === category} type="button" onclick={() => (dictionary.category = dictionary.category === category ? "" : category)}>
              {category}
            </button>
          {/each}
          {#if hiddenCategoryCount > 0}
            <button class="dictionary-pill dictionary-pill--more" type="button" onclick={() => (showAllCategories = true)}>
              +{hiddenCategoryCount}
            </button>
          {:else if showAllCategories && scopeCategories.length > 7}
            <button class="dictionary-pill dictionary-pill--more" type="button" onclick={() => (showAllCategories = false)}>
              {t("Show Less")}
            </button>
          {/if}
        </div>
      {/if}
    </div>

    {#if dictionary.loading}
      <p class="st-hint" role="status">{t("Loading dictionary…")}</p>
    {:else if dictionary.snapshot}
      <div class="dictionary-meta-bar">
        <p class="st-hint dictionary-count" role="status">{t("Terms found: {0}", [dictionary.entries.length])}</p>
      </div>
      <div class="dictionary-list">
        {#each dictionary.entries as entry (`${entry.source}:${entry.id}`)}
          {@const key = `${entry.source}:${entry.id}`}
          {@const open = isOpen(key)}
          <article class="dictionary-entry" class:is-open={open}>
            <div class="dictionary-head-row">
              <button class="dictionary-head-toggle" type="button" aria-expanded={open} onclick={() => toggleOpen(key)}>
                <div class="dictionary-heading">
                  <h3>{entry.term}</h3>
                  <span class="dictionary-badge">{entry.category}</span>
                  {#if entry.source === "public" && dictionary.hasLocal(entry.id)}
                    <span class="dictionary-badge dictionary-badge--local">{t("Locally overridden")}</span>
                  {/if}
                </div>
                {#if entry.aliases.length > 0 && !open}
                  <span class="dictionary-preview-aliases">{entry.aliases.slice(0, 3).join(" · ")}{entry.aliases.length > 3 ? ` +${entry.aliases.length - 3}` : ""}</span>
                {/if}
              </button>
              <div class="dictionary-actions">
                <button class="st-btn st-btn--quiet st-btn--sm" type="button" disabled={dictionary.busy} onclick={() => dictionary.edit(entry)}>
                  {entry.source === "public" ? t("Customize locally") : t("Edit")}
                </button>
                {#if entry.source === "local"}
                  <button class="st-btn st-btn--danger st-btn--sm" type="button" disabled={dictionary.busy} onclick={() => (dictionary.deleting = entry)}>
                    {t("Delete")}
                  </button>
                {/if}
              </div>
            </div>

            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <p class="dictionary-definition" class:is-clamped={!open} onclick={() => { if (!open) toggleOpen(key); }}>{entry.definition}</p>

            {#if open}
              {#if entry.clarification}
                <div class="dictionary-clarification">
                  <strong>{t("Common confusion")}</strong>
                  <p>{entry.clarification}</p>
                </div>
              {/if}

              {#if entry.aliases.length > 0 || entry.sources.length > 0}
                <div class="dictionary-footer-meta">
                  {#if entry.aliases.length > 0}
                    <div class="dictionary-alias-chips">
                      {#each entry.aliases as alias}
                        <span class="dictionary-alias-chip">{alias}</span>
                      {/each}
                    </div>
                  {/if}
                  {#if entry.sources.length > 0}
                    <div class="dictionary-links">
                      {#each entry.sources as source}
                        <a href={source} target="_blank" rel="noreferrer" data-tooltip={source}>{new URL(source).hostname}</a>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            {/if}

            {#if dictionary.deleting?.id === entry.id && entry.source === "local"}
              <div class="dictionary-confirm" role="alert">
                <p>{t("Delete local meaning for “{0}”? Any public definition will become active again.", [entry.term])}</p>
                <div class="dictionary-actions">
                  <button class="st-btn st-btn--danger st-btn--sm" type="button" disabled={dictionary.busy} onclick={() => dictionary.forget()}>{t("Delete local term")}</button>
                  <button class="st-btn st-btn--quiet st-btn--sm" type="button" disabled={dictionary.busy} onclick={() => (dictionary.deleting = null)}>{t("Cancel")}</button>
                </div>
              </div>
            {/if}
          </article>
        {:else}
          <div class="dictionary-empty">
            <p class="st-hint">{dictionary.query || dictionary.category ? t("No matching terms. Clear the search or choose another category.") : dictionary.scope === "local" ? t("No local terms yet. Add a term or explain a new meaning to the agent.") : t("No public terms available. Try updating the dictionary.")}</p>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>
