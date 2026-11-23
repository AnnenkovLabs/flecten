<script lang="ts">
  import { ACCESS_MODES, activeAccessMode, applyAccessMode, type AccessMode } from "../../../../shared/access-mode";
  import { t } from "../../lib/i18n.svelte";
  import { accessModeDescription, accessModeLabel, type ApprovalDecision } from "../../lib/permissions";
  import { settings } from "../../lib/settings.svelte";
  import { permissionPolicies, setPermissionPolicy, type PermissionPolicyName } from "../../lib/settings-utils";
  import Icon from "../Icon.svelte";
  import ApprovalQueue from "../permissions/ApprovalQueue.svelte";
  import PermissionsPanel from "../permissions/PermissionsPanel.svelte";
  import SavedRules from "../permissions/SavedRules.svelte";
  import SandboxSettings from "./SandboxSettings.svelte";
  import "../permissions/permissions.css";
  import "../permissions/permissions-approvals.css";

  const config = $derived(settings.settings);
  const policies = $derived(config ? permissionPolicies(config) : {});
  const mode = $derived(config ? activeAccessMode(config) : "custom");
  const approvals = $derived(settings.approvals);
  const hasSavedRules = $derived((config?.permissions?.rules.length ?? 0) > 0);
  const modes = Object.keys(ACCESS_MODES) as AccessMode[];
  const POLICY_VALUES: PermissionPolicyName[] = ["deny", "auto", "ask", "allow"];

  function setPolicy(action: string, policy: string): void {
    if (config && POLICY_VALUES.includes(policy as PermissionPolicyName))
      setPermissionPolicy(config, action, policy as PermissionPolicyName);
  }
  function removeRule(index: number): void {
    if (config?.permissions)
      config.permissions.rules = config.permissions.rules.filter((_, at) => at !== index);
  }
  function resolveApproval(id: string, decision: ApprovalDecision, feedback?: string): Promise<void> {
    return settings.respondApproval(id, decision, feedback);
  }
</script>

{#if config}
  <section class="settings-section" aria-labelledby="settings-permissions">
    <h2 id="settings-permissions">{t("Access")}</h2>
    <div class="perm">
      <div class="perm-section">
        <div class="perm-access-modes" role="group" aria-label={t("Access mode")}>
          {#each modes as choice}
            <button
              class="perm-access-mode"
              class:is-active={mode === choice}
              aria-pressed={mode === choice}
              type="button"
              onclick={() => applyAccessMode(config, choice)}
            >
              <strong>{accessModeLabel(choice)}</strong>
              <span>{accessModeDescription(choice)}</span>
            </button>
          {/each}
        </div>
        {#if mode === "custom"}
          <p class="perm-preset-note" role="status">
            <strong>{accessModeLabel(mode)}.</strong>
            {accessModeDescription(mode)}
          </p>
        {/if}
        {#if hasSavedRules}
          <p class="perm-preset-note">{t("Saved rules still apply in every mode.")}</p>
        {/if}
      </div>

      {#if approvals.length > 0}
        <ApprovalQueue
          {approvals}
          onApproval={resolveApproval}
          onAllowAll={(ids) => settings.allowAllApprovals(ids)}
          onDenyAll={(ids) => settings.denyAllApprovals(ids)}
        />
      {/if}

      {#if config.permissions}
        <SavedRules rules={config.permissions.rules} onRemove={removeRule} />
      {/if}

      <details class="st-details">
        <summary>{t("Advanced access settings")}<Icon name="chevron-down" size={14} class="st-chevron" /></summary>
        <div class="st-details-body">
          <PermissionsPanel {policies} onChange={setPolicy} />
          <SandboxSettings />
        </div>
      </details>
    </div>
  </section>
{/if}
