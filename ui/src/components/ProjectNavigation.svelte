<script lang="ts">
  import { requestAgent } from "../lib/desktop";
  import { t } from "../lib/i18n.svelte";
  import type { RunStore } from "../lib/run.svelte";
  import { deleteTask, renameTask } from "../lib/run-tasks";
  import { toast } from "../lib/toast.svelte";
  import type { Project } from "../lib/types";
  import ProjectTrust from "./ProjectTrust.svelte";
  import Sidebar from "./Sidebar.svelte";

  let { run, hidden, onSelectTask, onNewTask, twinActive, onOpenTwin, onOpenDictionary, onOpenModules, onOpenSettings }: {
    run: RunStore; hidden: boolean; onSelectTask: (id: string) => void; onNewTask: () => void;
    twinActive: boolean; onOpenTwin: () => void; onOpenDictionary: () => void; onOpenModules: () => void; onOpenSettings: () => void;
  } = $props();
  let requested = $state(false);
  let dismissed = $state<string | null>(null);
  const prompt = $derived(run.info && run.info.projectRoot !== null && (requested || run.info.trustState === "unknown" && dismissed !== run.info.cwd));

  async function select(project: Project, taskId?: string, trust = false): Promise<void> {
    if (run.ide.dirty) { toast.show(t("Save or close modified files in the IDE before switching projects")); return; }
    try {
      if (!project.current) {
        if (!window.desktop?.selectProject) throw new Error(t("Folder selection is available in the app"));
        const ready = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { stop?.(); reject(new Error(t("Could not open project. Select the folder again."))); }, 20_000);
          const stop = window.desktop?.agent?.onEvent((event) => {
            if (event.type !== "status" || event.cwd !== project.path) return;
            clearTimeout(timer); stop?.(); resolve();
          });
        });
        await window.desktop.selectProject(project.projectRoot ?? null, taskId);
        await ready;
      } else if (taskId) onSelectTask(taskId);
      if (trust) requested = true;
      else if (!taskId) onNewTask();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
  }
  async function remove(project: Project): Promise<void> {
    if (!project.path) return;
    if (project.current && run.ide.dirty) { toast.show(t("Save or close modified files in the IDE before switching projects")); return; }
    try { await window.desktop?.removeProject?.(project.path); await run.directories.refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
  }
  async function resolve(trusted: boolean): Promise<void> {
    const response = await requestAgent({ type: trusted ? "trust.accept" : "trust.reject" });
    if (response.info) run.info = response.info;
    await Promise.all([run.directories.refresh(), run.loadCommands()]);
  }
  function close(): void { dismissed = run.info?.cwd ?? null; requested = false; }
</script>

<Sidebar {hidden} projects={run.projects} activeTask={run.activeTask}
  user={{ name: run.userName, initial: run.userName.slice(0, 1).toUpperCase() }}
  onRenameUser={(name) => run.profile.rename(name)} {onOpenSettings}
  {onSelectTask} {onNewTask}
  onRenameTask={(id, title) => void renameTask(run, { id, title })}
  onDeleteTask={(id) => void deleteTask(run, { id })}
  onSearch={() => undefined}
  onSelectProject={(project, taskId) => void select(project, taskId)}
  onRemoveProject={(project) => void remove(project)}
  onProjectTrust={(project) => void select(project, undefined, true)}
  {twinActive} {onOpenTwin} {onOpenDictionary} {onOpenModules} />
{#if prompt && run.info}
  {#key run.info.cwd}<ProjectTrust info={run.info} onResolve={resolve} onClose={close} />{/key}
{/if}
