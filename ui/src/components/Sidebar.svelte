<script lang="ts">
  import { i18n, t } from "../lib/i18n.svelte";
  import { onMount, tick } from "svelte";
  import type { Project } from "../lib/types";
  import Icon from "./Icon.svelte";
  import ProjectGroup from "./ProjectGroup.svelte";
  import TwinCharacter from "./twin/TwinCharacter.svelte";

  interface Props {
    hidden: boolean;
    projects: Project[];
    activeTask: string;
    user: { name: string; initial: string };
    onSelectTask: (id: string) => void;
    onNewTask: () => void;
    onRenameTask: (id: string, title: string) => void;
    onDeleteTask: (id: string) => void;
    onSearch: (query: string) => void;
    twinActive?: boolean;
    onOpenTwin?: () => void;
    onOpenDictionary?: () => void;
    onOpenModules?: () => void;
  }

  let {
    hidden,
    projects,
    activeTask,
    user,
    onSelectTask,
    onNewTask,
    onRenameTask,
    onDeleteTask,
    onSearch,
    twinActive = false,
    onOpenTwin,
    onOpenDictionary,
    onOpenModules,
  }: Props = $props();

  let projectsPane: HTMLDivElement;
  let gooReady = $state(false);
  let gooTop = $state(0);
  let gooLeft = $state(10);
  let gooWidth = $state(0);
  let gooHeight = $state(34);
  let query = $state("");

  const visibleProjects = $derived.by(() => {
    const needle = query.trim().toLocaleLowerCase(i18n.locale);
    if (!needle) return projects;
    const result: Project[] = [];
    for (const project of projects) {
      const tasks = project.tasks ?? [];
      const projectMatch = project.name.toLocaleLowerCase(i18n.locale).includes(needle);
      const matched = projectMatch
        ? tasks
        : tasks.filter((task) => {
            const title = task.title.toLocaleLowerCase(i18n.locale);
            const prompt = task.lastPrompt?.toLocaleLowerCase(i18n.locale) ?? "";
            return title.includes(needle) || prompt.includes(needle);
          });
      if (matched.length > 0) result.push({ ...project, tasks: matched });
    }
    return result;
  });

  function clearSearch(): void {
    query = "";
    onSearch("");
  }

  function onSearchKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.isComposing) return;
    event.stopPropagation();
    if (query) {
      event.preventDefault();
      clearSearch();
    }
  }

  $effect(() => {
    const value = query;
    const timer = setTimeout(() => onSearch(value), 200);
    return () => clearTimeout(timer);
  });

  function measure(): void {
    if (!projectsPane || hidden) {
      gooReady = false;
      return;
    }
    const active = projectsPane.querySelector<HTMLElement>("[data-task-active='true']");
    if (!active) {
      gooReady = false;
      return;
    }
    const pane = projectsPane.getBoundingClientRect();
    const row = active.getBoundingClientRect();
    gooTop = row.top - pane.top + projectsPane.scrollTop;
    gooLeft = row.left - pane.left;
    gooWidth = row.width;
    gooHeight = row.height;
    if (!gooReady) requestAnimationFrame(() => (gooReady = true));
  }

  $effect(() => {
    activeTask;
    projects;
    query;
    hidden;
    void tick().then(measure);
  });

  onMount(() => {
    const observer = new ResizeObserver(measure);
    observer.observe(projectsPane);
    return () => observer.disconnect();
  });
</script>

