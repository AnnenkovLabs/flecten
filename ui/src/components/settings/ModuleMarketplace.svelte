<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import type { ModulesSettingsStore } from "../../lib/settings/modules.svelte";
  import Icon from "../Icon.svelte";
  import ModuleProductCard from "./ModuleProductCard.svelte";
  let { manager }: { manager: ModulesSettingsStore } = $props();
  const categories = $derived([
    { id: "all", label: t("All modules") },
    { id: "workflow", label: t("Workflows") },
    { id: "interface", label: t("Interfaces") },
    { id: "platform", label: t("Platform") },
  ]);
</script>

<div class="marketplace" aria-busy={manager.busy}>
  {#if manager.selected}
    {@const entry = manager.selected}
    <button class="st-btn st-btn--quiet back" type="button" onclick={() => manager.selected = null}><Icon name="chevron-right" size={14} class="back-icon" />{t("Back to marketplace")}</button>
    <article class="module-detail">
      <div class="detail-title"><span class="module-glyph"><Icon name={entry.category === "workflow" ? "tasks" : entry.category === "interface" ? "panel-left" : "layers"} size={26} /></span><div><h3>{entry.title}</h3><p class="st-hint">{entry.publisher} · {entry.version}</p></div></div>
      <p>{entry.description}</p>
      <dl class="module-facts">
        <div><dt>{t("Module")}</dt><dd>{entry.name}</dd></div>
        <div><dt>{t("Catalog")}</dt><dd>{manager.catalog.sources.find((source) => source.id === entry.source)?.name ?? entry.source}</dd></div>
        {#if entry.requires.length}<div><dt>{t("Dependencies")}</dt><dd>{entry.requires.join(", ")}</dd></div>{/if}
      </dl>
      {#if entry.capabilities.length}<p class="st-hint">{entry.capabilities.join(" · ")}</p>{/if}
      <div class="review-note">
        <p>{t("Installing copies the package into this project. Review and trust its contents before enabling it.")}</p>
        {#if entry.native}<p class="st-hint">{t("Native module code runs with the permissions of the agent process.")}</p>{/if}
        {#if entry.platformScope === "project"}<p class="st-hint">{t("Project services start when this module and project are trusted.")}</p>{/if}
        {#if entry.interface}<p class="st-hint">{t("Interface changes can replace the entire app. Ctrl+Shift+F12 restores the native interface.")}</p>{/if}
        {#if entry.requires.length}<p class="st-hint">{t("Missing dependencies from this catalog are installed together. Trust each module separately.")}</p>{/if}
      </div>
      <p class="package-hash">SHA-256: {entry.revision}</p>
      <div class="detail-actions">
        {#if manager.installed(entry)}
          <span class="installed-label"><Icon name="check" size={15} />{t("Installed")}</span>
          <button class="st-btn st-btn--quiet" type="button" onclick={() => manager.tab = "installed"}>{t("Manage installed modules")}</button>
        {:else}
          <button class="st-btn st-btn--primary" type="button" disabled={manager.locked} onclick={() => manager.marketplace({ action: "install", source: entry.source, name: entry.name, revision: entry.revision })}>{manager.busy ? t("Installing…") : t("Install module")}</button>
        {/if}
      </div>
    </article>
  {:else}
    <div class="market-filters">
      <label class="st-search"><Icon name="search" size={16} /><input type="search" bind:value={manager.query} aria-label={t("Search modules")} placeholder={t("Search modules")} /></label>
      <div class="category-field"><label class="sr-only" for="module-category">{t("Module category")}</label><select id="module-category" class="st-input" bind:value={manager.category}>{#each categories as category}<option value={category.id}>{category.label}</option>{/each}</select></div>
      <button class="st-icon-btn market-refresh" type="button" aria-label={t("Refresh marketplace")} title={t("Refresh marketplace")} disabled={manager.busy} onclick={() => manager.marketplace({ action: "list", refresh: true })}><Icon name="refresh" size={17} /></button>
    </div>
    <p class="sr-only" role="status">{manager.loading ? t("Loading marketplace…") : t("Modules found: {0}", [manager.filtered.length])}</p>
    <div class="market-list">
      {#each manager.filtered as entry (`${entry.source}:${entry.name}`)}
        <ModuleProductCard {entry} {manager} />
      {:else}
        {#if !manager.loading}<div class="st-empty"><p>{t("No matching modules. Clear the search or choose another category.")}</p><button class="st-btn st-btn--quiet" type="button" onclick={() => { manager.query = ""; manager.category = "all"; }}>{t("Clear filters")}</button></div>{/if}
      {/each}
    </div>
    <details class="st-details catalog-sources"><summary>{t("Catalog sources")}<Icon name="chevron-down" size={14} /></summary><div class="st-details-body">
      <p class="st-hint">{t("The built-in catalog works offline. Add an HTTPS catalog to discover community modules.")}</p>
      {#each manager.catalog.sources as source (source.id)}<div class="catalog-source"><div><strong>{source.name}</strong><p class="st-hint">{source.bundled ? t("Included with Flecten") : source.id}</p></div>{#if !source.bundled}<button class="st-btn st-btn--quiet" type="button" disabled={manager.locked} onclick={() => manager.marketplace({ action: "removeSource", url: source.id })} aria-label={t("Disconnect catalog: {0}", [source.name])}>{t("Disconnect")}</button>{/if}</div>{/each}
      <form class="catalog-add" onsubmit={(event) => { event.preventDefault(); void manager.marketplace({ action: "addSource", url: manager.catalogUrl.trim() }); }}>
        <label class="st-field"><span class="st-label">{t("Catalog URL")}</span><input class="st-input" type="url" required bind:value={manager.catalogUrl} placeholder="https://example.org/modules.json" /></label>
        <button class="st-btn st-btn--quiet" type="submit" disabled={manager.locked}>{t("Add catalog")}</button>
      </form>
    </div></details>
  {/if}
  {#each manager.catalog.errors as error}<div class="st-error" role="alert"><p>{error.source}: {error.message}</p><button class="st-btn st-btn--quiet" type="button" disabled={manager.busy} onclick={() => manager.marketplace({ action: "list", refresh: true })}>{t("Retry")}</button></div>{/each}
</div>

<style>
  .marketplace { display: grid; gap: var(--space-4); min-width: 0; }
  .detail-title { display: flex; align-items: center; gap: var(--space-4); }
  h3, p { margin: 0; text-wrap: pretty; }
  h3 { font-size: 18px; font-weight: 600; text-wrap: balance; }
  .market-refresh { min-width: 40px; min-height: 40px; }
  .market-filters { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: var(--space-3); align-items: center; }
  .category-field { min-width: 0; }
  .market-filters input, select { min-height: 40px; }
  .market-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 190px), 1fr)); gap: var(--space-8) var(--space-4); }
  .module-glyph { display: grid; place-items: center; flex: 0 0 44px; min-height: 44px; border-radius: 8px; background: var(--raised); color: var(--text-2); }
  .installed-label { display: inline-flex; align-items: center; gap: var(--space-1); }
  .module-detail { display: grid; gap: var(--space-6); min-width: 0; }
  .module-detail > p { max-width: 65ch; color: var(--text-2); }
  .back { justify-self: start; min-height: 40px; }
  :global(.back-icon) { transform: rotate(180deg); }
  .module-facts { display: grid; gap: var(--space-3); margin: 0; font-size: 13px; }
  .module-facts > div { display: grid; grid-template-columns: minmax(100px, 1fr) minmax(0, 3fr); gap: var(--space-4); }
  dt { color: var(--muted); } dd { margin: 0; }
  .review-note { display: grid; gap: var(--space-3); padding: var(--space-4); border-radius: 10px; background: var(--surface); font-size: 13px; }
  .package-hash { font-size: 12px; font-variant-numeric: tabular-nums; }
  .detail-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); }
  .detail-actions button, .catalog-add button, .catalog-source button { min-height: 40px; }
  .catalog-sources { margin-top: var(--space-4); }
  .catalog-source { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); font-size: 13px; }
  .catalog-source > div { flex: 1; min-width: 0; }
  .catalog-add { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); align-items: end; }
  p, dd { overflow-wrap: anywhere; }
  @media (max-width: 700px) { .market-filters, .catalog-add { grid-template-columns: minmax(0, 1fr); } .module-facts > div { grid-template-columns: minmax(0, 1fr); gap: var(--space-1); } }
</style>
