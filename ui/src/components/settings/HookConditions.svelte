<script lang="ts">
  import { onMount } from "svelte";
  import { HOOK_EVENTS } from "../../../../shared/hooks";
  import { t } from "../../lib/i18n.svelte";
  import { normalizedMatcher, setHookMatcher } from "../../lib/settings/hooks";
  import type { HookEvent, HookMatcherField } from "../../lib/settings/hooks";
  import type { HookCommandSettings } from "../../lib/types";
  import Icon from "../Icon.svelte";

  let { hook, event }: { hook: HookCommandSettings; event: HookEvent } = $props();
  let expanded = $state(false);
  onMount(() => { expanded = count > 0; });
  const matcher = $derived(normalizedMatcher(hook.matcher));
  const count = $derived(Object.values(matcher).filter(Boolean).length);
  const fields: Array<{ id: HookMatcherField; label: string; placeholder: string }> = $derived([
    { id: "tool", label: t("Tool name"), placeholder: "read" },
    { id: "path", label: t("Exact path"), placeholder: "src/app.ts" },
    { id: "pathPrefix", label: t("Path prefix"), placeholder: "src/" },
    { id: "command", label: t("Exact command"), placeholder: "bun test" },
    { id: "commandPrefix", label: t("Command prefix"), placeholder: "git push" },
  ]);
</script>

{#if HOOK_EVENTS[event].fields.length > 0 || count > 0}
  <details class="st-details" bind:open={expanded}>
    <summary><span>{t("Conditions")} <span class="st-hint">{count ? t("{0} conditions", [count]) : t("Every occurrence")}</span></span><Icon name="chevron-down" size={14} class="st-chevron" /></summary>
    <div class="st-details-body">
      <p class="st-hint">{t("Only run when every filled condition matches. Paths are relative to the project folder; an empty field matches everything.")}</p>
      <div class="st-grid">
        {#each fields.filter((field) => HOOK_EVENTS[event].fields.some((name) => name === field.id || (name === "path" && field.id === "pathPrefix") || (name === "command" && field.id === "commandPrefix")) || matcher[field.id]) as field (field.id)}
          <label class="st-field"><span class="st-label">{field.label}</span><input class="st-input" value={matcher[field.id] ?? ""} placeholder={field.placeholder} spellcheck="false" oninput={(e) => setHookMatcher(hook, field.id, e.currentTarget.value)} /></label>
        {/each}
      </div>
    </div>
  </details>
{/if}

<style>
  summary > span { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
  @media (max-width: 650px) { .st-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
