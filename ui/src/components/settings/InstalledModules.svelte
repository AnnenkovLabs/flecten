<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import type { ModulesSettingsStore } from "../../lib/settings/modules.svelte";
  let { manager }: { manager: ModulesSettingsStore } = $props();
</script>

  <div class="st-card module-install">
    <label class="st-field"><span class="st-label">{t("Module folder")}</span><input class="st-input" bind:value={manager.source} placeholder="/path/to/module" spellcheck="false" /></label>
    <button class="st-btn st-btn--quiet" type="button" disabled={manager.locked || !manager.source.trim()} onclick={() => manager.change({ operation: "install", path: manager.source })}>{t("Install from folder")}</button>
    <p class="st-hint">{t("Add a package containing .flecten-module/module.json, then review and trust its version.")}</p>
  </div>
  <div class="module-list">
    {#each manager.snapshot.modules as module (module.path)}
      <article class="module-row">
        <div class="module-heading"><h3>{module.name}</h3><span class="st-hint">{module.version}</span><span class="module-status">{module.enabled ? module.platformScope === "project" ? t("Project service") : t("On demand") : module.trusted ? t("Off") : t("Content review required")}</span></div>
        <p>{module.description}</p>
        {#if module.platformScope}<p class="st-hint">{t("Native module code runs with the permissions of the agent process.")} {module.platformScope === "project" ? t("Project services start when this module and project are trusted.") : t("Session services start when the agent activates this module.")}</p>{/if}
        <p class="st-hint">{module.capabilities.join(" · ")}</p>
        <div class="module-actions">
          {#if !module.trusted}<button class="st-btn st-btn--quiet" type="button" disabled={manager.locked} onclick={() => manager.change({ operation: "trust", path: module.path, revision: module.revision })}>{t("Trust this version")}</button>
          {:else}<button class="st-btn st-btn--quiet" type="button" disabled={manager.locked} onclick={() => manager.change({ operation: "enable", path: module.path, enabled: !module.enabled })}>{module.enabled ? t("Disable") : t("Enable")}</button>{/if}
          <button class="st-btn st-btn--quiet" type="button" disabled={manager.locked} onclick={() => manager.change({ operation: "remove", path: module.path })}>{t("Remove")}</button>
          {#if module.enabled && (module.contributions.styles || module.contributions.surfaces)}<button class="st-btn st-btn--quiet" type="button" disabled={manager.locked} onclick={() => manager.change({ operation: "interface", path: module.path, enabled: !module.interfaceEnabled })}>{module.interfaceEnabled ? t("Stop using module interface") : t("Use module interface")}</button>{/if}
        </div>
        <details class="st-details"><summary>{t("Contents and location")}</summary><div class="st-details-body">
          <p class="st-mono">{module.path}</p><p class="st-mono">SHA-256: {module.revision}</p>
          <dl>{#each Object.entries(module.contributions) as [name, count]}<div><dt>{name}</dt><dd>{count}</dd></div>{/each}</dl>
          {#each (manager.snapshot.services ?? []).filter((service) => service.owner === module.name) as service}<p class="st-mono">{service.mode}: {service.service}</p>{/each}
          {#if module.trusted}<label class="module-development"><input type="checkbox" checked={module.development} disabled={manager.locked} onchange={(event) => manager.change({ operation: "development", path: module.path, enabled: event.currentTarget.checked })} /><span>{t("Reload local changes automatically")}</span></label>{/if}
          <p class="st-hint">{t("Development reload trusts future edits in this folder. Active chats apply them between agent turns.")}</p>
          <p class="st-hint">{t("Interface changes can replace the entire app. Ctrl+Shift+F12 restores the native interface.")}</p>
        </div></details>
      </article>
    {:else}<p class="st-hint">{t("No modules installed. Add a module folder to get started.")}</p>{/each}
  </div>
  {#each manager.snapshot.errors as item}<p class="st-error">{item.path}: {item.message}</p>{/each}
<style>
  .module-install { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: end; padding: 16px; }
  .module-install p { grid-column: 1 / -1; margin: 0; }
  .module-list { display: grid; gap: 0; }
  .module-row { padding: 22px 0; border-bottom: 1px solid var(--line); display: grid; gap: 10px; min-width: 0; }
  .module-row h3, .module-row p { margin: 0; overflow-wrap: anywhere; }
  .module-heading { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .module-heading h3 { font-size: 15px; }
  .module-status { margin-left: auto; font-size: 12px; color: var(--muted); }
  .module-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .module-row .st-details { margin: 0; }
  .st-mono { overflow-wrap: anywhere; }
  dl { display: flex; flex-wrap: wrap; gap: 16px; margin: 8px 0; font-size: 12px; }
  dl div { display: flex; gap: 8px; } dd { margin: 0; font-variant-numeric: tabular-nums; }
  .module-development { display: flex; gap: 8px; align-items: center; min-height: var(--control-h); }
  @media (max-width: 700px) { .module-install { grid-template-columns: minmax(0, 1fr); } .module-install button { justify-self: start; } }
</style>
