<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import type { Snippet } from "svelte";
  import {
    filterRecent,
    type NewSessionProject,
    type NewSessionTask,
    RECENT_STATUS,
  } from "../../lib/new-session";
  import ProjectPicker from "./ProjectPicker.svelte";
  import RecentTasks from "./RecentTasks.svelte";
  import "./new-session.css";

  interface Props {
    project: NewSessionProject | null;
    recentProjects?: NewSessionProject[];
    tasks?: NewSessionTask[];
    busy?: boolean;
    composer: Snippet;
    onSelectProject: (id: string) => void;
    onChooseFolder: () => void;
    onChooseProjectless: () => void;
    onSelectTask: (id: string) => void;
  }

  let {
    project,
    recentProjects = [],
    tasks = [],
    busy = false,
    composer,
    onSelectProject,
    onChooseFolder,
    onChooseProjectless,
    onSelectTask,
  }: Props = $props();

  let attentionOnly = $state(false);
  const attention = $derived(tasks.filter((task) => RECENT_STATUS[task.status].needsAttention));
  const recent = $derived(filterRecent(attentionOnly ? attention : tasks, "", 5));

  $effect(() => {
    if (attention.length === 0) attentionOnly = false;
  });
</script>

<section class="ns" aria-label={t("New task")} aria-busy={busy || undefined}>
  <div class="ns-frame">
    <div class="ns-project-context">
      <ProjectPicker
        current={project}
        recent={recentProjects}
        onSelect={onSelectProject}
        {onChooseFolder}
        {onChooseProjectless}
      />
    </div>

    <section class="ns-launch" aria-labelledby="new-session-heading">
      <header class="ns-intro">
        <h1 class="ns-greeting" id="new-session-heading">{t("What needs to be done?")}</h1>
        {#if !project}
          <p class="ns-project-empty">{t("Add a folder to work on a project. You can also start a task without one.")}</p>
          <button class="ns-add-folder" type="button" onclick={onChooseFolder}>{t("Add folder")}</button>
        {/if}
      </header>

      {@render composer()}
    </section>

    <section class="ns-recent" aria-labelledby="new-session-recent">
      <div class="ns-recent-head">
        <h2 id="new-session-recent">{t("Back to work")}</h2>
        {#if attention.length > 0}
          <button
            class="ns-attention-filter"
            class:is-active={attentionOnly}
            type="button"
            aria-pressed={attentionOnly}
            onclick={() => (attentionOnly = !attentionOnly)}
          > {t("Needs attention")} <span>{attention.length}</span>
          </button>
        {/if}
      </div>
      <RecentTasks tasks={recent} projectName={project?.name ?? ""} onSelect={onSelectTask} />
    </section>
  </div>
</section>

<style>
  .ns-project-empty { max-width: 480px; margin: 14px 0; color: var(--text-2); font-size: 14px; line-height: 1.6; text-wrap: pretty; }
  .ns-add-folder { min-height: 32px; padding: 6px 12px; margin-bottom: 16px; border: 0; border-radius: 7px; background: var(--raised); color: var(--text); font: inherit; font-size: 13px; }
  .ns-add-folder:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
</style>
