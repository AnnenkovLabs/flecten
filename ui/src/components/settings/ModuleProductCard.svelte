<script lang="ts">
  import type { MarketplaceEntry } from "../../../../shared/module-marketplace";
  import { t } from "../../lib/i18n.svelte";
  import type { ModulesSettingsStore } from "../../lib/settings/modules.svelte";
  import Icon from "../Icon.svelte";
  import ModuleProductPreview from "./ModuleProductPreview.svelte";
  let { entry, manager }: { entry: MarketplaceEntry; manager: ModulesSettingsStore } = $props();
</script>

<article class="market-entry">
  <button class="preview-button" type="button" onclick={() => manager.selected = entry} aria-label={t("View module: {0}", [entry.title])}>
    <ModuleProductPreview {entry} />
    {#if manager.installed(entry)}<span class="installed-badge"><Icon name="check" size={13} />{t("Installed")}</span>{/if}
    {#if entry.source === "bundled"}<span class="free-badge">{t("Free")}</span>{/if}
  </button>
  <div class="product-copy">
    <h4><button type="button" onclick={() => manager.selected = entry}>{entry.title}</button></h4>
    <p class="product-publisher">{entry.publisher}<span> · {entry.version}</span></p>
    <p class="product-description">{entry.description}</p>
  </div>
  {#if manager.installed(entry)}
    <button class="st-btn st-btn--quiet product-action" type="button" onclick={() => manager.tab = "installed"}>{t("Manage module")}</button>
  {:else}
    <button class="st-btn product-action" type="button" disabled={manager.locked} onclick={() => { manager.selected = entry; void manager.marketplace({ action: "install", source: entry.source, name: entry.name, revision: entry.revision }); }}>{manager.busy ? t("Installing…") : t("Install module")}</button>
  {/if}
</article>

<style>
  .market-entry { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
  .preview-button { position: relative; width: 100%; text-align: start; border-radius: 10px; }
  .installed-badge { display: inline-flex; align-items: center; gap: var(--space-1); position: absolute; inset-inline-start: var(--space-2); inset-block-start: var(--space-2); max-width: calc(100% - var(--space-4)); padding: var(--space-1) var(--space-2); background: var(--raised); color: var(--text); border-radius: 5px; font-size: 11px; }
  .free-badge { position: absolute; inset-inline-end: var(--space-2); inset-block-end: var(--space-2); padding: 3px 7px; border-radius: 5px; background: color-mix(in srgb, var(--add) 14%, var(--surface)); color: var(--add); font-size: 10px; font-weight: 500; line-height: 1.4; }
  .product-copy { display: grid; gap: var(--space-1); padding-inline: var(--space-1); }
  h4, p { margin: 0; overflow-wrap: anywhere; }
  h4 { color: var(--text); font-size: 16px; font-weight: 650; line-height: 1.4; }
  h4 button { text-align: start; border-radius: 3px; }
  .product-publisher { font-size: 12px; color: var(--text-2); }
  .product-publisher span { color: var(--muted); }
  .product-description { color: var(--muted); font-size: 12px; line-height: 1.5; text-wrap: pretty; margin-top: var(--space-1); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
  .product-action { margin-top: auto; width: 100%; min-height: 40px; background: var(--raised); color: var(--text); white-space: normal; padding-block: var(--space-2); }
  .product-action.st-btn--quiet { background: transparent; color: var(--text-2); }
  @media (hover: hover) { h4 button:hover { color: var(--primary); } .product-action:hover:not(:disabled) { background: var(--raised-hover); } }
</style>
