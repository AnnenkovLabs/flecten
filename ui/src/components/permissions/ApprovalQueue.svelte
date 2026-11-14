<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { approvalActionTitle, approvalScopePaths, approvalSessionLabel, isApprovalExpired, reviewedApprovalIds, sortApprovals, type ApprovalDecision, type ApprovalView } from "../../lib/permissions";
  let { approvals, onApproval, onAllowAll, onDenyAll }: {
    approvals: ApprovalView[];
    onApproval: (id: string, decision: ApprovalDecision, feedback?: string) => void | Promise<void>;
    onAllowAll: (ids: string[]) => void | Promise<void>;
    onDenyAll: (ids: string[]) => void | Promise<void>;
  } = $props();
  let now = $state(Date.now());
  let confirm: { mode: "allow" | "deny"; items: ApprovalView[] } | null = $state(null);
  let busy = $state<string[]>([]);
  let remember = $state<string | null>(null);
  let feedback = $state<Record<string, string>>({});
  const pending = $derived(sortApprovals(approvals));
  const count = $derived(pending.length);
  const available = $derived(pending.filter(item => !disabled(item)));
  const reviewedIds = $derived.by(() => reviewedApprovalIds(confirm?.items ?? [], available, now));
  $effect(() => { const timer = setInterval(() => now = Date.now(), 1000); return () => clearInterval(timer); });
  function disabled(item: ApprovalView): boolean { return busy.includes(item.id) || isApprovalExpired(item.expiresAt, now); }
  async function decide(item: ApprovalView, decision: ApprovalDecision): Promise<void> {
    if (disabled(item)) return;
    busy = [...busy, item.id];
    try { await onApproval(item.id, decision, feedback[item.id] || undefined); } finally { busy = busy.filter(id => id !== item.id); }
  }
  function preview(mode: "allow" | "deny"): void {
    confirm = { mode, items: available.map(item => ({ ...item })) };
  }
  async function confirmBulk(): Promise<void> {
    if (!confirm) return;
    const reviewed = confirm;
    const ids = [...reviewedIds];
    confirm = null;
    if (ids.length === 0) return;
    busy = [...busy, ...ids];
    try { if (reviewed.mode === "allow") await onAllowAll(ids); else await onDenyAll(ids); }
    finally { busy = busy.filter(id => !ids.includes(id)); }
  }
</script>

