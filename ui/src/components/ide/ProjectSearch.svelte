<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import type { IdeSearch, SearchMatch } from "../../lib/ide/search.svelte";
  import ReplacePreview from "./ReplacePreview.svelte";
  import Icon from "../Icon.svelte";
  let { search, onOpen, onReplace }: { search: IdeSearch; onOpen: (match: SearchMatch) => void; onReplace: () => Promise<void> } = $props();
  const groups = $derived.by(() => {
    const map = new Map<string, SearchMatch[]>();
    for (const match of search.result?.matches ?? []) { const list = map.get(match.path) ?? []; list.push(match); map.set(match.path, list); }
    return [...map];
  });
</script>
<aside class="project-search" aria-label={t("Search project")}>
  <header><strong>{t("Search")}</strong><button type="button" title={t("Search again")} aria-label={t("Search again")} onclick={() => void search.find()}><Icon name="refresh" size={15} /></button></header>
  <form onsubmit={(event) => { event.preventDefault(); void search.find(); }}>
    <label for="project-query">{t("Find in files")}</label>
    <div class="search-input"><input id="project-query" placeholder={t("Search text")} bind:value={search.query} /><button type="button" aria-pressed={search.caseSensitive} title={t("Match case")} onclick={() => search.caseSensitive = !search.caseSensitive}>Aa</button><button type="button" aria-pressed={search.wholeWord} title={t("Whole word")} onclick={() => search.wholeWord = !search.wholeWord}>ab</button></div>
    <label for="project-include">{t("Partial path")} <span>{t("optional")}</span></label>
    <input id="project-include" placeholder={t("src/ or .svelte")} bind:value={search.include} />
    <button class="search-submit" type="submit" disabled={search.busy}><Icon name="search" size={14} />{search.busy ? t("Searching…") : t("Find")}<kbd>Enter</kbd></button>
  </form>
  <details class="replace-options"><summary>{t("Replace in project")}</summary><label for="project-replacement">{t("Replace with")}</label><input id="project-replacement" bind:value={search.replacement} placeholder="{t("New text")}" /><button type="button" disabled={search.busy || !search.query} onclick={() => void search.previewReplace()}>{t("Replacement preview")}</button></details>
  <div class="search-summary" role="status">{#if search.result}{t("Matches: {0}. Files: {1}", [search.result.matches.length, groups.length])}{:else}{t("Search text in project files")}{/if}</div>
  <div class="search-results">
    {#if search.error}<p role="alert">{search.error}</p>{/if}
    {#if search.result?.limited}<p>{t("Only some results are shown. Refine the search text or partial path.")}</p>{/if}
    {#each groups as [path, matches] (path)}
      <details open><summary title={path}><Icon name="file" size={14} /><span>{path}</span><small>{matches.length}</small></summary>
        {#each matches as match, index (index)}<button type="button" title={`${path}:${match.line}:${match.column}\n${match.text}`} onclick={() => onOpen(match)}><span class="line-number">{match.line}</span><span class="match-text">{match.text}</span></button>{/each}
      </details>
    {/each}
    {#if search.result && !search.result.matches.length}<p>{t("No matches. Change the search text or remove the path filter.")}</p>{/if}
  </div>
</aside>
{#if search.plan}<ReplacePreview {search} onApply={onReplace} />{/if}
<style>
  .replace-options { padding: 0 12px 12px; } .replace-options summary { padding: 4px 0; } .replace-options label { display: block; margin-block: 6px; } .replace-options > button { min-height: 30px; padding-inline: 8px; margin-top: 8px; border-radius: 4px; background: var(--raised); color: var(--text-2); font-size: 12px; }
  .project-search { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--sidebar); font-size: 13px; }
  header { display: flex; align-items: center; justify-content: space-between; height: 40px; padding-inline: 16px 8px; flex: none; } header strong { font-weight: 600; } header button { width: 28px; height: 28px; }
  form { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px 12px; } label { color: var(--text-2); font-size: 12px; } label span { color: var(--muted); } input { min-width: 0; width: 100%; background: var(--bg); border: 1px solid var(--line-strong); border-radius: 4px; padding: 6px 8px; height: 32px; font-size: 13px; }
  .search-input { display: flex; align-items: center; border: 1px solid var(--line-strong); border-radius: 4px; background: var(--bg); } .search-input input { border: 0; flex: 1; width: 0; } .search-input button { flex: none; width: 28px; height: 28px; font-size: 12px; color: var(--muted); } .search-input button[aria-pressed="true"] { background: var(--raised-hover); color: var(--text); box-shadow: inset 0 -2px var(--primary); }
  .search-submit { display: flex; align-items: center; gap: 8px; min-height: 30px; margin-top: 4px; padding-inline: 8px; background: var(--raised); border-radius: 4px; color: var(--text-2); } kbd { margin-inline-start: auto; color: var(--muted); font-size: 11px; } .search-summary { padding: 4px 12px 12px; font-size: 12px; color: var(--muted); }
  .search-results { overflow: auto; min-height: 0; flex: 1; } summary { display: flex; align-items: center; gap: 6px; min-height: 30px; padding-inline: 12px; cursor: pointer; color: var(--text-2); } summary span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } small { font-size: 11px; color: var(--muted); }
  .search-results button { display: flex; width: 100%; min-height: 28px; gap: 10px; padding: 4px 12px 4px 24px; font-family: var(--mono); font-size: 12px; text-align: start; color: var(--text-2); } .search-results button:hover, summary:hover { background: var(--surface); } .line-number { color: var(--muted); flex: none; } .match-text { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; } p { padding: 8px 12px; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
</style>
