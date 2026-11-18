<script lang="ts">
  import { onMount, tick } from "svelte";
  import { i18n, t } from "../lib/i18n.svelte";
  import { orderSidebarFolders, readSidebarProjects, saveSidebarProjects, searchSidebarProjects, searchSidebarTasks } from "../lib/sidebar-projects";
  import type { Project } from "../lib/types";
  import Icon from "./Icon.svelte";
  import ProjectGroup from "./ProjectGroup.svelte";
  import SidebarChatDrawer from "./SidebarChatDrawer.svelte";
  import TaskRow from "./TaskRow.svelte";

  interface Props {
    projects: Project[];
    activeTask: string;
    query: string;
    hidden: boolean;
    onSelectTask: (id: string) => void;
    onRenameTask: (id: string, title: string) => void;
    onDeleteTask: (id: string) => void;
    onSelectProject?: ((project: Project, taskId?: string) => void) | undefined;
    onRemoveProject?: ((project: Project) => void) | undefined;
    onProjectTrust?: ((project: Project) => void) | undefined;
  }
  let { projects, activeTask, query, hidden, ...actions }: Props = $props();

  let prefs = $state(readSidebarProjects());
  let dragging = $state<string | null>(null);
  let drop = $state<{ id: string; after: boolean } | null>(null);

  const folders = $derived(orderSidebarFolders(projects, prefs.order));
  const projectless = $derived(projects.find((project) => project.projectRoot === null));
  const searching = $derived(Boolean(query.trim()));
  const visible = $derived(searchSidebarProjects(folders, query, i18n.locale));
  const standalone = $derived(searchSidebarTasks(
    projectless?.tasks ?? [], query.trim().toLocaleLowerCase(i18n.locale), i18n.locale,
  ));
  const canReorder = $derived(!searching && folders.length > 1);
  const standaloneId = $props.id();
  const standaloneExpanded = $derived(searching || !prefs.standaloneCollapsed);

  function toggleStandalone(): void {
    prefs.standaloneCollapsed = !prefs.standaloneCollapsed;
    saveSidebarProjects(prefs);
  }

  function selectStandalone(id: string): void {
    if (projectless && !projectless.current && actions.onSelectProject) {
      actions.onSelectProject(projectless, id);
    } else actions.onSelectTask(id);
  }

  function toggle(id: string): void {
    prefs.collapsed = prefs.collapsed.includes(id)
      ? prefs.collapsed.filter((value) => value !== id)
      : [...prefs.collapsed, id];
    saveSidebarProjects(prefs);
  }

  function move(id: string, target: string, after: boolean): void {
    if (id === target) return;
    const order = folders.map((project) => project.id);
    const from = order.indexOf(id);
    if (from < 0 || !order.includes(target)) return;
    order.splice(from, 1);
    order.splice(order.indexOf(target) + Number(after), 0, id);
    if (folders.every((project, index) => project.id === order[index])) return;
    prefs.order = order;
    saveSidebarProjects(prefs);
  }

  function startDrag(event: DragEvent, id: string): void {
    if (!event.dataTransfer || !canReorder) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-flecten-project", "move");
    dragging = id;
  }

  function endDrag(): void {
    dragging = null;
    drop = null;
  }

  function hover(event: DragEvent, id: string, after: boolean): void {
    if (!dragging || dragging === id || !event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (drop?.id !== id || drop.after !== after) drop = { id, after };
  }

  function finishDrag(event: DragEvent, id: string): void {
    if (dragging && drop?.id === id) {
      event.preventDefault();
      move(dragging, id, drop.after);
    }
    endDrag();
  }

  let projectsPane: HTMLDivElement;
  let projectsList: HTMLDivElement;
  let gooReady = $state(false);
  let gooTop = $state(0);
  let gooLeft = $state(10);
  let gooWidth = $state(0);
  let gooHeight = $state(34);

  function measure(): void {
    const active = !hidden && projectsPane?.querySelector<HTMLElement>("[data-task-active='true']");
    if (!active) {
      gooReady = false;
      return;
    }
    // The selection follows the row's final layout, not its animated transform.
    let top = 0;
    let left = 0;
    for (let row: HTMLElement | null = active; row && row !== projectsPane;) {
      top += row.offsetTop;
      left += row.offsetLeft;
      row = row.offsetParent instanceof HTMLElement ? row.offsetParent : null;
    }
    gooTop = top;
    gooLeft = left;
    gooWidth = active.offsetWidth;
    gooHeight = active.offsetHeight;
    if (!gooReady) requestAnimationFrame(() => (gooReady = active.isConnected && !hidden));
  }

  $effect(() => {
    activeTask;
    visible;
    standalone;
    prefs.collapsed;
    standaloneExpanded;
    hidden;
    void tick().then(measure);
  });

  onMount(() => {
    const observer = new ResizeObserver(measure);
    observer.observe(projectsPane);
    observer.observe(projectsList);
    return () => observer.disconnect();
  });
</script>

<div class="side-projects" bind:this={projectsPane}>
  <span
    class="task-goo"
    class:is-ready={gooReady}
    aria-hidden="true"
    style={`--goo-top: ${gooTop}px; --goo-left: ${gooLeft}px; --goo-width: ${gooWidth}px; --goo-height: ${gooHeight}px`}
  >
    <span class="task-goo-trail"></span>
    <span class="task-goo-pill"></span>
  </span>
  <div bind:this={projectsList}>
    {#each visible as project, index (project.id)}
      {@const before = canReorder ? folders[index - 1] : undefined}
      {@const after = canReorder ? folders[index + 1] : undefined}
      <ProjectGroup
        {project}
        {activeTask}
        {...actions}
        expanded={searching || !prefs.collapsed.includes(project.id)}
        {searching}
        onToggle={() => toggle(project.id)}
        draggable={canReorder}
        dragging={dragging === project.id}
        dropSide={drop?.id === project.id ? (drop.after ? "after" : "before") : undefined}
        onDragStart={(event) => startDrag(event, project.id)}
        onDragEnd={endDrag}
        onDragOver={(event, after) => { if (canReorder) hover(event, project.id, after); }}
        onDragLeave={() => { if (drop?.id === project.id) drop = null; }}
        onDrop={(event) => finishDrag(event, project.id)}
        onMoveUp={before && (() => move(project.id, before.id, false))}
        onMoveDown={after && (() => move(project.id, after.id, true))}
      />
    {/each}
    {#if standalone.length}
      <div class="standalone-section" class:after-folders={visible.length > 0}>
        <button
          class="standalone-toggle"
          type="button"
          aria-expanded={standaloneExpanded}
          aria-controls={standaloneId}
          disabled={searching}
          onclick={toggleStandalone}
        >
          <span>{t("Separate chats")}</span>
          <Icon name={standaloneExpanded ? "chevron-down" : "chevron-right"} size={14} />
        </button>
        <SidebarChatDrawer id={standaloneId} open={standaloneExpanded} {searching}>
          <div class="standalone-tasks">
            {#each standalone as task (task.id)}
              <TaskRow
                {task}
                active={Boolean(projectless?.current) && task.id === activeTask}
                actions={Boolean(projectless?.current)}
                onSelect={selectStandalone}
                onRename={actions.onRenameTask}
                onDelete={actions.onDeleteTask}
              />
            {/each}
          </div>
        </SidebarChatDrawer>
      </div>
    {:else if searching && !visible.length}
      <p class="side-empty" role="status">{t("No results")}</p>
    {/if}
  </div>
</div>

<style>
  .side-projects {
    position: relative;
    flex: 1;
    min-height: 0;
    padding: 4px 8px 8px;
    overflow-y: auto;
  }

  .side-empty {
    padding: 12px 10px;
    color: var(--muted);
    font-size: 12.5px;
    line-height: 1.4;
    text-wrap: pretty;
  }

  .standalone-section.after-folders { margin-block-start: var(--space-6); }

  .standalone-toggle {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--control-h);
    padding-inline: var(--space-2);
    border-radius: 6px;
    color: var(--text-2);
    font-size: 13px;
    font-weight: 600;
    text-align: start;
  }

  .standalone-toggle:enabled:hover { background: var(--raised); color: var(--text); }
  .standalone-toggle:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
  .standalone-toggle :global(.icon) { flex: none; color: var(--muted); }
  .standalone-tasks { --task-row-height: var(--control-sm-h); }

  .task-goo {
    position: absolute;
    inset: 0;
    z-index: 0;
    opacity: 0;
    pointer-events: none;
    filter: url(#goo);
    transition: opacity 240ms var(--ease);
  }

  .task-goo.is-ready {
    opacity: 1;
  }

  .side-projects:has(:global([data-chat-reveal] [data-task-active="true"])) .task-goo {
    opacity: 0;
  }

  .task-goo:not(.is-ready) .task-goo-pill,
  .task-goo:not(.is-ready) .task-goo-trail {
    transition: none;
  }

  .task-goo-pill,
  .task-goo-trail {
    position: absolute;
    top: 0;
    left: 0;
    width: var(--goo-width);
    height: var(--goo-height);
    translate: var(--goo-left) var(--goo-top);
    border-radius: 7px;
    background: var(--raised);
    transition:
      translate 520ms var(--ease-jelly),
      width 520ms var(--ease-jelly),
      height 520ms var(--ease-jelly);
  }

  .task-goo-trail {
    transition:
      translate 760ms var(--ease-goo),
      width 760ms var(--ease-goo),
      height 760ms var(--ease-goo);
  }
</style>