<aside class="sidebar" class:is-hidden={hidden} inert={hidden} aria-label={t("Projects and tasks")}>
  <div class="side-top">
    <button class="side-action" type="button" title={t("New task")} onclick={onNewTask}>
      <Icon name="plus" />
      <span>{t("New task")}</span>
    </button>
    <div class="side-search">
      <Icon name="search" size={13} />
      <input
        bind:value={query}
        type="text"
        placeholder={t("Search tasks")}
        aria-label={t("Search tasks")}
        onkeydown={onSearchKeydown}
      />
      {#if query}
        <button
          class="search-clear"
          type="button"
          aria-label={t("Clear search")}
          title={t("Clear search")}
          onclick={clearSearch}
        >
          <Icon name="x" size={13} />
        </button>
      {/if}
    </div>
  </div>

  <nav class="side-services" aria-label={t("Project tools")}>
    {#if onOpenTwin}<button class="side-action" class:is-current={twinActive} aria-pressed={twinActive} type="button" onclick={onOpenTwin}><TwinCharacter compact /><span>Twin</span></button>{/if}
    {#if onOpenDictionary}<button class="side-action" type="button" onclick={onOpenDictionary}><Icon name="brain" size={18} /><span>{t("Memory and dictionary")}</span></button>{/if}
    {#if onOpenModules}<button class="side-action" type="button" onclick={onOpenModules}><Icon name="layers" size={18} /><span>{t("Modules")}</span></button>{/if}
  </nav>
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
    {#each visibleProjects as project (project.id)}
      <ProjectGroup
        {project}
        {activeTask}
        {onSelectTask}
        {onRenameTask}
        {onDeleteTask}
      />
    {:else}
      <p class="side-empty" role="status">{t("No results")}</p>
    {/each}
  </div>

  <footer class="side-user">
    <span class="avatar" aria-hidden="true">{user.initial}</span>
    <strong class="user-name">{user.name}</strong>
  </footer>
</aside>

<style>
  .side-services { display: grid; gap: 2px; padding: 8px; }
  .side-services .side-action.is-current { background: var(--raised); color: var(--text); }
  .sidebar {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: clip;
    background: var(--sidebar);
    border-right: 1px solid var(--line);
    user-select: none;
    transition:
      opacity 420ms var(--ease),
      transform 720ms var(--ease-goo),
      visibility 0s;
  }

  .sidebar.is-hidden {
    opacity: 0;
    pointer-events: none;
    transform: translateX(-14px) scale(0.99);
    visibility: hidden;
    transition:
      opacity 420ms var(--ease),
      transform 720ms var(--ease-goo),
      visibility 0s 720ms;
  }

  .side-top {
    display: grid;
    gap: 2px;
    padding: 8px 8px 4px;
  }

  .side-action {
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--control-h);
    padding: 0 8px;
    border-radius: 7px;
    color: var(--text-2);
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    transition:
      background var(--t-touch) var(--ease),
      color var(--t-touch) var(--ease),
      border-radius 460ms var(--ease-jelly);
  }

  .side-action :global(.icon) {
    color: var(--muted);
    transition:
      transform 460ms var(--ease-jelly),
      color var(--t-touch) var(--ease);
  }

  .side-action:hover {
    border-radius: 12px;
    background: rgba(240, 239, 237, 0.04);
    color: var(--text);
  }

  .side-action:hover :global(.icon) {
    color: var(--text-2);
    transform: scale(1.16);
  }

  .side-search {
    display: flex;
    align-items: center;
    gap: 6px;
    height: var(--control-h);
    padding: 0 0 0 8px;
    border-radius: 8px;
    background: rgba(240, 239, 237, 0.035);
    transition:
      background 220ms var(--ease),
      box-shadow 220ms var(--ease);
  }

  .side-search:focus-within {
    background: rgba(240, 239, 237, 0.05);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary) 55%, transparent);
  }

  .side-search :global(.icon) {
    flex: none;
    color: var(--muted);
  }

  .side-search input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    outline: 0;
    background: none;
    color: var(--text);
    font-size: 13px;
  }

  .side-search input::placeholder {
    color: var(--muted);
  }

  .search-clear {
    position: relative;
    display: grid;
    place-items: center;
    width: var(--control-h);
    height: 100%;
    flex: none;
    border-radius: 6px;
    color: var(--muted);
  }

  .search-clear:hover {
    background: rgba(240, 239, 237, 0.06);
    color: var(--text-2);
  }

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

  .side-user {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 48px;
    flex: none;
    padding: 0 12px;
  }

  .avatar {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: 50%;
    background: var(--raised-hover);
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
  }

  .user-name {
    overflow: hidden;
    min-width: 0;
    font-size: 13.5px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
