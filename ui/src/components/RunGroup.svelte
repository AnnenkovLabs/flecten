<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { formatDuration } from "../lib/agent";
  import { countLabel } from "../lib/format";
  import { expandable } from "../lib/motion";
  import { groupActions } from "../lib/run/action-groups";
  import type { RunSummary } from "../lib/types";
  import FileChangeChip from "./FileChangeChip.svelte";
  import Icon from "./Icon.svelte";
  import ReasoningBlock from "./ReasoningBlock.svelte";
  import RunActionGroup from "./RunActionGroup.svelte";
  import RunActionRow from "./RunActionRow.svelte";

  interface Props {
    id: string;
    summary: RunSummary;
    onOpenChanges: () => void;
  }

  let { id, summary, onOpenChanges }: Props = $props();
  let expanded = $state(false);
  let wasFailed = false;
  let now = $state(Date.now());
  const duration = $derived(summary.live && summary.startedAt !== undefined
    ? formatDuration(Math.max(0, now - summary.startedAt))
    : summary.duration);
  $effect(() => {
    if (!summary.live || summary.startedAt === undefined) return;
    now = Date.now();
    const timer = setInterval(() => { now = Date.now(); }, 100);
    return () => clearInterval(timer);
  });
  const latest = $derived(summary.list.at(-1));
  const preview = $derived(summary.list.filter((action) => (action.tool === "task" && action.running) || action.id === latest?.id));
  const additions = $derived(summary.files.reduce((sum, file) => sum + file.add, 0));
  const deletions = $derived(summary.files.reduce((sum, file) => sum + (file.del ?? 0), 0));

  const detailsId = $derived(`run-details-${id}`);
  const actionLabel = $derived(
    summary.actions > 0
      ? `${countLabel(summary.actions, "action")}`
      : summary.live
        ? t("thinking")
        : t("thought"),
  );
  $effect(() => {
    if (summary.failed && !wasFailed) expanded = true;
    wasFailed = summary.failed === true;
  });
</script>

<div class="run">
  <button
    class="run-summary"
    type="button"
    aria-expanded={expanded}
    aria-controls={detailsId}
    title={expanded ? t("Hide actions") : t("Show actions")}
    onclick={() => (expanded = !expanded)}
  >
    <span class="run-status" aria-hidden="true">
      {#if summary.live}
        <span class="run-live-dot"></span>
      {:else}
        <span class="run-check" class:is-failed={summary.failed} class:is-stopped={summary.stopped}>
          <Icon
            name={summary.failed ? "x" : summary.stopped ? "stop" : "check"}
            size={14}
            stroke={2}
          />
        </span>
      {/if}
    </span>
    <span>{summary.live ? t("Working") : summary.failed ? t("Error") : summary.stopped ? t("Stopped") : t("Worked")} {duration}</span>
    <span class="sep" aria-hidden="true">·</span>
    <span>{actionLabel}</span>
    <span class="chevron" class:is-open={expanded}>
      <Icon name="chevron-right" size={13} />
    </span>
  </button>

  {#if summary.live && !expanded && latest}
    <div class="run-preview">
      {#each preview as action (action.id)}<RunActionRow {action} />{/each}
    </div>
  {/if}

  <div class="run-details" id={detailsId} use:expandable={expanded}>
    {#if summary.turns.length > 0}
      {#each summary.turns as turn (turn.index)}
        <div class="turn">
          {#if turn.reasoning.length > 0}
            <ReasoningBlock
              text={turn.reasoning}
              streaming={turn.reasoningStreaming ?? false}
              reasoningMs={turn.reasoningMs}
            />
          {/if}
          {#each groupActions(turn.actions) as entry (entry.kind === "group" ? entry.id : entry.action.id)}
            {#if entry.kind === "group"}
              <RunActionGroup group={entry} />
            {:else}
              <RunActionRow action={entry.action} />
            {/if}
          {/each}
        </div>
      {/each}
    {:else}
      {#each groupActions(summary.list) as entry (entry.kind === "group" ? entry.id : entry.action.id)}
        {#if entry.kind === "group"}
          <RunActionGroup group={entry} />
        {:else}
          <RunActionRow action={entry.action} />
        {/if}
      {/each}
    {/if}
    {#if summary.files.length > 0}
      <div class="file-changes">
        {#each summary.files as file (file.path)}
          <FileChangeChip {file} onOpen={onOpenChanges} />
        {/each}
      </div>
    {/if}
  </div>

  {#if summary.text}
    <p class="run-text">{summary.text}</p>
  {/if}

  {#if summary.files.length > 0 && !expanded}
    <button class="run-files" type="button" onclick={onOpenChanges}>
      <Icon name="file" size={13} />
      <span>{countLabel(summary.files.length, "file")}</span>
      <span class="add">+{additions}</span>
      {#if deletions}<span class="del">−{deletions}</span>{/if}
      <Icon name="chevron-right" size={12} />
    </button>
  {/if}
</div>

<style>
  .run {
    margin-top: 16px;
  }

  .run-summary {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    color: var(--muted);
    min-height: 36px;
    font-size: 12.5px;
    line-height: 1.4;
    text-align: left;
    transition:
      color var(--t-touch) var(--ease);
  }

  .run-summary:hover {
    color: var(--text-2);
  }

  .run-status {
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    flex: none;
  }

  .run-live-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--primary);
    animation:
      run-pulse 3.2s ease-in-out infinite,
      run-morph 4.2s var(--ease-jelly) infinite;
  }

  @keyframes run-pulse {
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 1;
    }
  }

  @keyframes run-morph {
    0%,
    100% {
      border-radius: 50%;
      transform: scale(1);
    }
    36% {
      border-radius: 64% 36% 52% 48%;
      transform: scale(1.22);
    }
    68% {
      border-radius: 42% 58% 38% 62%;
      transform: scale(0.9);
    }
  }

  .run-check {
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    color: var(--success);
  }

  .run-check.is-failed {
    color: var(--warning);
  }

  .run-check.is-stopped {
    color: var(--muted);
  }

  .chevron {
    display: grid;
    place-items: center;
    margin-left: 1px;
    transition: transform 180ms var(--ease);
  }

  .chevron.is-open {
    transform: rotate(90deg);
  }

  .sep {
    color: rgba(240, 239, 237, 0.24);
  }

  .run-details {
    display: grid;
    gap: 2px;
    margin: 2px 0 0 7px;
    padding-left: 15px;
    border-left: 1px solid var(--line-strong);
  }

  .turn {
    display: grid;
    gap: 2px;
  }

  .turn + .turn {
    margin-top: 6px;
  }

  .run-preview { margin-left: 22px; }
  .run-files { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding-inline: 7px; border-radius: 6px; color: var(--text-2); font-size: 12px; }
  .run-files:hover { background: var(--raised); }
  .run-text {
    max-width: 68ch;
    margin-top: 14px;
    color: var(--text-body);
    font-size: 16px;
    line-height: 1.65;
    text-wrap: pretty;
  }

  .file-changes {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
  }
</style>
