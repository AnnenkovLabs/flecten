<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { POLICY_OPTIONS, type SavedPermissionRule } from "../../lib/permissions";
  let { rules, onRemove }: { rules: SavedPermissionRule[]; onRemove: (index: number) => void } = $props();
</script>

<section class="perm-section" aria-label={t("Saved rules")}>
  <h3 class="perm-section-title">{t("Saved rules")}</h3>
  <p class="perm-preset-note">{t("Rules belong to this project. Removing a rule takes effect when you save, including during an active run.")}</p>
  {#if rules.length === 0}<p class="perm-empty">{t("No saved rules.")}</p>{/if}
  {#each rules as rule, index}
    <div class="saved-rule">
      <div class="saved-rule-copy">
        <strong>{rule.tool || rule.action} <span>{POLICY_OPTIONS.find(option => option.value === rule.policy)?.label}</span></strong>
        <code>{rule.target || rule.pathPrefix || t("All matching actions")}</code>
        {#if rule.cwd}<code>{rule.cwd}</code>{/if}
        {#if rule.risk}<small>{rule.risk}</small>{/if}
        <small>{rule.requestKey ? t("Exact arguments and resources") : t("Configured scope")}</small>
        {#if rule.checkpoint}<small>{t("Human approval required every time")}</small>{/if}
      </div>
      <button class="st-btn st-btn--danger" type="button" onclick={() => onRemove(index)}>{t("Remove rule")}</button>
    </div>
  {/each}
</section>

<style>
  .saved-rule { display: flex; align-items: start; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
  .saved-rule-copy { min-width: 0; flex: 1; display: grid; gap: 4px; }
  strong { font-size: 13px; font-weight: 500; }
  span, small { color: var(--muted); font-size: 12px; }
  code { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; color: var(--text-2); }
  button { flex-shrink: 0; }
</style>
