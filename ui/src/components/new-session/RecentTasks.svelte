<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { onMount } from "svelte";
  import { RECENT_STATUS, taskAge, type NewSessionTask } from "../../lib/new-session";
  import { timeTitle } from "../../lib/ui-polish";
  import Icon from "../Icon.svelte";

  interface Props {
    tasks: NewSessionTask[];
    projectName?: string;
    onSelect: (id: string) => void;
  }

  let { tasks, projectName = "", onSelect }: Props = $props();

  let now = $state(new Date());
  onMount(() => {
    const timer = setInterval(() => (now = new Date()), 60_000);
    return () => clearInterval(timer);
  });
</script>

{#if tasks.length === 0}
  <div class="ns-empty">
    <p class="ns-recent-empty">{t("Tasks for this project will appear here.")}</p>
  </div>
{:else}
  <div class="ns-task-list">
    {#each tasks as task (task.id)}
      <button class="ns-task" type="button" onclick={() => onSelect(task.id)}>
        <span class="ns-task-icon is-{task.status}" aria-hidden="true">
          <Icon name={RECENT_STATUS[task.status].icon} size={16} />
        </span>
        <span class="ns-task-main">
          <span class="ns-task-title" title={task.title}>{task.title}</span>
          <span class="ns-task-meta">
            {#if task.project !== projectName}
              <span class="ns-task-project" title={task.project}>{task.project}</span>
              <span class="ns-task-sep" aria-hidden="true">·</span>
            {/if}
            <span class="ns-task-status is-{task.status}">{RECENT_STATUS[task.status].label}</span>
            <span class="ns-task-sep" aria-hidden="true">·</span>
            <time class="ns-task-age" datetime={task.updatedAt} title={timeTitle(task.updatedAt, now)}>{taskAge(task.updatedAt, now)}</time>
          </span>
        </span>
        <span class="ns-task-open" aria-hidden="true"><Icon name="chevron-right" size={15} /></span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .ns-empty { padding-block: 8px; color: var(--muted); font-size: 12px; line-height: 1.6; }
  .ns-task-list { display: grid; gap: 2px; margin-inline: -10px; }
  .ns-task {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) 16px;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 58px;
    padding: 8px 10px;
    border-radius: 10px;
    text-align: start;
    transition: background var(--t-touch) var(--ease);
  }
  .ns-task:hover, .ns-task:focus-visible { background: var(--surface); }
  .ns-task-main { display: grid; gap: 3px; min-width: 0; }
  .ns-task-title { overflow: hidden; color: var(--text); font-size: 13px; font-weight: 500; line-height: 1.5; text-overflow: ellipsis; white-space: nowrap; }
  .ns-task-meta { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--muted); font-size: 12px; line-height: 1.4; }
  .ns-task-project { max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ns-task-sep { flex: none; }
  .ns-task-age { white-space: nowrap; }
  .ns-task-icon { display: grid; place-items: center; color: var(--muted); }
  .ns-task-icon.is-working { color: var(--primary); }
  .ns-task-status.is-waiting, .ns-task-icon.is-waiting { color: var(--warning); }
  .ns-task-status.is-error, .ns-task-icon.is-error { color: var(--error); }
  .ns-task-open { display: grid; color: var(--muted); opacity: 0; }
  .ns-task:hover .ns-task-open, .ns-task:focus-visible .ns-task-open { opacity: 1; }
  @media (prefers-reduced-motion: reduce) { .ns-task { transition: none; } }
</style>
