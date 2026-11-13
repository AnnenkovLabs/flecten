<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { onMount } from "svelte";
  import { settings } from "../../lib/settings.svelte";
  import { extensions } from "../../lib/settings/extensions.svelte";
  import type { McpServerSettings } from "../../lib/types";
  import Icon from "../Icon.svelte";
  import McpServerForm from "./McpServerForm.svelte";
  import McpCatalog from "./McpCatalog.svelte";
  const config = $derived(settings.settings);
  let pendingRemove = $state("");
  const stateLabels = $derived({ connecting: t("Connection"), ready: t("Connected"), degraded: t("Unstable"), closed: t("Disabled"), failed: t("Error") });
  onMount(() => { void extensions.refresh(); });
  function add(): void {
    if (!config) return;
    const servers = (config.mcp ??= { servers: {} }).servers;
    let index = 1;
    while (servers[`server-${index}`]) index += 1;
    servers[`server-${index}`] = { command: "", args: [], env: {}, enabled: false, protocol: "auto", timeoutMs: 30_000, maxTools: 50 };
  }
  function transport(id: string, server: McpServerSettings, http: boolean): void {
    if (!config?.mcp) return;
    const shared = { enabled: server.enabled, timeoutMs: server.timeoutMs, maxTools: server.maxTools, ...(server.readOnly === undefined ? {} : { readOnly: server.readOnly }), ...(server.allowTools ? { allowTools: server.allowTools } : {}) };
    config.mcp.servers[id] = http ? { ...shared, url: "", headers: {} } : { ...shared, command: "", args: [], env: {}, protocol: "auto" };
  }
</script>

<section class="settings-section" aria-labelledby="settings-mcp">
  <h2 id="settings-mcp">MCP</h2>
  {#if extensions.error}<p class="st-error" role="alert">{extensions.error}</p>{/if}
  <div class="server-list">
    {#each Object.entries(config?.mcp?.servers ?? {}) as [id, server] (id)}
      {@const status = extensions.mcp?.servers.find((entry) => entry.id === id)}
      <article class="server-card">
        <header class="server-head">
          <span class="server-id st-mono">{id}</span>
          <span class="st-hint" role="status">{status ? stateLabels[status.state] : t("Not connected")}</span>
          <label class="st-switch"><span class="st-switch-copy"><strong>{t("On")}</strong></span><input type="checkbox" aria-label={t("Enable MCP server {0}", [id])} bind:checked={server.enabled} /><span class="st-switch-track" aria-hidden="true"></span></label>
          <button class="st-icon-btn" type="button" aria-label={t("Remove {0}", [id])} onclick={() => pendingRemove = id}><Icon name="trash" size={14} /></button>
        </header>
        {#if pendingRemove === id}<div class="st-confirm"><span>{t("Delete MCP server “{0}”?", [id])}</span><div class="st-confirm-actions"><button class="st-btn st-btn--quiet" type="button" onclick={() => pendingRemove = ""}>{t("Cancel")}</button><button class="st-btn st-btn--danger" type="button" onclick={() => { if (config?.mcp) delete config.mcp.servers[id]; pendingRemove = ""; }}>{t("Delete")}</button></div></div>{/if}
        <McpServerForm {id} {server} ontransport={(http) => transport(id, server, http)} />
        <div class="server-actions">
          <button class="st-btn st-btn--quiet" type="button" disabled={extensions.busy || settings.dirty} onclick={() => extensions.reconnect(id)}><Icon name="refresh" size={14} />{t("Reconnect")}</button>
          {#if status?.oauth}<button class="st-btn st-btn--quiet" type="button" disabled={settings.dirty} onclick={() => extensions.consent = id}><Icon name="key" size={14} />{t("Authorization")}</button>{/if}
          {#if settings.dirty}<span class="st-hint">{t("Save settings first.")}</span>{/if}
        </div>
        {#if status?.error || status?.lastError}<p class="st-error" role="alert">{status.error || status.lastError}</p>{/if}
        {#if status}<p class="st-hint">{t("Tools: {0} of {1}. Resources: {2}. Prompts: {3}.", [status.tools, status.available ?? status.tools, status.resources ?? 0, status.prompts ?? 0])}</p>{/if}
        <McpCatalog {id} />
        <details class="st-details"><summary>{t("Server log")}<Icon name="chevron-down" size={14} class="st-chevron" /></summary><div class="st-details-body"><pre class="server-log">{extensions.mcp?.logs.filter((line) => line.server === id).map((line) => line.message).join("\n") || t("No entries.")}</pre></div></details>
      </article>
    {/each}
  </div>
  <button class="st-btn st-btn--quiet" type="button" onclick={add}><Icon name="plus" size={14} />{t("Add server")}</button>
</section>
<style>
  .server-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .server-log { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; max-height: 240px; overflow: auto; }
</style>
