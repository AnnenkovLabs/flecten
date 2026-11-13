<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { approvalActionTitle } from "../lib/permissions";
  import { answerApproval, type ApprovalChoice } from "../lib/run/intents";
  import type { ApprovalItem } from "../lib/types";
  import Icon from "./Icon.svelte";

  let { item }: { item: ApprovalItem } = $props();

  const approval = $derived(item.approval);
  const projectTrust = $derived(approval.risks?.some((risk) => risk.id === "project-trust") === true);
  const pending = $derived(item.state === "pending");
  let now = $state(Date.now());
  let remember = $state(false);
  let feedback = $state("");
  const disabled = $derived(!pending || !!item.resolving || now >= approval.expiresAt);

  $effect(() => {
    if (!pending) return;
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  const left = $derived(Math.max(0, Math.ceil((approval.expiresAt - now) / 1000)));
  const leftLabel = $derived(
    left >= 60 ? t("{0} min {1} s", [Math.floor(left / 60), String(left % 60).padStart(2, "0")]) : t("{0} sec", [left]),
  );
  const outcome = $derived.by(() => {
    if (item.state === "allow_once") return projectTrust ? t("Project trusted") : t("Allowed once");
    if (item.state === "allow_session") return t("Allowed for this chat");
    if (item.by === "policy") return t("Permission changed: call denied");
    if (item.by === "persistence") return t("Rule could not be saved: call denied");
    if (item.state === "allow_always") return t("Allowed and saved");
    if (item.by === "timeout") return t("No response: call denied");
    if (item.by === "aborted") return t("Run stopped");
    return t("Denied");
  });

  function choose(choice: ApprovalChoice): void {
    if (!disabled) answerApproval(item.sessionId, approval.id, choice, feedback || undefined);
  }
</script>

<section
  class="approval"
  class:is-settled={!pending}
  class:is-denied={item.state === "deny"}
  aria-label={t("Permission: {0}", [approval.tool])}
>
  <header class="approval-head">
    <Icon name="key" size={15} />
    <span class="approval-title" role="status">{pending ? projectTrust ? t("Trust project?") : approvalActionTitle(approval.action) : outcome}</span>
  </header>
  <code class="approval-target">{approval.target || approval.tool}</code>
  {#if projectTrust}
    <p class="approval-reason">{t("Configured modules, MCP servers and hooks can run with your account permissions.")}</p>
  {:else if approval.risks && approval.risks.length > 0}
    <ul class="approval-risks" aria-label={t("Risks")}>
      {#each approval.risks as risk (risk.id)}
        <li><strong>{risk.label}</strong></li>
      {/each}
    </ul>
  {/if}
  <details class="approval-reason approval-details">
    <summary>{t("Details")}</summary>
    {#if approval.cwd}<p><strong>{t("Working directory")}</strong> <code>{approval.cwd}</code></p>{/if}
    {#if approval.actor}<p>{t("Subagent")}: {approval.actor}</p>{/if}
    {#if approval.requestReason}<p>{approval.requestReason}</p>{/if}
    {#if approval.reason}<p>{approval.reason}</p>{/if}
    {#if approval.humanOnly && !projectTrust}<p>{t("Human approval required every time")}</p>{/if}
    {#if approval.arguments?.length}<details><summary>{t("Arguments")}</summary>{#each approval.arguments as argument}<strong>{argument.name}</strong><code class="approval-target">{argument.value}</code>{/each}</details>{/if}
    {#if approval.paths?.length}<details><summary>{t("Affected paths")}</summary>{#each approval.paths as path}<div><code>{path}</code></div>{/each}</details>{/if}
    {#each approval.risks ?? [] as risk}{#if risk.id !== "project-trust"}<p>{risk.label}: {risk.detail}</p>{/if}{/each}
    {#if pending}<p title={t("Without a response, the call will be denied")}>{leftLabel}</p>{/if}
  </details>
  <div role="status" aria-live="polite" class="approval-reason">
    {#if item.resolving}{t("Applying decision…")}{:else if pending && disabled}{t("Expired: waiting for confirmation")}{/if}
  </div>
  {#if item.error}<p class="approval-reason" role="alert">{item.error}</p>{/if}
  {#if pending}
    <div class="approval-actions">
      <button class="st-btn st-btn--primary" type="button" {disabled} onclick={() => choose("allow_once")}>{projectTrust ? t("Trust and continue") : t("Allow once")}</button>
      <button class="st-btn st-btn--danger" type="button" {disabled} onclick={() => choose("deny")}>{t("Deny")}</button>
      <details class="approval-more">
        <summary class="st-btn st-btn--quiet">{t("More options")}</summary>
        <div class="approval-extra">
          {#if !approval.humanOnly}
            <div class="approval-actions">
              <button class="st-btn" type="button" {disabled} onclick={() => choose("allow_session")}>{t("For this chat")}</button>
              <button class="st-btn" type="button" {disabled} onclick={() => remember = !remember}>{t("Remember…")}</button>
            </div>
            {#if remember}
              <p class="approval-reason">{t("Only this action in this folder.")}</p>
              <code class="approval-target">{approval.cwd}</code>
              <button class="st-btn" type="button" {disabled} onclick={() => choose("allow_always")}>{t("Save exact rule")}</button>
            {/if}
          {/if}
          <label class="approval-reason">{t("Add a note (optional)")}<textarea class="st-input" maxlength="10000" aria-label={t("Feedback for the agent")} bind:value={feedback} {disabled}></textarea></label>
        </div>
      </details>
    </div>
  {/if}
</section>

<style>
  .approval {
    max-width: 68ch;
    margin-top: 20px;
    padding: 12px 14px 14px;
    border-radius: 12px;
    background: rgba(211, 189, 145, 0.06);
    box-shadow:
      inset 0 1px 0 rgba(240, 239, 237, 0.04),
      0 0 0 1px rgba(211, 189, 145, 0.2);
    transition:
      background 320ms var(--ease),
      box-shadow 320ms var(--ease);
  }

  .approval.is-settled {
    background: rgba(240, 239, 237, 0.025);
    box-shadow: 0 0 0 1px var(--line);
  }

  .approval-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    color: var(--warning);
    font-size: 13px;
    font-weight: 600;
  }

  .approval.is-settled .approval-head {
    color: var(--text-2);
  }

  .approval-title {
    flex: 1;
    min-width: 0;
  }

  .approval.is-denied .approval-title {
    color: var(--error);
  }

  .approval-target {
    display: block;
    max-height: 120px;
    margin-top: 8px;
    padding: 8px 10px;
    overflow: auto;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.22);
    color: var(--text);
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .approval-reason,
  .approval-risks {
    margin: 8px 0 0;
    color: var(--text-2);
    font-size: 12.5px;
    line-height: 1.55;
    text-wrap: pretty;
    overflow-wrap: anywhere;
  }

  .approval-reason p { margin: 4px 0; }

  .approval-risks {
    padding-left: 18px;
  }

  .approval-risks strong {
    color: var(--warning);
    font-weight: 600;
  }

  .approval-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }

  .approval-more[open] { flex-basis: 100%; }
  .approval-more summary { cursor: pointer; width: fit-content; }
  .approval-extra { display: grid; gap: 8px; }
  .approval-extra label { display: grid; gap: 6px; }

</style>
