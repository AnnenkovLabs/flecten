<script lang="ts">
  import type { HookRun } from "../../../../shared/hooks";
  import { t } from "../../lib/i18n.svelte";
  import { hookEventLabel } from "../../lib/settings/hooks";
  import Icon from "../Icon.svelte";
  let { runs }: { runs: HookRun[] } = $props();
</script>

<details class="st-details hook-history">
  <summary><span>{t("Recent hook activity")} <span class="st-count">{runs.length}</span></span><Icon name="chevron-down" size={14} class="st-chevron" /></summary>
  <div class="st-details-body">
    <p class="st-hint">{t("Actual hook runs in the current task, newest first. Test runs appear in the editor only.")}</p>
    {#if runs.length}
      {#each [...runs].reverse() as run (run)}
        <details class="hook-history-run">
          <summary><Icon name={run.ok ? "check" : "x"} size={14} /><span class="run-title"><strong>{run.name || hookEventLabel(run.event)}</strong><span>{hookEventLabel(run.event)} · {run.blocked ? t("Action blocked") : run.ok ? t("Done") : t("Hook failed")}{run.async ? ` · ${t("Background")}` : ""}</span></span><span class="run-time">{t("{0} ms", [run.durationMs])}</span><span class="run-chevron"><Icon name="chevron-down" size={13} /></span></summary>
          {#if run.source}<p class="st-hint">{run.source.type === "module" ? run.source.name : t("Project")}</p>{/if}
          {#if run.error}<pre class="run-error">{run.error}</pre>{/if}
          {#if run.output}<pre>{run.output}</pre>{/if}
          {#if !run.error && !run.output}<p class="st-hint">{t("Response without output")}</p>{/if}
        </details>
      {/each}
    {:else}<p class="st-hint">{t("No hooks have run in this task yet.")}</p>{/if}
  </div>
</details>

<style>
  .hook-history { margin-top: 8px; }
  .hook-history-run { min-width: 0; }
  .hook-history-run summary { display: flex; align-items: center; gap: 8px; cursor: pointer; padding-block: 8px; list-style: none; }
  .hook-history-run summary::-webkit-details-marker { display: none; }
  .hook-history-run :global(svg) { color: var(--muted); flex: none; }
  .run-title { display: grid; gap: 4px; min-width: 0; flex: 1; overflow-wrap: anywhere; }
  .run-title strong { font-size: 13px; font-weight: 500; color: var(--text-2); }
  .run-title span, .run-time { font-size: 12px; color: var(--muted); }
  .run-chevron { display: grid; place-items: center; flex: none; }
  .hook-history-run[open] .run-chevron { transform: rotate(180deg); }
  .run-time { flex: none; font-variant-numeric: tabular-nums; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 12px; color: var(--text-2); line-height: 1.55; user-select: text; }
  pre.run-error { color: var(--error); }
</style>
