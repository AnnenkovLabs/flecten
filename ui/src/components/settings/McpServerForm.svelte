<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import type { McpServerSettings } from "../../lib/types";
  import { linesToArray } from "../../lib/settings-utils";
  import { numberIssue } from "../../lib/settings/validation";
  import Icon from "../Icon.svelte";
  interface Props { id: string; server: McpServerSettings; ontransport: (http: boolean) => void }
  let { id, server, ontransport }: Props = $props();
</script>

<div class="st-grid">
  <label class="st-field"><span class="st-label">{t("Connection")}</span><select class="st-select" value={"url" in server ? "http" : "stdio"} onchange={(event) => ontransport(event.currentTarget.value === "http")}><option value="stdio">{t("Command (stdio)")}</option><option value="http">Streamable HTTP</option></select></label>
  <label class="st-field"><span class="st-label">{t("Timeout, ms")}</span><input class="st-input" type="number" min="1000" max="300000" bind:value={server.timeoutMs} />{#if numberIssue(server.timeoutMs, 1000, 300_000)}<span class="st-error" role="alert">{numberIssue(server.timeoutMs, 1000, 300_000)}</span>{/if}</label>
  {#if "url" in server}
    <label class="st-field span-2"><span class="st-label">{t("MCP URL")}</span><input class="st-input" type="url" bind:value={server.url} placeholder="https://example.com/mcp" spellcheck="false" />{#if !server.url.trim()}<span class="st-error" role="alert">{t("Enter the server URL.")}</span>{/if}</label>
    <label class="st-switch span-2"><span class="st-switch-copy"><strong>OAuth</strong><span>{t("Sign in through your browser. Tokens are stored securely.")}</span></span><input type="checkbox" checked={Boolean(server.oauth)} onchange={(event) => { if (!("url" in server)) return; if (event.currentTarget.checked) server.oauth = { scopes: [] }; else delete server.oauth; }} /><span class="st-switch-track" aria-hidden="true"></span></label>
    {#if server.oauth}
      <label class="st-field"><span class="st-label">{t("Client ID, optional")}</span><input class="st-input" value={server.oauth.clientId ?? ""} oninput={(event) => { if ("url" in server && server.oauth) { if (event.currentTarget.value) server.oauth.clientId = event.currentTarget.value; else delete server.oauth.clientId; } }} /></label>
      <label class="st-field"><span class="st-label">{t("Scopes, one per line")}</span><textarea class="st-textarea" rows="2" value={server.oauth.scopes.join("\n")} oninput={(event) => { if ("url" in server && server.oauth) server.oauth.scopes = linesToArray(event.currentTarget.value); }}></textarea></label>
    {/if}
    {#if Object.keys(server.headers).length > 0}<p class="st-hint span-2">{t("Saved headers: {0}. Values are hidden.", [Object.keys(server.headers).length])}</p>{/if}
  {:else}
    <label class="st-field"><span class="st-label">{t("Command")}</span><input class="st-input" bind:value={server.command} spellcheck="false" />{#if !server.command.trim()}<span class="st-error" role="alert">{t("Enter the startup command.")}</span>{/if}</label>
    <label class="st-field"><span class="st-label">{t("Protocol")}</span><select class="st-select" bind:value={server.protocol}><option value="auto">{t("Auto")}</option><option value="legacy">{t("Legacy")}</option><option value="2026-07-28">2026-07-28</option></select></label>
    <label class="st-field span-2"><span class="st-label">{t("Arguments, one per line")}</span><textarea class="st-textarea" rows="3" value={server.args.join("\n")} oninput={(event) => { if ("command" in server) server.args = linesToArray(event.currentTarget.value); }} spellcheck="false"></textarea></label>
    <label class="st-field span-2"><span class="st-label">{t("Working directory")}</span><input class="st-input" bind:value={server.cwd} spellcheck="false" /></label>
    {#if Object.keys(server.env).length > 0}<p class="st-hint span-2">{t("Environment variables: {0}. Values are hidden.", [Object.keys(server.env).length])}</p>{/if}
  {/if}
  <label class="st-field"><span class="st-label">{t("Tool limit")}</span><input class="st-input" type="number" min="1" max="128" bind:value={server.maxTools} /></label>
  <label class="st-field"><span class="st-label">{t("Context budget in tokens")}</span><input class="st-input" type="number" min="64" max="100000" bind:value={server.contextTokens} placeholder="8000" /></label>
  <label class="st-switch span-2"><span class="st-switch-copy"><strong>{t("Read-only")}</strong><span>{t("Tools that write data are not available to this server.")}</span></span><input type="checkbox" checked={server.readOnly ?? false} onchange={(event) => { if (event.currentTarget.checked) server.readOnly = true; else delete server.readOnly; }} /><span class="st-switch-track" aria-hidden="true"></span></label>
  <label class="st-field span-2"><span class="st-label">{t("Allowed tools, one per line")}</span><textarea class="st-textarea" rows="3" value={server.allowTools?.join("\n") ?? ""} oninput={(event) => { const names = linesToArray(event.currentTarget.value); if (names.length) server.allowTools = names; else delete server.allowTools; }} placeholder={t("Leave blank to allow all server tools")} spellcheck="false"></textarea></label>
</div>
<details class="st-details"><summary>{t("Secrets and connection")}<Icon name="chevron-down" size={14} class="st-chevron" /></summary><p class="st-hint">{t("Server “{0}” will receive these settings after you save. Reconnecting uses the saved configuration.", [id])}</p></details>
