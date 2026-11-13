<script lang="ts">
  import { shortTokens } from "../../lib/context-meter.svelte";
  import { t } from "../../lib/i18n.svelte";
  import { sessionUsageCost, usageMoney, type TokenUsageDetails } from "../../lib/run/token-usage";

  let { details }: { details: TokenUsageDetails } = $props();
  const rows = $derived([
    { label: t("Input tokens"), value: details.total.input },
    { label: t("Output tokens"), value: details.total.output },
    { label: t("Reasoning tokens"), value: details.total.reasoning },
    { label: t("Cache read tokens"), value: details.total.cached },
    { label: t("Cache write tokens"), value: details.total.cacheWrite },
  ]);
</script>

<section class="lh-context-usage" aria-label={t("Token usage")}>
  <strong>{t("Token usage")}</strong>
  <dl class="lh-context-tokens">
    {#each rows as row}
      <div>
        <dt>{row.label}</dt>
        <dd title={row.value?.toLocaleString()}>{row.value === undefined ? t("Not reported") : shortTokens(row.value)}</dd>
      </div>
    {/each}
  </dl>
  <div class="lh-context-costs">
    <span><b>{usageMoney(sessionUsageCost(details)) ?? t("Not reported")}</b> {t("session")}</span>
    <span><b>{usageMoney(details.lastTurnCost) ?? t("Not reported")}</b> {t("last turn")}</span>
  </div>
  {#if details.models.length > 0}
    <ul class="lh-context-models" aria-label={t("Usage by model")}>
      {#each details.models as entry}
        <li>
          <span class="lh-context-model" title={`${entry.provider} / ${entry.model}`}>{entry.role ? `${entry.role} · ` : ""}{entry.model || t("Model")}</span>
          <span class="lh-context-model-tokens" title={t("Input / output tokens")}>
            ↑ {shortTokens(entry.input)} <span>↓ {shortTokens(entry.output)}</span>
          </span>
          <span>{usageMoney(entry.cost) ?? t("Not reported")}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>
