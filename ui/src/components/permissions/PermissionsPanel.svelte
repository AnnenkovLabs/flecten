<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import {
    ACTION_META,
    POLICY_ACTIONS,
    PRESETS,
    applyPreset,
    buildPolicy,
    isCustom,
    presetDescription,
    type ApprovalDecision,
    type ApprovalView,
    type Policy,
    type PolicyPreset,
  } from "../../lib/permissions";
  import ApprovalQueue from "./ApprovalQueue.svelte";
  import PolicyRow from "./PolicyRow.svelte";
  import "./permissions.css";
  import "./permissions-approvals.css";
  import "./permissions-polish.css";

  interface Props {
    policies: Record<string, Policy>;
    onChange: (action: string, policy: string) => void;
    approvals: ApprovalView[];
    onApproval: (id: string, decision: ApprovalDecision, feedback?: string) => void | Promise<void>;
    onAllowAll: (ids: string[]) => void | Promise<void>;
    onDenyAll: (ids: string[]) => void | Promise<void>;
  }

  let { policies, onChange, approvals, onApproval, onAllowAll, onDenyAll }: Props = $props();

  const policyMap = $derived(buildPolicy(policies));
  const custom = $derived(isCustom(policyMap));
  const activePreset = $derived(
    PRESETS.find((preset) =>
      POLICY_ACTIONS.every((action) => preset.policies[action] === policyMap[action]),
    ),
  );
  const note = $derived(presetDescription(custom ? "custom" : (activePreset?.id ?? "custom")));

  function choosePreset(id: PolicyPreset["id"]): void {
    const next = applyPreset(id, policyMap);
    for (const action of POLICY_ACTIONS) {
      onChange(action, next[action]);
    }
  }
</script>

<div class="perm" role="group" aria-label={t("Permissions and approvals")}>
  <div class="perm-preset-block">
    <div class="perm-presets" role="group" aria-label={t("Permission presets")}>
      {#each PRESETS as preset (preset.id)}
        <button
          class="perm-preset"
          class:is-active={!custom && activePreset?.id === preset.id}
          type="button"
          aria-pressed={!custom && activePreset?.id === preset.id}
          title={preset.description}
          onclick={() => choosePreset(preset.id)}
        >
          {preset.label}
        </button>
      {/each}
      <span
        class="perm-preset perm-preset--custom"
        class:is-active={custom}
        aria-current={custom ? "true" : undefined}
        title={t("Custom rule set")}
      > {t("Custom")} </span>
    </div>

    <p class="perm-preset-note" aria-live="polite">{note}</p>
  </div>

  <div class="perm-section">
    <h3 class="perm-section-title">{t("Rules")}</h3>
    <div class="perm-policy-list">
      {#each POLICY_ACTIONS.filter(action => action !== "external_path") as action (action)}
        <PolicyRow
          meta={ACTION_META[action]}
          value={policyMap[action]}
          onChange={(policy) => onChange(action, policy)}
        />
      {/each}
    </div>
  </div>

  <ApprovalQueue {approvals} {onApproval} {onAllowAll} {onDenyAll} />
</div>
