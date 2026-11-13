<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { expandable } from "../lib/motion";
  import type { ActionGroup } from "../lib/run/action-groups";
  import Icon from "./Icon.svelte";
  import RunActionRow from "./RunActionRow.svelte";

  let { group }: { group: ActionGroup } = $props();
  let expanded = $state(false);
  let wasFailed = false;

  const uid = $props.id();
  const listId = `action-group-${uid}`;

  $effect(() => {
    // A failed call inside must not hide behind a closed group.
    if (group.failed && !wasFailed) expanded = true;
    wasFailed = group.failed;
  });
</script>

<div class="group" class:is-failed={group.failed}>
  <button
    class="group-line"
    type="button"
    aria-expanded={expanded}
    aria-controls={listId}
    title={expanded ? t("Collapse calls") : t("Show each call")}
    onclick={() => (expanded = !expanded)}
  >
    <Icon name="search" size={14} />
    <span class="group-label">{group.label}</span>
    <span class="group-time">{group.duration}</span>
    <span class="chevron" class:is-open={expanded}>
      <Icon name="chevron-right" size={13} />
    </span>
  </button>

  <div class="group-list" id={listId} use:expandable={expanded}>
    {#each group.actions as action (action.id)}
      <RunActionRow {action} />
    {/each}
  </div>
</div>

<style>
  .group {
    min-width: 0;
  }

  .group-line {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 30px;
    margin-left: -7px;
    padding: 0 7px;
    border-radius: 6px;
    color: var(--text-2);
    font-size: 12.5px;
    text-align: left;
    transition:
      background 150ms var(--ease);
  }

  .group-line:hover {
    border-radius: 10px;
    background: rgba(240, 239, 237, 0.035);
  }

  .group-line:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 1px;
  }

  .group-line :global(.icon) {
    color: var(--muted);
    transition: transform 180ms var(--ease);
  }


  .group.is-failed .group-label {
    color: var(--warning);
  }

  .group-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .group-time {
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

  .group-list {
    min-width: 0;
    margin-left: 7px;
    padding-left: 10px;
    border-left: 1px solid rgba(240, 239, 237, 0.08);
  }
</style>
