<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import type { Project } from "../lib/types";
  import Icon from "./Icon.svelte";
  import TaskRow from "./TaskRow.svelte";

  interface Props {
    project: Project;
    activeTask: string;
    onSelectTask: (id: string) => void;
    onRenameTask: (id: string, title: string) => void;
    onDeleteTask: (id: string) => void;
    onSelectProject?: ((project: Project, taskId?: string) => void) | undefined;
    onRemoveProject?: ((project: Project) => void) | undefined;
    onProjectTrust?: ((project: Project) => void) | undefined;
  }

  let { project, activeTask, onSelectTask, onRenameTask, onDeleteTask, onSelectProject, onRemoveProject, onProjectTrust }: Props = $props();
  const menuId = $props.id();
  let menu: HTMLDivElement;
  let row: HTMLDivElement;
  let top = $state(0);
  let left = $state(0);
  function position(): void {
    const bounds = row.getBoundingClientRect();
    top = Math.min(bounds.bottom + 2, window.innerHeight - 150);
    left = Math.min(bounds.left, window.innerWidth - 230);
  }
  function contextMenu(event: MouseEvent): void {
    event.preventDefault();
    position();
    menu.showPopover();
  }
  function selectTask(id: string): void {
    if (project.current || !onSelectProject) onSelectTask(id);
    else onSelectProject(project, id);
  }
</script>

<div class="project-row" class:is-current={project.current} bind:this={row} oncontextmenu={contextMenu} role="group" aria-label={project.name}>
  <button class="project-select" type="button" data-tooltip={project.path ?? project.name} onclick={() => onSelectProject?.(project)}>
  <Icon name="folder" />
  <span>{project.name}</span>
  {#if project.age}
    <span class="project-time">{project.age}</span>
  {/if}
  </button>
  <button class="project-options" type="button" aria-label={t("Project options")} data-tooltip={t("Project options")} popovertarget={menuId} onclick={position}><Icon name="more" size={14} /></button>
</div>
<div class="project-menu" id={menuId} bind:this={menu} popover="auto" style:top={`${top}px`} style:left={`${left}px`}>
  {#if project.projectRoot !== null}
    <p data-tooltip={project.path}>{project.path}</p>
    <button type="button" onclick={() => { menu.hidePopover(); onProjectTrust?.(project); }}>{t("Change project trust")}</button>
    <button type="button" onclick={() => { menu.hidePopover(); onRemoveProject?.(project); }}>{t("Remove from sidebar")}</button>
  {:else}
    <button type="button" onclick={() => { menu.hidePopover(); onSelectProject?.(project); }}>{t("Work without a project")}</button>
  {/if}
</div>
{#if project.error}<p class="project-error" data-tooltip={project.error}>{project.error}</p>{/if}

{#if project.tasks}
  <div class="project-tasks">
    {#each project.tasks as task (task.id)}
      <TaskRow
        {task}
        active={Boolean(project.current) && task.id === activeTask}
        actions={project.current ?? true}
        onSelect={selectTask}
        onRename={onRenameTask}
        onDelete={onDeleteTask}
      />
    {/each}
  </div>
{/if}

<style>
  .project-select { display: flex; align-items: center; flex: 1; gap: 6px; min-width: 0; padding: 0; color: inherit; background: transparent; border: 0; font: inherit; text-align: start; }
  .project-select > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .project-options { display: grid; place-items: center; width: 28px; height: 28px; flex: none; border: 0; border-radius: 6px; color: var(--muted); background: transparent; }
  button:hover { background: var(--raised); color: var(--text); }
  button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .project-menu { position: fixed; margin: 0; width: min(230px, calc(100vw - 24px)); padding: 6px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--text); box-shadow: 0 8px 24px #0006; }
  .project-menu p { max-height: 64px; overflow: auto; overflow-wrap: anywhere; margin: 6px 8px 10px; font-size: 12px; color: var(--muted); }
  .project-menu button { display: block; width: 100%; min-height: 32px; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--text-2); text-align: start; font: inherit; font-size: 13px; }
  .project-menu button:hover { background: var(--raised); }
  .project-error { margin: 4px 8px; color: var(--error); font-size: 12px; overflow-wrap: anywhere; }
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
