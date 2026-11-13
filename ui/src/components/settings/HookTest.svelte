<script lang="ts">
  import { HOOK_EVENTS } from "../../../../shared/hooks";
  import { actionLabel, POLICY_ACTIONS } from "../../lib/permissions";
  import { t } from "../../lib/i18n.svelte";
  import { HookTester } from "../../lib/settings/hook-testing.svelte";
  import type { HookEvent } from "../../lib/settings/hooks";
  import type { HookCommandSettings } from "../../lib/types";
  import Icon from "../Icon.svelte";

  let { hook, event }: { hook: HookCommandSettings; event: HookEvent; index: number } = $props();
  const uid = $props.id();
  const tester = new HookTester();
  const fields = $derived(HOOK_EVENTS[event].fields);
  const stale = $derived(tester.result && tester.testedDefinition !== JSON.stringify(hook));
  const result = $derived(tester.result);
  const run = $derived(result?.runs[0]);
  $effect(() => { tester.prepare(hook); });
</script>

<details class="st-details hook-test">
  <summary>{t("Test hook")}<Icon name="chevron-down" size={14} class="st-chevron" /></summary>
  <div class="st-details-body">
    <p class="st-hint">{t("Test this draft without saving. The command or HTTP request really runs using the example below, even if the hook is disabled.")}</p>
    <div class="st-grid">
      {#if fields.some((field) => field === "tool")}<label class="st-field"><span class="st-label">{t("Example tool")}</span><input class="st-input" bind:value={tester.sample.toolName} /></label>{/if}
      {#if fields.some((field) => field === "path")}<label class="st-field"><span class="st-label">{t("Example path")}</span><input class="st-input" bind:value={tester.sample.path} spellcheck="false" /></label>{/if}
      {#if fields.some((field) => field === "command")}<label class="st-field span-2"><span class="st-label">{t("Example command")}</span><input class="st-input" bind:value={tester.sample.command} spellcheck="false" /></label>{/if}
      {#if event === "sessionStart" || event === "userPromptSubmit"}<label class="st-field span-2"><span class="st-label">{t("Example message")}</span><textarea class="st-textarea" rows="2" bind:value={tester.sample.prompt}></textarea></label>{/if}
      {#if event === "permission"}<div class="st-field"><label class="st-label" for={`${uid}-permission`}>{t("Action")}</label><select id={`${uid}-permission`} class="st-select" bind:value={tester.sample.permissionAction}>{#each POLICY_ACTIONS as action (action)}<option value={action}>{actionLabel(action)}</option>{/each}</select></div>{/if}
      {#if event === "postToolUse"}<div class="st-field"><label class="st-label" for={`${uid}-tool-result`}>{t("Tool result")}</label><select id={`${uid}-tool-result`} class="st-select" value={String(tester.sample.toolOk)} onchange={(e) => tester.sample.toolOk = e.currentTarget.value === "true"}><option value="true">{t("Success")}</option><option value="false">{t("Error")}</option></select></div>{/if}
    </div>
    <div><button class="st-btn st-btn--quiet" type="button" onclick={() => tester.run(event, hook)} disabled={tester.busy}>{tester.busy ? t("Testing") : t("Run test")}</button></div>
    {#if tester.error}<p class="st-error" role="alert">{tester.error}</p>{/if}
    {#if result}
      <div class="hook-test-result">
        <div class="st-status" role="status" class:st-status--ok={result.matched && run?.ok && !result.blocked} class:st-status--error={result.blocked || (result.matched && !run?.ok)}>
          <Icon name={result.matched && run?.ok && !result.blocked ? "check" : "branch"} size={15} />
          <span>{!result.matched ? t("Conditions did not match") : result.blocked ? t("Action blocked") : !run?.ok ? t("Hook failed") : t("Hook passed")}</span>
          {#if run}<span class="st-status-meta">{t("{0} ms", [run.durationMs])}</span>{/if}
        </div>
        {#if !result.matched}<p class="st-hint">{t("Update the example or the conditions, then run the test again.")}</p>{/if}
        {#if result.reason}<p class="st-error">{result.reason}</p>{/if}
        {#if run?.error}<pre>{run.error}</pre>{/if}
        {#if result.context.length}<div><span class="st-label">{t("Context added")}</span><pre>{result.context.join("\n\n")}</pre></div>{/if}
        {#if run?.output}<details><summary>{t("Output")}</summary><pre>{run.output}</pre></details>{/if}
      </div>
      {#if stale}<p class="st-hint">{t("The hook changed after this test. Run it again to check the current draft.")}</p>{/if}
    {/if}
  </div>
</details>

<style>
  .hook-test-result { display: grid; gap: 12px; min-width: 0; }
  pre { max-width: 100%; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 12px; color: var(--text-2); line-height: 1.55; user-select: text; }
  .hook-test-result details summary { color: var(--muted); cursor: pointer; font-size: 12px; }
  @media (max-width: 650px) { .st-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
