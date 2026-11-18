<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import type { Project } from "../lib/types";
  import Icon from "./Icon.svelte";
  import MorphIcon from "./MorphIcon.svelte";
  import SidebarChatDrawer from "./SidebarChatDrawer.svelte";
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
    expanded: boolean;
    searching: boolean;
    onToggle: () => void;
    draggable: boolean;
    dragging: boolean;
    dropSide: "before" | "after" | undefined;
    onDragStart: (event: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (event: DragEvent, after: boolean) => void;
    onDragLeave: () => void;
    onDrop: (event: DragEvent) => void;
    onMoveUp: (() => void) | undefined;
    onMoveDown: (() => void) | undefined;
  }

  let {
    project, activeTask, onSelectTask, onRenameTask, onDeleteTask, onSelectProject,
    onRemoveProject, onProjectTrust, expanded, searching, onToggle, draggable, dragging,
    dropSide, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, onMoveUp, onMoveDown,
  }: Props = $props();
  const id = $props.id();
  const menuId = `${id}-menu`;
  const tasksId = `${id}-tasks`;
  const initialLimit = 5;
  const pageSize = 7;
  let limit = $state(initialLimit);
  const tasks = $derived(project.tasks ?? []);
  const visibleTasks = $derived(searching ? tasks : tasks.slice(0, limit));
  const newTaskLabel = $derived(t("New task in {0}", [project.name]));
  let menu: HTMLDivElement;
  let row: HTMLDivElement;
  let options: HTMLButtonElement;
  let top = $state(0);
  let left = $state(0);
  function position(): void {
    const bounds = row.getBoundingClientRect();
    top = Math.min(bounds.bottom + 2, window.innerHeight - menu.offsetHeight - 8);
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
  function showMore(): void {
    limit = limit === initialLimit ? pageSize : limit + pageSize;
  }
  function dragOver(event: DragEvent): void {
    const bounds = row.getBoundingClientRect();
    onDragOver(event, event.clientY >= bounds.top + bounds.height / 2);
  }
  function dragLeave(event: DragEvent): void {
    if (event.currentTarget instanceof Node && event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)) return;
    onDragLeave();
  }
  function move(action: () => void): void {
    menu.hidePopover();
    action();
    options.focus();
  }
</script>

