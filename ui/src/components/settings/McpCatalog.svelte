<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { extensions } from "../../lib/settings/extensions.svelte";
  import type { ExtensionPrompt } from "../../lib/settings/extension-types";
  import Icon from "../Icon.svelte";
  interface Props { id: string }
  let { id }: Props = $props();
  const catalog = $derived(extensions.mcp?.catalogs.find((entry) => entry.server === id));
  const tools = $derived(extensions.mcp?.tools.filter((tool) => tool.name.startsWith(`mcp_${id}_`)) ?? []);
  let prompt = $state<ExtensionPrompt | null>(null);
  let args = $state<Record<string, string>>({});
  let attached = $state(false);
  async function resource(uri: string): Promise<void> {
    await extensions.context(id, { uri });
    attached = !extensions.error;
  }
  async function invoke(): Promise<void> {
    if (!prompt) return;
    await extensions.context(id, { name: prompt.name, args });
    attached = !extensions.error;
    if (attached) prompt = null;
  }
</script>

<details class="st-details">
  <summary>{t("Tools and context")}<Icon name="chevron-down" size={14} class="st-chevron" /></summary>
  <div class="st-details-body catalog">
    {#each tools as tool (tool.name)}<p class="st-hint"><strong>{tool.name}</strong>: {tool.description}</p>{/each}
    {#each catalog?.resources ?? [] as resourceEntry (resourceEntry.uri)}
      <button class="st-btn st-btn--quiet catalog-item" type="button" title={resourceEntry.description ?? resourceEntry.uri} onclick={() => resource(resourceEntry.uri)}>{t("Attach resource: {0}", [resourceEntry.name])}</button>
    {/each}
    {#each catalog?.prompts ?? [] as entry (entry.name)}
      <button class="st-btn st-btn--quiet catalog-item" type="button" title={entry.description ?? entry.name} onclick={() => { prompt = entry; args = {}; attached = false; }}>{t("Prompt: {0}", [entry.name])}</button>
    {/each}
    {#if prompt}
      <form onsubmit={(event) => { event.preventDefault(); void invoke(); }}>
        {#each prompt.arguments ?? [] as argument (argument.name)}
          <label class="st-field"><span class="st-label">{argument.name}{argument.required ? " *" : ""}</span><input class="st-input" required={argument.required} value={args[argument.name] ?? ""} oninput={(event) => args[argument.name] = event.currentTarget.value} />{#if argument.description}<span class="st-hint">{argument.description}</span>{/if}</label>
        {/each}
        <button class="st-btn st-btn--quiet" type="submit">{t("Add to message")}</button>
      </form>
    {/if}
    {#if attached}<p class="st-hint" role="status">{t("Context added to the message draft. Close settings to review and send it.")}</p>{/if}
    {#if tools.length === 0 && !catalog?.resources.length && !catalog?.prompts.length}<p class="st-hint">{t("The catalog is empty.")}</p>{/if}
  </div>
</details>
<style>
  .catalog, form { display: flex; flex-direction: column; gap: 12px; }
  .catalog-item { justify-content: flex-start; white-space: normal; overflow-wrap: anywhere; text-align: left; }
  p { overflow-wrap: anywhere; }
</style>
