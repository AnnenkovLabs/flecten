<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { expandable } from "../lib/motion";
  import { cancelToolCall, openSubagent } from "../lib/run/intents";
  import type { RunAction } from "../lib/types";
  import { toolState } from "../lib/tool-presentation";
  import Icon from "./Icon.svelte";
  import ToolDetail from "./ToolDetail.svelte";
  import SubagentAvatar from "./SubagentAvatar.svelte";
  import { subagentRole } from "../lib/subagent-presentation";

  let { action }: { action: RunAction } = $props();
  let expanded = $state(false);
  let wasFailed = false;

  const uid = $props.id();
  const detailId = `tool-detail-${uid}`;
  const status = $derived(toolState(action));

  $effect(() => {
    const failed = action.failed === true && Boolean(action.detail?.error);
    if (failed && !wasFailed) expanded = true;
    wasFailed = failed;
  });

  function toggle(): void {
    if (action.subagent) { openSubagent(action.subagent.id); return; }
    expanded = !expanded;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (event.repeat) return;
    toggle();
  }
</script>

<div class="action-item" class:is-failed={action.failed}>
  <div class="action-line">
  <button
    class="action"
    type="button"
    aria-expanded={action.subagent ? undefined : expanded}
    aria-controls={action.subagent ? `pane-subagent:${action.subagent.id}` : detailId}
    title={action.subagent ? `${action.subagent.name} · ${subagentRole(action.subagent.agent)}` : `${action.label}${action.subject ? ` · ${action.subject}` : ""}. ${expanded ? t("Hide details") : t("Show details")}`}
    onclick={toggle}
    onkeydown={onKeydown}
  >
    {#if action.subagent}<SubagentAvatar variant={action.subagent.avatar} size={26} />{:else}<Icon name={action.icon} size={14} />{/if}
    <span class="action-content" class:is-subagent={action.tool === "task"}>
      <span class="action-label">{action.subagent?.name ?? action.label}</span>
      {#if action.subagent}<span class="action-subject">{subagentRole(action.subagent.agent)}</span>{:else if action.subject && action.tool !== "task"}<span class="action-subject">{action.subject}</span>{/if}
    </span>
    {#if status}<span class="action-state" class:is-running={action.running}>{t(status)}</span>{/if}
    {#if action.meta}
      <span class="action-meta">{action.meta}</span>
    {/if}
    {#if action.add}
      <span class="action-meta add">+{action.add}</span>
    {/if}
    {#if action.del}
      <span class="action-meta del">−{action.del}</span>
    {/if}
    {#if action.duration}<span class="action-time">{action.duration}</span>{/if}
    <span class="chevron" class:is-open={expanded}>
      <Icon name="chevron-right" size={13} />
    </span>
  </button>
  <button
    class="action-cancel"
    class:is-inactive={!action.running || Boolean(action.subagent)}
    type="button"
    disabled={!action.running}
    aria-hidden={!action.running ? true : undefined}
    title={t("Cancel call: the process will stop and the model will be notified of the cancellation")}
    aria-label={t("Cancel: {0}", [action.label])}
    onclick={() => cancelToolCall(action.id)}
  >
    <Icon name="stop" size={12} /><span>{t("Stop tool")}</span>
  </button>
  </div>

  <div class="action-detail" id={detailId} use:expandable={expanded}>
    <ToolDetail {action} />
  </div>
</div>

<style>
  .action-item {
    min-width: 0;
  }

  .action-line {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .action-cancel {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    height: var(--control-h);
    border-radius: 7px;
    color: var(--muted);
    font-size: 12px;
    transition:
      background 220ms var(--ease),
      color 220ms var(--ease),
      border-radius 460ms var(--ease-jelly);
  }

  .action-cancel:hover {
    background: rgba(226, 162, 162, 0.1);
    color: var(--error);
  }

  .action-cancel.is-inactive { display: none; }

  .action {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    min-height: var(--control-h);
    margin-left: -7px;
    padding: 3px 7px;
    border-radius: 6px;
    color: var(--text-2);
    font-size: 13px;
    text-align: left;
    transition:
      background 150ms var(--ease);
  }

  .action:hover {
    background: rgba(240, 239, 237, 0.035);
  }

  .action:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 1px;
  }

  .action :global(.icon) {
    color: var(--muted);
    transition: transform 180ms var(--ease);
  }


  .action-item.is-failed .action-label {
    color: var(--warning);
  }

  .action-content {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .action-label, .action-subject {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .action-subject { color: var(--muted); font-size: 12px; line-height: 1.5; }
  .action-content.is-subagent { display: flex; align-items: baseline; gap: 10px; }
  .action-state { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .action-state.is-running { color: var(--text-2); }

  .action-meta {
    max-width: 45%;
    overflow: hidden;
    color: var(--muted);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .action-meta.add {
    color: var(--add);
  }

  .action-meta.del {
    color: var(--del);
  }

  .action-time {
    min-width: 40px;
    color: var(--muted);
    font-size: 12px;
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .chevron {
    display: grid;
    place-items: center;
    color: var(--muted);
    transition: transform 180ms var(--ease);
  }

  .chevron.is-open {
    transform: rotate(90deg);
  }

  .action-detail {
    min-width: 0;
  }
</style>
