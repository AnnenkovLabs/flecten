<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { actionLabel, type SavedPermissionRule } from "../../lib/permissions";

  let { rules = $bindable() }: { rules: SavedPermissionRule[] } = $props();
  const actions = ["write", "shell", "network", "mcp", "skill"] as const;
  function matches(rule: SavedPermissionRule, action: string): boolean {
    return rule.action === action && rule.policy === "ask" && rule.checkpoint === true &&
      !rule.tool && !rule.pathPrefix && !rule.requestKey && !rule.risk && !rule.cwd;
  }
  function change(action: string, checked: boolean): void {
    rules = rules.filter(rule => !matches(rule, action));
    if (checked) rules = [...rules, { action, policy: "ask", checkpoint: true }];
  }
</script>

<fieldset class="perm-section checkpoints">
  <legend class="perm-section-title">{t("Always ask a person")}</legend>
  <p class="perm-preset-note">{t("These checkpoints cannot be bypassed by saved approvals or automatic review.")}</p>
  <div class="checkpoint-options">
    {#each actions as action}
      <label><input type="checkbox" checked={rules.some(rule => matches(rule, action))} onchange={event => change(action, event.currentTarget.checked)} />{actionLabel(action)}</label>
    {/each}
  </div>
</fieldset>

<style>
  .checkpoints { border: 0; padding: 0; min-width: 0; }
  .checkpoint-options { display: flex; flex-wrap: wrap; gap: 12px 20px; margin-top: 12px; }
  label { display: flex; align-items: center; gap: 8px; color: var(--text-2); font-size: 13px; cursor: pointer; }
  input { accent-color: var(--primary); }
</style>
