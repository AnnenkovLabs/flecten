<script lang="ts">
  import type { DictionaryStore } from "../../lib/dictionary.svelte";
  import { t } from "../../lib/i18n.svelte";
  let { dictionary }: { dictionary: DictionaryStore } = $props();
</script>

{#if dictionary.draft}
  <form class="dictionary-editor" onsubmit={(event) => { event.preventDefault(); void dictionary.save(); }}>
    <h3>{dictionary.draft.expectedRevision ? t("Edit local term") : t("Add local term")}</h3>
    <p class="st-hint">{t("This meaning is saved in project memory and takes precedence over the public dictionary.")}</p>
    <fieldset disabled={dictionary.busy}>
      <div class="dictionary-fields">
        <label class="st-field"><span class="st-label">{t("Term")}</span><input class="st-input" bind:value={dictionary.draft.term} required maxlength="160" /></label>
        <label class="st-field"><span class="st-label">{t("Category")}</span><select class="st-select" bind:value={dictionary.draft.category}>{#each dictionary.categories as category}<option value={category}>{category}</option>{/each}</select></label>
      </div>
      <label class="st-field"><span class="st-label">{t("Definition")}</span><textarea class="st-textarea dictionary-prose" bind:value={dictionary.draft.definition} required maxlength="4000" rows="4"></textarea></label>
      <label class="st-field"><span class="st-label">{t("Common confusion")}</span><textarea class="st-textarea dictionary-prose" bind:value={dictionary.draft.clarification} maxlength="2000" rows="2" placeholder={t("Explain which older or similar meaning to avoid.")}></textarea></label>
      <label class="st-field"><span class="st-label">{t("Other spellings, one per line")}</span><textarea class="st-textarea dictionary-prose" bind:value={dictionary.draft.aliases} rows="3" placeholder="vibecoding&#10;вайбкодинг"></textarea></label>
      <label class="st-field"><span class="st-label">{t("Sources, one HTTPS link per line")}</span><textarea class="st-textarea dictionary-prose" bind:value={dictionary.draft.sources} rows="2" placeholder="https://"></textarea></label>
    </fieldset>
    <div class="dictionary-actions">
      <button class="st-btn st-btn--primary" type="submit" disabled={dictionary.busy}>{dictionary.busy ? t("Saving…") : t("Save term")}</button>
      <button class="st-btn st-btn--quiet" type="button" disabled={dictionary.busy} onclick={() => { dictionary.draft = null; dictionary.error = ""; }}>{t("Cancel")}</button>
    </div>
  </form>
{/if}