<section class="perm-approvals" aria-label={t("Pending approvals")}>
  <div class="perm-approvals-head">
    <h3 class="perm-section-title">{t("Awaiting approval")} <span class="perm-count">{count}</span></h3>
    {#if count > 0}<div class="perm-bulk">
      <button class="st-btn st-btn--quiet" type="button" disabled={available.length === 0} onclick={() => preview("allow")}>{t("Allow all")}</button>
      <button class="st-btn st-btn--danger" type="button" disabled={available.length === 0} onclick={() => preview("deny")}>{t("Deny all")}</button>
    </div>{/if}
  </div>
  {#if confirm}
    <div class="perm-confirm" class:is-deny={confirm.mode === "deny"} role="group" aria-label={t("Bulk decision")}>
      <p class="perm-confirm-title">{confirm.mode === "allow" ? t("Allow all {0} pending requests?", [confirm.items.length]) : t("Deny all {0} pending requests?", [confirm.items.length])}</p>
      <ul class="perm-confirm-list">
        {#each confirm.items as item (item.id)}<li class="perm-confirm-item"><strong>{item.tool}</strong><code>{item.target}</code></li>{/each}
      </ul>
      <p class="perm-preset-note">{t("Only the requests shown here are included. New requests remain pending.")}</p>
      <div class="perm-confirm-actions">
        <button class="st-btn" type="button" onclick={() => confirm = null}>{t("Cancel")}</button>
        <button class={confirm.mode === "allow" ? "st-btn st-btn--primary" : "st-btn st-btn--danger-fill"} type="button" disabled={reviewedIds.length === 0} onclick={confirmBulk}>{confirm.mode === "allow" ? t("Allow all") : t("Deny all")}</button>
      </div>
    </div>
  {/if}
  {#if count === 0}<p class="perm-empty">{t("No pending approvals.")}</p>{/if}
  <ul class="perm-approval-list">
    {#each pending as item (item.id)}
      <li class="perm-approval" aria-busy={busy.includes(item.id)}>
        <div class="perm-approval-top"><strong class="perm-tool">{approvalActionTitle(item.action)}</strong></div>
        {#if item.action === "external_path"}
          <p class="perm-preset-note">{t("Folder access covers the displayed paths and their subfolders.")}</p>
          {#each approvalScopePaths(item) as path}<code class="perm-approval-target">{path}</code>{/each}
          <p class="perm-preset-note">{t("Access is shared with agents in this chat.")}</p>
        {:else}<code class="perm-approval-target">{item.target || item.tool}</code>{/if}
        {#if item.risks?.length}<p class="perm-preset-note">{item.risks.map(risk => risk.label).join(" · ")}</p>{/if}
        <details class="perm-preset-note">
          <summary>{t("Details")}</summary>
          {#if item.sessionId}<p>{t("Chat")}: <code>{item.sessionId}</code></p>{/if}
          {#if item.cwd}<p>{t("Working directory")}: <code>{item.cwd}</code></p>{/if}
          {#if item.arguments?.length}<details><summary>{t("Arguments")}</summary>{#each item.arguments as argument}<strong>{argument.name}</strong><code class="perm-approval-target">{argument.value}</code>{/each}</details>{/if}
          {#if item.reason}<p>{item.reason}</p>{/if}
          {#each item.risks ?? [] as risk}<p>{risk.label}: {risk.detail}</p>{/each}
          {#if item.humanOnly}<p>{t("Human approval required every time")}</p>{/if}
        </details>
        <div class="perm-approval-actions">
          <button class="st-btn st-btn--primary" type="button" disabled={disabled(item)} onclick={() => decide(item, item.action === "external_path" && !item.humanOnly ? "allow_session" : "allow_once")}>{item.action === "external_path" && !item.humanOnly ? t("For this chat") : t("Allow once")}</button>
          {#if item.action === "external_path" && !item.humanOnly}
            <button class="st-btn" type="button" disabled={disabled(item)} onclick={() => decide(item, "allow_once")}>{t("Allow once")}</button>
            <button class="st-btn" type="button" disabled={disabled(item)} onclick={() => decide(item, "allow_always")}>{t("Remember folder access")}</button>
          {/if}
          <button class="st-btn st-btn--danger" type="button" disabled={disabled(item)} onclick={() => decide(item, "deny")}>{t("Deny")}</button>
        </div>
        <details class="perm-preset-note">
          <summary>{t("More options")}</summary>
          {#if !item.humanOnly && item.action !== "external_path"}
            <div class="perm-approval-actions">
                <button class="st-btn" type="button" disabled={disabled(item)} onclick={() => decide(item, "allow_session")}>{approvalSessionLabel(item.action)}</button>
                <button class="st-btn" type="button" disabled={disabled(item)} onclick={() => remember = remember === item.id ? null : item.id}>{t("Remember…")}</button>
            </div>
            {#if remember === item.id}
              <p>{t("Only identical arguments, paths and working directory will match. You can revoke this rule in Access settings.")}</p><code class="perm-approval-target">{item.cwd}</code>
              <button class="st-btn" type="button" disabled={disabled(item)} onclick={() => decide(item, "allow_always")}>{t("Save exact rule")}</button>
            {/if}
          {/if}
          <label>{t("Add a note (optional)")}<textarea class="st-input" maxlength="10000" aria-label={t("Feedback for the agent")} bind:value={feedback[item.id]} disabled={disabled(item)}></textarea></label>
        </details>
        <span role="status" class="perm-preset-note">{busy.includes(item.id) ? t("Applying decision…") : disabled(item) ? t("Expired: waiting for confirmation") : ""}</span>
      </li>
    {/each}
  </ul>
</section>
