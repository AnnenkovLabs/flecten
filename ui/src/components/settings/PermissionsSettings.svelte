<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import type { ApprovalDecision } from "../../lib/permissions";
  import { settings } from "../../lib/settings.svelte";
  import {
    permissionPolicies,
    setPermissionPolicy,
    type PermissionPolicyName,
  } from "../../lib/settings-utils";
  import SavedRules from "../permissions/SavedRules.svelte";
  import HumanCheckpoints from "../permissions/HumanCheckpoints.svelte";
  import { POLICY_OPTIONS } from "../../lib/permissions";
  import PermissionsPanel from "../permissions/PermissionsPanel.svelte";

  const config = $derived(settings.settings);
  const policies = $derived(config ? permissionPolicies(config) : {});
  const approvals = $derived(settings.approvals);

  const POLICY_VALUES: PermissionPolicyName[] = ["deny", "auto", "ask", "allow"];

  function setPolicy(action: string, policy: string): void {
    if (!config) return;
    if (!POLICY_VALUES.includes(policy as PermissionPolicyName)) return;
    setPermissionPolicy(config, action, policy as PermissionPolicyName);
  }

  // «Всегда» saves a rule for this exact tool and target in the core, not a policy for the
  // whole action; «Запретить» refuses only this call.
  function resolveApproval(id: string, decision: ApprovalDecision, feedback?: string): Promise<void> {
    return settings.respondApproval(id, decision, feedback);
  }
</script>

{#if config}
  <section class="settings-section" aria-labelledby="settings-permissions">
    <h2 id="settings-permissions">{t("Permissions")}</h2>
    <PermissionsPanel
      {policies}
      onChange={setPolicy}
      {approvals}
      onApproval={resolveApproval}
      onAllowAll={(ids) => settings.allowAllApprovals(ids)}
      onDenyAll={(ids) => settings.denyAllApprovals(ids)}
    />
    {#if config.permissions}
      <HumanCheckpoints bind:rules={config.permissions.rules} />
      <div class="perm-section">
        <h3 class="perm-section-title">{t("Destructive actions")}</h3>
        <p class="perm-preset-note">{t("A separate checkpoint for irreversible operations, even when ordinary actions are allowed.")}</p>
        <select class="st-input" aria-label={t("Destructive actions")} bind:value={config.permissions.destructive}>
          {#each POLICY_OPTIONS as option}<option value={option.value}>{option.label}</option>{/each}
        </select>
      </div>
      <SavedRules rules={config.permissions.rules} onRemove={(index) => { if (config.permissions) config.permissions.rules = config.permissions.rules.filter((_, at) => at !== index); }} />
    {/if}
    <div class="perm-section">
      <h3 class="perm-section-title">{t("Execution boundary")}</h3>
      <p class="perm-preset-note">{t("Sandbox limits apply independently of permissions. External paths stay blocked while workspace isolation is enabled.")}</p>
      <p class="perm-preset-note">{config.sandbox?.enabled ? t("Workspace isolation enabled") : t("Workspace isolation disabled")}</p>
      {#if settings.info?.sandbox?.enabled}
        <p class="perm-preset-note" role="status">{settings.info.sandbox.available ? t("OS sandbox available") : t("OS sandbox unavailable")}: {settings.info.sandbox.kind}. {settings.info.sandbox.reason}</p>
      {/if}
    </div>
  </section>
{/if}
