<script lang="ts">
  import type { WorkerAcceptance } from "../../../shared/worker-assignment";
  import { t } from "../lib/i18n.svelte";
  let { acceptance }: { acceptance: WorkerAcceptance } = $props();
  const met = $derived(acceptance.criteria.filter((criterion) => criterion.status === "met").length);
</script>

<details class="worker-acceptance">
  <summary>{t("Acceptance criteria")} · {met}/{acceptance.criteria.length}</summary>
  <p class="objective">{acceptance.assignment.objective}</p>
  <ul>
    {#each acceptance.criteria as criterion (criterion.id)}
      <li>
        <span class="criterion-state">{criterion.status === "met" ? t("Criterion met") : criterion.status === "blocked" ? t("Criterion blocked") : t("Criterion open")}</span>
        <span>{acceptance.assignment.acceptanceCriteria.find((entry) => entry.id === criterion.id)?.description}</span>
        {#if criterion.reason}<p>{criterion.reason}</p>{/if}
        {#if criterion.evidence}
          <p class="evidence"><strong>{criterion.evidence.kind === "tool_result" ? t("Observed tool result") : t("Model assertion")}</strong>: {criterion.evidence.statement}</p>
          {#if criterion.evidence.tool}<p class="evidence">{criterion.evidence.tool}</p>{/if}
        {/if}
      </li>
    {/each}
  </ul>
</details>

<style>
  .worker-acceptance { margin-block: 8px; font-size: 12.5px; line-height: 1.5; }
  summary { cursor: pointer; min-height: 40px; align-content: center; color: var(--text); }
  summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 4px; }
  .objective { margin-block: 4px 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
  ul { display: grid; gap: 12px; padding-inline-start: 20px; }
  li { overflow-wrap: anywhere; }
  .criterion-state { display: block; font-weight: 600; }
  p { margin-block: 4px 0; }
  .evidence { color: var(--muted); white-space: pre-wrap; }
</style>
