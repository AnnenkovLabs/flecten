<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { ACTION_META, POLICY_ACTIONS, buildPolicy, type Policy } from "../../lib/permissions";
  import PolicyRow from "./PolicyRow.svelte";

  let { policies, onChange }: {
    policies: Record<string, Policy>;
    onChange: (action: string, policy: string) => void;
  } = $props();
  const policyMap = $derived(buildPolicy(policies));
</script>

<div class="st-group" role="group" aria-label={t("Action permissions")}>
  <h3 class="st-group-title">{t("Action permissions")}</h3>
  <div class="st-card perm-policy-list">
    {#each POLICY_ACTIONS as action (action)}
      <PolicyRow
        meta={ACTION_META[action]}
        value={policyMap[action]}
        onChange={(policy) => onChange(action, policy)}
      />
    {/each}
  </div>
</div>
