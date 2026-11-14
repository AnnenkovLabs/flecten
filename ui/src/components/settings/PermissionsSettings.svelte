<script lang="ts">
  import { ACCESS_MODES, activeAccessMode, applyAccessMode, type AccessMode } from "../../../../shared/access-mode";
  import { t } from "../../lib/i18n.svelte";
  import { accessModeDescription, accessModeLabel, POLICY_OPTIONS, type ApprovalDecision } from "../../lib/permissions";
  import { settings } from "../../lib/settings.svelte";
  import { permissionPolicies, setPermissionPolicy, type PermissionPolicyName } from "../../lib/settings-utils";
  import SavedRules from "../permissions/SavedRules.svelte";
  import HumanCheckpoints from "../permissions/HumanCheckpoints.svelte";
  import PermissionsPanel from "../permissions/PermissionsPanel.svelte";
  import ApprovalQueue from "../permissions/ApprovalQueue.svelte";
  import SandboxSettings from "./SandboxSettings.svelte";
  import "../permissions/permissions.css";
  import "../permissions/permissions-approvals.css";
  import "../permissions/permissions-polish.css";

  const config = $derived(settings.settings);
  const policies = $derived(config ? permissionPolicies(config) : {});
  const mode = $derived(config ? activeAccessMode(config) : "custom");
  const approvals = $derived(settings.approvals);
  const modes = Object.keys(ACCESS_MODES) as AccessMode[];
  const POLICY_VALUES: PermissionPolicyName[] = ["deny", "auto", "ask", "allow"];

  function setPolicy(action: string, policy: string): void {
    if (config && POLICY_VALUES.includes(policy as PermissionPolicyName))
      setPermissionPolicy(config, action, policy as PermissionPolicyName);
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
            <button class="perm-access-mode" class:is-active={mode === choice} aria-pressed={mode === choice} type="button" onclick={() => applyAccessMode(config, choice)}>
              <strong>{accessModeLabel(choice)}</strong>
              <span>{accessModeDescription(choice)}</span>
            </button>
          {/each}
        </div>
        {#if mode === "custom"}<p class="perm-preset-note" role="status"><strong>{accessModeLabel(mode)}.</strong> {accessModeDescription(mode)}</p>{/if}
        <p class="perm-preset-note">{t("Saved rules and human checkpoints still apply in every mode.")}</p>
      </div>
      {#if approvals.length > 0}
        <ApprovalQueue {approvals} onApproval={resolveApproval} onAllowAll={(ids) => settings.allowAllApprovals(ids)} onDenyAll={(ids) => settings.denyAllApprovals(ids)} />
      {/if}
      <details class="perm-advanced">
        <summary>{t("Advanced access settings")}</summary>
        <div class="perm-advanced-content">
          <PermissionsPanel {policies} onChange={setPolicy} />
          {#if config.permissions}
            <HumanCheckpoints bind:rules={config.permissions.rules} />
            <div class="perm-section">
              <label class="perm-section-title" for="destructive-access">{t("Destructive actions")}</label>
              <p class="perm-preset-note">{t("A separate checkpoint for irreversible operations, even when ordinary actions are allowed.")}</p>
              <select id="destructive-access" class="st-input" bind:value={config.permissions.destructive}>
                {#each POLICY_OPTIONS as option}<option value={option.value}>{option.label}</option>{/each}
              </select>
            </div>
            <SavedRules rules={config.permissions.rules} onRemove={(index) => { if (config.permissions) config.permissions.rules = config.permissions.rules.filter((_, at) => at !== index); }} />
          {/if}
          <SandboxSettings />
        </div>
      </details>
    </div>
  </section>
{/if}
