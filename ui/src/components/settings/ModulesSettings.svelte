<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "../../lib/i18n.svelte";
  import { settings } from "../../lib/settings.svelte";
  import { ModulesSettingsStore } from "../../lib/settings/modules.svelte";
  import InstalledModules from "./InstalledModules.svelte";
  import ModuleMarketplace from "./ModuleMarketplace.svelte";

  const manager = new ModulesSettingsStore();
  onMount(() => {
    void manager.load();
    const timer = setInterval(() => { void manager.refreshInstalled(); }, 2000);
    return () => clearInterval(timer);
  });
</script>

<section class="settings-section" aria-labelledby="settings-modules">
  <h2 id="settings-modules">{manager.tab === "marketplace" ? t("Module marketplace") : t("Modules")}</h2>
  {#if manager.tab === "installed"}<p class="st-hint">{t("The agent activates tools, instructions, hooks and workspace surfaces for the current task. Other modules stay out of context.")}</p>{/if}
  <nav class="module-navigation" aria-label={t("Modules")}>
    <button class="st-btn st-btn--quiet" class:current={manager.tab === "marketplace"} aria-pressed={manager.tab === "marketplace"} type="button" onclick={() => manager.tab = "marketplace"}>{t("Marketplace")}</button>
    <button class="st-btn st-btn--quiet" class:current={manager.tab === "installed"} aria-pressed={manager.tab === "installed"} type="button" onclick={() => manager.tab = "installed"}>{t("Installed")} <span class="module-count">{manager.snapshot.modules.length}</span></button>
  </nav>
  {#if settings.dirty}<p class="st-hint">{t("Save or discard settings changes before managing modules.")}</p>{/if}
  <p class="module-notice st-hint" role="status">{manager.notice}</p>
  {#if manager.error}<div class="st-error" role="alert"><p>{manager.error}</p><button class="st-btn st-btn--quiet" type="button" disabled={manager.busy} onclick={() => manager.load()}>{t("Retry")}</button></div>{/if}
  {#if manager.tab === "marketplace"}<ModuleMarketplace {manager} />{:else}<InstalledModules {manager} />{/if}
</section>
<style>
  .module-navigation { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .module-navigation .current { background: var(--raised); color: var(--text); box-shadow: inset 0 -2px var(--primary); }
  .module-count { font-variant-numeric: tabular-nums; color: var(--muted); }
  .module-notice:empty { display: none; }
</style>
