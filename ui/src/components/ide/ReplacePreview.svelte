<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { modal } from "../../lib/modal";
  import type { IdeSearch } from "../../lib/ide/search.svelte";
  let { search, onApply }: { search: IdeSearch; onApply: () => Promise<void> } = $props();
  let cancel: HTMLButtonElement;
  const count = $derived(search.plan?.files.reduce((total, file) => total + file.count, 0) ?? 0);
</script>
<dialog use:modal={() => cancel} aria-label="{t("Replacement preview")}" oncancel={(event) => { event.preventDefault(); if (!search.busy) search.plan = null; }}>
  <h2>{t("Replace in project")}</h2><p><code>{search.plan?.query}</code> → <code>{search.plan?.replacement || t("(delete)")}</code></p><p>{t("Matches: {0}. Files: {1}.", [count, search.plan?.files.length ?? 0])}</p>
  <ul>{#each search.plan?.files ?? [] as file (file.path)}<li><span>{file.path}</span><small>{file.count}</small></li>{/each}</ul>
  {#if search.error}<p class="error" role="alert">{search.error}</p>{/if}
  <footer><button bind:this={cancel} type="button" disabled={search.busy} onclick={() => search.plan = null}>{t("Cancel")}</button><button type="button" class="apply" disabled={search.busy || !count} onclick={() => void onApply()}>{search.busy ? t("Replacing…") : t("Replace {0} matches", [count])}</button></footer>
</dialog>
<style>
  dialog { width: min(560px, calc(100vw - 32px)); padding: 24px; background: var(--raised); color: var(--text); border: 1px solid var(--line-strong); border-radius: 8px; } dialog::backdrop { background: #0007; } h2 { font-size: 18px; margin: 0 0 12px; } p { font-size: 13px; color: var(--text-2); overflow-wrap: anywhere; } code { font-family: var(--mono); } ul { padding: 0; list-style: none; max-height: 240px; overflow: auto; font-size: 12px; } li { display: flex; gap: 12px; justify-content: space-between; min-height: 28px; } li span { overflow-wrap: anywhere; } small { color: var(--muted); } .error { color: var(--error); } footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; } button { min-height: 32px; padding-inline: 12px; background: var(--surface); border-radius: 4px; font-size: 13px; } .apply { background: var(--primary); color: var(--on-primary); } button:disabled { opacity: .45; }
</style>
