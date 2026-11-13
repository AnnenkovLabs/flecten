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
      />
    </div>

    <section class="ns-launch" aria-labelledby="new-session-heading">
      <header class="ns-intro">
        <h1 class="ns-greeting" id="new-session-heading">{t("What needs to be done?")}</h1>
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
