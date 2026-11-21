<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import type { Project } from "../lib/types";
  import Icon from "./Icon.svelte";
  import SidebarProjects from "./SidebarProjects.svelte";
  import SidebarUser from "./SidebarUser.svelte";
  import TwinCharacter from "./twin/TwinCharacter.svelte";

  interface Props {
    hidden: boolean;
    projects: Project[];
    activeTask: string;
    user: { name: string; initial: string };
    onRenameUser: (name: string) => void;
    onOpenSettings: () => void;
    onSelectTask: (id: string) => void;
    onNewTask: () => void;
    onRenameTask: (id: string, title: string) => void;
    onDeleteTask: (id: string) => void;
    onSearch: (query: string) => void;
    onSelectProject?: (project: Project, taskId?: string) => void;
    onRemoveProject?: (project: Project) => void;
    onProjectTrust?: (project: Project) => void;
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
    onRenameUser,
    onOpenSettings,
    onSelectTask,
    onNewTask,
    onRenameTask,
    onDeleteTask,
    onSearch,
    onSelectProject, onRemoveProject, onProjectTrust,
    twinActive = false,
    onOpenTwin,
    onOpenDictionary,
    onOpenModules,
  }: Props = $props();

  let query = $state("");

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

</script>

<aside class="sidebar" inert={hidden} aria-label={t("Projects and tasks")}>
  <div class="side-top">
    <button class="side-action" type="button" data-tooltip={t("New task")} onclick={onNewTask}>
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
          data-tooltip={t("Clear search")}
          onclick={clearSearch}
        >
          <Icon name="x" size={13} />
        </button>
      {/if}
    </div>
  </div>

  <nav class="side-services" aria-label={t("Project tools")}>
    {#if onOpenTwin}<button class="side-action side-action--twin" class:is-current={twinActive} aria-pressed={twinActive} type="button" onclick={onOpenTwin}><span class="side-twin-icon" aria-hidden="true"><TwinCharacter compact /></span><span>Twin</span></button>{/if}
    {#if onOpenDictionary}<button class="side-action" type="button" onclick={onOpenDictionary}><Icon name="brain" size={18} /><span>{t("Memory and dictionary")}</span></button>{/if}
    {#if onOpenModules}<button class="side-action" type="button" onclick={onOpenModules}><Icon name="layers" size={18} /><span>{t("Modules")}</span></button>{/if}
  </nav>
  <SidebarProjects {projects} {activeTask} {query} {hidden}
    {onSelectTask} {onRenameTask} {onDeleteTask}
    {onSelectProject} {onRemoveProject} {onProjectTrust} />

  <SidebarUser {hidden} {user} onRename={onRenameUser} {onOpenSettings} />
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
      color var(--t-touch) var(--ease);
  }

  .side-action :global(.icon) {
    flex: none;
    color: var(--muted);
    transition: color var(--t-touch) var(--ease);
  }

  .side-twin-icon {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    flex: none;
    overflow: visible;
  }

  .side-twin-icon :global(.twin-character.compact) {
    width: 22px;
    height: 22px;
  }

  .side-action:hover {
    background: rgba(240, 239, 237, 0.04);
    color: var(--text);
  }

  .side-action:hover :global(.icon) {
    color: var(--text-2);
  }

  .side-search {
    display: flex;
    align-items: center;
    gap: 6px;
    height: var(--control-h);
    padding: 0 0 0 8px;
    border-radius: 7px;
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
</style>
