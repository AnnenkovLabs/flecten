<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { subagentReport } from "../lib/subagent-report";
  import { textArg, toolArgs } from "../lib/tool-presentation";
  import type { RunAction } from "../lib/types";
  import CopyButton from "./CopyButton.svelte";

  let { action, showPrompt = true }: { action: RunAction; showPrompt?: boolean } = $props();
  const input = $derived(toolArgs(action.detail?.input));
  const prompt = $derived(textArg(input, "prompt"));
  const context = $derived(textArg(input, "context"));
  const report = $derived(subagentReport(action.detail?.resultData));
</script>

<div class="delegation">
  {#if prompt && showPrompt}
    <details>
      <summary>{t("Assigned task")}</summary>
      <div class="heading"><CopyButton text={prompt} label={t("Copy")} /></div>
      <p>{prompt}</p>
    </details>
  {/if}
  {#if context}
    <details><summary>{t("Background")}</summary><p>{context}</p></details>
  {/if}
  {#if report}
    <section>
      <span class="heading">{t("Subagent report")}</span>
      {#if report.verdict}<p class="verdict">{report.verdict === "pass" ? t("Review passed") : t("Changes requested")}</p>{/if}
      {#if report.summary}<p>{report.summary}</p>{/if}
      {#each report.sections as section (section.label)}
        <div class="report-section">
          <span class="heading">{t(section.label)}</span>
          <ul>{#each section.items as item, index (index)}<li>{item}</li>{/each}</ul>
        </div>
      {/each}
    </section>
  {:else if action.state === "succeeded"}
    <p class="hint">{t("The subagent finished. Open technical details for the full response.")}</p>
  {:else if action.running}
    <p class="hint">{t("The subagent is working on this task. Its report will appear here.")}</p>
  {/if}
</div>

<style>
  .delegation { display: grid; gap: 16px; min-width: 0; }
  section { display: grid; gap: 6px; }
  .heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 12px; font-weight: 500; }
  p, ul { margin: 0; color: var(--text-2); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
  p { white-space: pre-wrap; }
  ul { padding-inline-start: 18px; }
  li + li { margin-top: 4px; }
  .report-section { display: grid; gap: 4px; margin-top: 8px; }
  .verdict { font-weight: 600; }
  .hint { color: var(--muted); }
  summary { min-height: 40px; align-content: center; color: var(--muted); cursor: pointer; font-size: 12px; }
  summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 4px; }
</style>
