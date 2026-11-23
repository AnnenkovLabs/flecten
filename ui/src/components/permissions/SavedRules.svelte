<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { actionLabel, POLICY_OPTIONS, type SavedPermissionRule } from "../../lib/permissions";

  let {
    rules,
    onRemove,
  }: { rules: SavedPermissionRule[]; onRemove: (index: number) => void } = $props();

  function policyLabel(value: string): string {
    return POLICY_OPTIONS.find((option) => option.value === value)?.label ?? value;
  }
</script>

{#if rules.length > 0}
  <section class="st-group" aria-label={t("Saved rules")}>
    <h3 class="st-group-title">{t("Saved rules")}</h3>
    <div class="st-card">
      {#each rules as rule, index (index)}
        <div class="saved-rule">
          <div class="saved-rule-copy">
            <div class="saved-rule-head">
              <strong>{rule.tool || actionLabel(rule.action)}</strong>
              <span class="saved-rule-policy">{policyLabel(rule.policy)}</span>
            </div>
            <code>{rule.target || rule.pathPrefix || t("All matching actions")}</code>
            {#if rule.cwd}<code>{rule.cwd}</code>{/if}
            {#if rule.risk}<small>{rule.risk}</small>{/if}
            {#if rule.requestKey}<small>{t("Exact arguments and resources")}</small>{/if}
            {#if rule.checkpoint}<small>{t("Human approval required every time")}</small>{/if}
          </div>
          <button class="st-btn st-btn--danger st-btn--sm" type="button" onclick={() => onRemove(index)}>
            {t("Remove rule")}
          </button>
        </div>
      {/each}
    </div>
    <p class="st-group-note">
      {t("Rules are saved globally. Removing a rule takes effect when you save, including during an active run.")}
    </p>
  </section>
{/if}

<style>
  .saved-rule {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 14px;
  }

  .saved-rule-copy {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .saved-rule-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  strong {
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
  }

  .saved-rule-policy,
  small {
    color: var(--muted);
    font-size: 12px;
  }

  code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 12px;
    color: var(--text-2);
  }

  button {
    flex: none;
  }
</style>