<div class="project-group" data-project-id={project.id} data-drop={dropSide}
  role="presentation" ondragover={dragOver} ondragleave={dragLeave} ondrop={onDrop}>
  <div class="project-row" class:is-current={project.current} class:is-dragging={dragging}
    bind:this={row} oncontextmenu={contextMenu} role="group" aria-label={project.name}>
    <button class="project-select" type="button" data-tooltip={project.path ?? project.name}
      aria-expanded={expanded} aria-controls={tasksId} disabled={searching}
      {draggable} ondragstart={onDragStart} ondragend={onDragEnd} onclick={onToggle}>
      <MorphIcon name={expanded ? "folder-open" : "folder"} size={16} />
      <span>{project.name}</span>
      {#if project.age}
        <span class="project-time">{project.age}</span>
      {/if}
    </button>
    <button class="project-action project-new" type="button" aria-label={newTaskLabel}
      data-tooltip={newTaskLabel} onclick={() => onSelectProject?.(project)}>
      <Icon name="edit" size={14} />
    </button>
    <button class="project-action project-options" type="button" aria-label={t("Project options")}
      data-tooltip={t("Project options")} popovertarget={menuId} bind:this={options} onclick={position}>
      <Icon name="more" size={14} />
    </button>
  </div>

  <div class="project-menu" id={menuId} bind:this={menu} popover="auto" style:top={`${top}px`} style:left={`${left}px`}
    ontoggle={(event) => { if (event.newState === "open") position(); }}>
    <p data-tooltip={project.path}>{project.path}</p>
    {#if onMoveUp}<button type="button" onclick={() => move(onMoveUp!)}>{t("Move up")}</button>{/if}
    {#if onMoveDown}<button type="button" onclick={() => move(onMoveDown!)}>{t("Move down")}</button>{/if}
    <button type="button" onclick={() => { menu.hidePopover(); onProjectTrust?.(project); }}>{t("Change project trust")}</button>
    <button type="button" onclick={() => { menu.hidePopover(); onRemoveProject?.(project); }}>{t("Remove from sidebar")}</button>
  </div>
  {#if project.error}<p class="project-error" data-tooltip={project.error}>{project.error}</p>{/if}

  <SidebarChatDrawer id={tasksId} open={expanded} {searching}>
    {#if tasks.length}
      <div class="project-tasks">
        {#each visibleTasks as task (task.id)}
          <TaskRow
            {task}
            active={Boolean(project.current) && task.id === activeTask}
            actions={project.current ?? true}
            onSelect={selectTask}
            onRename={onRenameTask}
            onDelete={onDeleteTask}
          />
        {/each}
        {#if !searching && (tasks.length > limit || (tasks.length > initialLimit && limit > initialLimit))}
          <div class="task-pagination">
            {#if tasks.length > limit}
              <button type="button" onclick={showMore}>{t("Show More")}</button>
            {/if}
            {#if limit > initialLimit}
              <button type="button" onclick={() => limit = initialLimit}>{t("Show Less")}</button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </SidebarChatDrawer>
</div>

<style>
  .project-group { position: relative; display: flow-root; }
  .project-group[data-drop]::after {
    position: absolute; inset-inline: 0; z-index: 1; height: 2px;
    border-radius: 1px; background: var(--primary); pointer-events: none; content: "";
  }
  .project-group[data-drop="before"]::after { top: 0; }
  .project-group[data-drop="after"]::after { bottom: 0; }
  .project-row.is-dragging { opacity: 0.55; }
  .project-select { display: flex; align-items: center; flex: 1; gap: 8px; min-width: 0; height: 100%; padding: 0 8px; border-radius: 6px; color: inherit; background: transparent; border: 0; font: inherit; text-align: start; cursor: pointer; }
  .project-select[draggable="true"] { cursor: grab; }
  .project-select[draggable="true"]:active { cursor: grabbing; }
  .project-select :global(.icon) { flex: none; }
  .project-select > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .project-action { display: grid; place-items: center; width: var(--control-sm-h); height: var(--control-sm-h); flex: none; border: 0; border-radius: 6px; color: var(--muted); background: transparent; }
  @media (hover: hover) {
    .project-action { opacity: 0; pointer-events: none; }
    .project-row:hover .project-action,
    .project-row:has(:focus-visible) .project-action,
    .project-group:has(> .project-menu:popover-open) > .project-row .project-action {
      opacity: 1;
      pointer-events: auto;
    }
  }
  button:enabled:hover { background: var(--raised); color: var(--text); }
  button:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
  .project-menu { position: fixed; margin: 0; width: min(230px, calc(100vw - 24px)); padding: 6px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--text); box-shadow: 0 8px 24px #0006; }
  .project-menu p { max-height: 64px; overflow: auto; overflow-wrap: anywhere; margin: 6px 8px 10px; font-size: 12px; color: var(--muted); }
  .project-menu button { display: block; width: 100%; min-height: 32px; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--text-2); text-align: start; font: inherit; font-size: 13px; }
  .project-menu button:hover { background: var(--raised); }
  .project-error { margin: 4px 8px; color: var(--error); font-size: 12px; overflow-wrap: anywhere; }
  .project-row {
    display: flex;
    align-items: center;
    gap: 2px;
    width: 100%;
    height: var(--control-sm-h);
    padding-inline: 0 4px;
    border-radius: 6px;
    color: var(--text-2);
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    transition:
      background var(--t-touch) var(--ease),
      color var(--t-touch) var(--ease);
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
    --task-row-height: calc((var(--control-h) + var(--control-sm-h)) / 2);
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1px;
    margin: 2px 0 4px 16px;
  }

  .task-pagination {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 4px;
  }

  .task-pagination button {
    min-height: var(--control-sm-h);
    padding-inline: 8px;
    border-radius: 6px;
    color: var(--text-2);
    font-size: 13px;
  }
</style>
