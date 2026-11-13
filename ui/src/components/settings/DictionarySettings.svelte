<script lang="ts">
  import { onMount } from "svelte";
  import type { DictionaryStore } from "../../lib/dictionary.svelte";
  import { i18n, t } from "../../lib/i18n.svelte";
  import Icon from "../Icon.svelte";
  import DictionaryEditor from "./DictionaryEditor.svelte";
  import "./dictionary-settings.css";

  let { dictionary }: { dictionary: DictionaryStore } = $props();
  onMount(() => { void dictionary.load(); });
</script>

<section class="settings-section dictionary-settings" aria-labelledby="settings-dictionary">
  <h2 id="settings-dictionary">{t("Memory and dictionary")}</h2>
  <p class="st-hint">{t("Definitions are supplied automatically when a term appears in your prompt. Local meanings take priority.")}</p>
  {#if dictionary.error}
    <div class="dictionary-error" role="alert"><p class="st-error">{dictionary.error}</p><button class="st-btn st-btn--quiet" type="button" disabled={dictionary.busy} onclick={() => dictionary.load()}>{t("Reload dictionary")}</button></div>
  {/if}
  {#if dictionary.draft}
    <DictionaryEditor {dictionary} />
  {:else}
    <div class="dictionary-toolbar">
      <nav class="dictionary-tabs" aria-label={t("Dictionary source")}>
        <button class="st-btn st-btn--quiet" class:current={dictionary.scope === "public"} aria-pressed={dictionary.scope === "public"} type="button" onclick={() => { dictionary.scope = "public"; dictionary.deleting = null; }}>{t("Public dictionary")}</button>
        <button class="st-btn st-btn--quiet" class:current={dictionary.scope === "local"} aria-pressed={dictionary.scope === "local"} type="button" onclick={() => { dictionary.scope = "local"; dictionary.deleting = null; }}>{t("Local dictionary")}</button>
      </nav>
      <button class="st-btn st-btn--quiet" type="button" disabled={dictionary.busy || !dictionary.snapshot} onclick={() => dictionary.edit()}><Icon name="plus" size={14} />{t("Add term")}</button>
    </div>
    {#if dictionary.scope === "public"}
      <div class="dictionary-origin">
        <p class="st-hint">{t("Shared definitions from AnnenkovLabs/flecten. The last verified copy is available offline.")}</p>
        <button class="st-btn st-btn--quiet st-btn--sm" type="button" disabled={dictionary.busy} onclick={() => dictionary.load(true)}><Icon name="refresh" size={14} />{dictionary.busy ? t("Updating…") : t("Update dictionary")}</button>
      </div>
      {#if dictionary.snapshot?.syncedAt}<p class="st-hint">{t("Updated: {0}", [new Date(dictionary.snapshot.syncedAt).toLocaleString(i18n.locale)])}</p>{/if}
      {#if dictionary.snapshot?.error}<div class="dictionary-sync-error" role="status"><p class="st-hint">{t("Public update failed. Saved definitions are still available.")}</p><details><summary>{t("Details")}</summary><p class="st-hint">{dictionary.snapshot.error}</p></details></div>{/if}
    {:else}
      <p class="st-hint">{t("Project memory keeps terms learned from your explanations or verified sources. You can also add them here.")}</p>
    {/if}
    <div class="dictionary-filters">
      <label class="st-search"><Icon name="search" size={14} /><input bind:value={dictionary.query} aria-label={t("Search dictionary")} placeholder={t("Search dictionary")} /></label>
      <select class="st-select" bind:value={dictionary.category} aria-label={t("Term category")}><option value="">{t("All categories")}</option>{#each dictionary.categories as category}<option value={category}>{category}</option>{/each}</select>
    </div>
    {#if dictionary.loading}<p class="st-hint" role="status">{t("Loading dictionary…")}</p>
    {:else if dictionary.snapshot}
      <p class="st-hint dictionary-count" role="status">{t("Terms found: {0}", [dictionary.entries.length])}</p>
      <div class="dictionary-list">
        {#each dictionary.entries as entry (`${entry.source}:${entry.id}`)}
          <article class="dictionary-entry">
            <div class="dictionary-heading"><h3>{entry.term}</h3><span class="st-hint">{entry.category}</span>{#if entry.source === "public" && dictionary.hasLocal(entry.id)}<span class="st-hint">{t("Locally overridden")}</span>{/if}</div>
            <p class="dictionary-definition">{entry.definition}</p>
            {#if entry.clarification}<p class="dictionary-clarification"><strong>{t("Common confusion")}</strong> {entry.clarification}</p>{/if}
            {#if entry.aliases.length}<p class="st-hint dictionary-aliases">{entry.aliases.join(" · ")}</p>{/if}
            {#if entry.sources.length}<div class="dictionary-links">{#each entry.sources as source}<a href={source} target="_blank" rel="noreferrer" title={source}>{new URL(source).hostname}</a>{/each}</div>{/if}
            <div class="dictionary-actions">
              <button class="st-btn st-btn--quiet st-btn--sm" type="button" disabled={dictionary.busy} onclick={() => dictionary.edit(entry)}>{entry.source === "public" ? t("Customize locally") : t("Edit")}</button>
              {#if entry.source === "local"}<button class="st-btn st-btn--danger st-btn--sm" type="button" disabled={dictionary.busy} onclick={() => dictionary.deleting = entry}>{t("Delete")}</button>{/if}
            </div>
            {#if dictionary.deleting?.id === entry.id && entry.source === "local"}
              <div class="dictionary-confirm" role="alert"><p>{t("Delete local meaning for “{0}”? Any public definition will become active again.", [entry.term])}</p><div class="dictionary-actions"><button class="st-btn st-btn--danger" type="button" disabled={dictionary.busy} onclick={() => dictionary.forget()}>{t("Delete local term")}</button><button class="st-btn st-btn--quiet" type="button" disabled={dictionary.busy} onclick={() => dictionary.deleting = null}>{t("Cancel")}</button></div></div>
            {/if}
          </article>
        {:else}<p class="st-hint">{dictionary.query || dictionary.category ? t("No matching terms. Clear the search or choose another category.") : dictionary.scope === "local" ? t("No local terms yet. Add a term or explain a new meaning to the agent.") : t("No public terms available. Try updating the dictionary.")}</p>{/each}
      </div>
    {/if}
  {/if}
</section>
