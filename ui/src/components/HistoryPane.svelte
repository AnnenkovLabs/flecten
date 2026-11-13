<script lang="ts">
  import { i18n, t } from "../lib/i18n.svelte";
  import { formatBytes } from "../lib/composer/queue";
  import { countLabel } from "../lib/format";
  import type { AgentCheckpoint, AgentInfo } from "../lib/types";
  import Icon from "./Icon.svelte";

  interface Props {
    checkpoints: AgentCheckpoint[];
    /** Whether shell commands get snapshots too, and why not. */
    shell?: AgentInfo["shellCheckpoints"] | undefined;
    onRestore: (id: string, target: "before" | "after") => void;
    onRefresh: () => void;
  }

  let { checkpoints, shell, onRestore, onRefresh }: Props = $props();

  const SHELL_STATE = $derived({
    ready: t("Shell commands are also rolled back"),
    indexing: t("Preparing shell command snapshots…"),
    off: t("Shell command snapshots are off"),
    unavailable: t("Shell command snapshots are unavailable"),
  } as const);

  let pending = $state<{ id: string; target: "before" | "after" } | null>(null);

  function requestRestore(id: string, target: "before" | "after"): void {
    pending = { id, target };
  }

  function confirmRestore(): void {
    if (!pending) return;
    onRestore(pending.id, pending.target);
    pending = null;
  }

  function timeOf(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleTimeString(i18n.locale, { hour: "2-digit", minute: "2-digit" });
  }

  function filesLabel(count: number): string {
    return `${countLabel(count, "file")}`;
  }
</script>

<div class="history">
  <div class="history-head">
    {#if shell}
      <span
        class="shell-state"
        class:is-ready={shell.state === "ready"}
        title={shell.reason ?? SHELL_STATE[shell.state]}
      >
        {SHELL_STATE[shell.state]}
      </span>
    {/if}
    <button class="st-icon-btn" type="button" aria-label={t("Refresh history")} onclick={onRefresh}>
      <Icon name="refresh" size={14} />
    </button>
  </div>

  {#if checkpoints.length === 0}
    <div class="empty">{t("No snapshots yet")}</div>
  {:else}
    <div class="list">
      {#each checkpoints as checkpoint (checkpoint.id)}
        <article class="checkpoint">
          <div class="checkpoint-main">
            <span class="checkpoint-label">{checkpoint.label}</span>
            {#if checkpoint.command}
              <code class="checkpoint-command" title={checkpoint.command}>{checkpoint.command}</code>
            {/if}
            <span class="checkpoint-meta">
              {timeOf(checkpoint.createdAt)} · {filesLabel(checkpoint.files.length)} ·
              {formatBytes(checkpoint.bytes)} · {checkpoint.tool}
            </span>
            {#if checkpoint.gap}
              <span class="checkpoint-gap" title={checkpoint.gap.reason}> {t("Not included in the snapshot: {0}, {1}", [filesLabel(checkpoint.gap.files), formatBytes(checkpoint.gap.bytes)])} </span>
            {/if}
          </div>
          <div class="checkpoint-actions">
            {#if pending?.id === checkpoint.id}
              <span class="confirm-copy">
                {pending.target === "before" ? t("Restore files to before the action?") : t("Restore files to after the action?")}
              </span>
              <button class="st-btn st-btn--quiet" type="button" onclick={() => (pending = null)}> {t("Cancel")} </button>
              <button class="st-btn st-btn--danger" type="button" onclick={confirmRestore}> {t("Confirm")} </button>
            {:else}
              <button
                class="st-btn st-btn--quiet"
                type="button"
                title={t("Restore files to their state before this action")}
                onclick={() => requestRestore(checkpoint.id, "before")}
              > {t("Roll back")} </button>
              {#if checkpoint.finalizedAt}
                <button
                  class="st-btn st-btn--quiet"
                  type="button"
                  title={t("Restore the state after this action")}
                  onclick={() => requestRestore(checkpoint.id, "after")}
                > {t("Restore")} </button>
              {/if}
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  .history {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    padding: 20px;
    gap: 12px;
  }

  .history-head {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
  }

  .shell-state {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shell-state.is-ready::before {
    content: "";
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 8px;
    border-radius: 50%;
    background: var(--success);
    vertical-align: 1px;
  }

  .checkpoint-command {
    overflow: hidden;
    color: var(--text-body);
    font-family: var(--mono);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .checkpoint-gap {
    color: var(--warning);
    font-size: 12px;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .checkpoint {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px 12px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
  }

  .checkpoint-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .checkpoint-label {
    overflow: hidden;
    color: var(--text);
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .checkpoint-meta {
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .checkpoint-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
    flex: none;
  }

  .confirm-copy {
    color: var(--text-2);
    font-size: 12px;
  }

  .empty {
    padding: 24px 18px;
    border: 1px dashed var(--line);
    border-radius: 10px;
    color: var(--muted);
    font-size: 12px;
    text-align: center;
  }
</style>
