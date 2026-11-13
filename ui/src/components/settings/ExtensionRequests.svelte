<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { onMount } from "svelte";
  import { openExternal } from "../../lib/desktop";
  import { extensions, watchExtensions } from "../../lib/settings/extensions.svelte";
  import { elicitationFields, elicitationContent, type ElicitationField } from "../../lib/settings/elicitation";
  import type { ElicitationValue } from "../../lib/settings/extension-types";
  import Dialog from "../Dialog.svelte";
  import Icon from "../Icon.svelte";

  let values = $state<Record<string, ElicitationValue>>({});
  let currentId = "";
  let issue = $state("");
  let submitting = $state(false);
  const request = $derived(extensions.mcp?.elicitation[0]);
  const consent = $derived(extensions.mcp?.servers.find((server) => server.id === extensions.consent)?.oauth);
  const fields = $derived(request ? elicitationFields(request) : []);
  const open = $derived(Boolean(request || consent));
  onMount(watchExtensions);

  $effect(() => {
    if (request?.id === currentId) return;
    currentId = request?.id ?? "";
    values = {};
    issue = "";
  });
  async function answer(action: "accept" | "decline" | "cancel"): Promise<void> {
    if (!request) return;
    const result = action === "accept" ? elicitationContent(fields, values) : { content: {} };
    if ("error" in result) { issue = result.error; return; }
    submitting = true;
    await extensions.answer(request.id, action, action === "accept" ? result.content : undefined);
    submitting = false;
  }
  function cancel(): void {
    if (request) void answer("cancel");
    else extensions.consent = null;
  }
  function update(field: ElicitationField, raw: string): void {
    values[field.name] = field.type === "number" || field.type === "integer" ? Number(raw) : raw;
  }
</script>

{#if open}
<Dialog title={request ? t("Request from server {0}", [request.server]) : t("Authorization for {0}", [consent?.server ?? "MCP"])} onDismiss={cancel}>
  {#if request}
    <p>{request.message}</p>
    {#if request.mode === "url" && request.url}
      <p class="st-hint">{t("The server is asking to open a page. Check the address before opening it.")}</p>
      <p class="st-mono wrap">{request.url}</p>
      <button class="st-btn st-btn--quiet" type="button" onclick={() => request?.url && void openExternal(request.url).catch((error) => issue = String(error))}>{t("Open page")}</button>
    {:else}
      {#each fields as field (field.name)}
        <label class="st-field">
          <span class="st-label">{field.label}{field.required ? " *" : ""}</span>
          {#if field.type === "boolean"}
            <input type="checkbox" checked={values[field.name] === true} onchange={(event) => values[field.name] = event.currentTarget.checked} />
          {:else if field.options}
            <select class="st-select" value={String(values[field.name] ?? "")} onchange={(event) => update(field, event.currentTarget.value)}><option value="">{t("Select")}</option>{#each field.options as option (option)}<option value={option}>{option}</option>{/each}</select>
          {:else}
            <input class="st-input" type={field.type === "string" ? "text" : "number"} value={String(values[field.name] ?? "")} min={field.minimum} max={field.maximum} step={field.type === "integer" ? "1" : "any"} oninput={(event) => update(field, event.currentTarget.value)} />
          {/if}
          {#if field.description}<span class="st-hint">{field.description}</span>{/if}
        </label>
      {/each}
    {/if}
  {:else if consent}
    <p>{t("Allow MCP server authorization in the browser?")}</p>
    <p class="st-mono wrap">{consent.url}</p>
    <p class="st-hint">{t("Requested permissions: {0}. Tokens will be saved in secure storage.", [consent.scopes.join(", ") || t("determined by the server at sign-in")])}</p>
  {/if}
  {#if issue || extensions.error}<p class="st-error" role="alert">{issue || extensions.error}</p>{/if}
  {#snippet actions()}
    <button type="button" class="st-btn st-btn--quiet" disabled={submitting} onclick={cancel}>{t("Cancel")}</button>
    {#if request}<button type="button" class="st-btn st-btn--quiet" disabled={submitting} onclick={() => answer("decline")}>{t("Deny")}</button>{/if}
    <button type="button" class="st-btn st-btn--primary" disabled={submitting || fields.some((field) => field.type === "unsupported")} onclick={() => request ? answer("accept") : consent && extensions.authorize(consent.server)}><Icon name="check" size={14} />{request ? t("Send") : t("Allow and open")}</button>
  {/snippet}
</Dialog>
{/if}

<style>
  p { font-size: 14px; line-height: 1.5; }
  .wrap { overflow-wrap: anywhere; }
</style>
