<script lang="ts">
  import type { Project } from "../lib/types";
  import Icon from "./Icon.svelte";
  import TaskRow from "./TaskRow.svelte";

  interface Props {
    project: Project;
    activeTask: string;
    onSelectTask: (id: string) => void;
    onRenameTask: (id: string, title: string) => void;
    onDeleteTask: (id: string) => void;
  }

  let { project, activeTask, onSelectTask, onRenameTask, onDeleteTask }: Props = $props();
</script>

<div class="project-row" class:is-current={project.current}>
  <Icon name="folder" />
  <span>{project.name}</span>
  {#if project.age}
    <span class="project-time">{project.age}</span>
  {/if}
</div>

{#if project.tasks}
  <div class="project-tasks">
    {#each project.tasks as task (task.id)}
      <TaskRow
        {task}
        active={task.id === activeTask}
        onSelect={onSelectTask}
        onRename={onRenameTask}
        onDelete={onDeleteTask}
      />
    {/each}
  </div>
{/if}

<style>
  .project-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: var(--control-sm-h);
    padding: 0 8px;
    border-radius: 6px;
    color: var(--text-2);
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    transition:
      background var(--t-touch) var(--ease),
      color var(--t-touch) var(--ease);
  }

  .project-row :global(.icon) {
    color: var(--muted);
    transition:
      transform 460ms var(--ease-jelly),
      color var(--t-touch) var(--ease);
  }

  .project-row:hover :global(.icon) {
    color: var(--text-2);
    transform: rotate(-7deg) scale(1.08);
  }

  .project-row > span:nth-child(2) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-row.is-current {
    color: var(--text);
  }

  .project-time {
    margin-left: auto;
    color: var(--muted);
    font-size: 12px;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .project-tasks {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
    margin: 2px 0 4px 16px;
  }
</style>
