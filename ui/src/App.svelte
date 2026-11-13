<script lang="ts">
  import { t } from "./lib/i18n.svelte";
  import { onDestroy, onMount } from "svelte";
  import GooFilters from "./components/GooFilters.svelte";
  import MainHeader from "./components/MainHeader.svelte";
  import InspectorPanel from "./components/InspectorPanel.svelte";
  import MainPane from "./components/MainPane.svelte";
  import FileViewer from "./components/FileViewer.svelte";
  import RestoreDialog from "./components/RestoreDialog.svelte";
  import SettingsModal from "./components/SettingsModal.svelte";
  import ExtensionRequests from "./components/settings/ExtensionRequests.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import TitleBar from "./components/TitleBar.svelte";
  import IdePane from "./components/ide/IdePane.svelte";
  import SubagentPane from "./components/SubagentPane.svelte";
  import TwinPanel from "./components/twin/TwinPanel.svelte";
  import TwinWork from "./components/twin/TwinWork.svelte";
  import ModuleSurface from "./components/ModuleSurface.svelte";
  import ModuleApprovals from "./components/ModuleApprovals.svelte";
  import ModuleInterfaceHost from "./components/ModuleInterfaceHost.svelte";
  import { moduleHarness } from "./lib/modules/harness";
  import { OPEN_SUBAGENT } from "./lib/run/intents";
  import { chooseProject, findInThread, pasteImage, pickAttachments } from "./lib/desktop";
  import { windowTitle } from "./lib/format";
  import { isModifier } from "./lib/platform";
  import { RunStore } from "./lib/run.svelte";
  import { deleteTask, renameTask } from "./lib/run-tasks";
  import { settings } from "./lib/settings.svelte";
  import { toast } from "./lib/toast.svelte";
  import { canSplitWorkspace, Workspace, WORKSPACE_LAYOUT_KEY } from "./lib/workspace.svelte";
  import type { TabId } from "./lib/types";
  import { MODEL_PICKER_EVENT } from "./lib/ui-polish";
  import { fileViewer } from "./lib/file-viewer.svelte";
  import type { SummaryDestination } from "./lib/markdown/summary-navigation";

  const run = new RunStore();
  const harness = moduleHarness(run);
  const composer = $derived({
    context: run.contextView,
    commands: run.commands,
    providers: run.info?.providers ?? [],
    provider: run.provider,
    model: run.model,
    reasoning: run.reasoning,
    variant: run.variant,
  });
  const projects = $derived(run.projects);
  const startScreen = $derived(run.view.thread.items.length === 0 && !run.view.live);
  const tasks = $derived(
    run.sessions.map((session) => ({
      id: session.id,
      title: session.title,
      project: run.project,
      status: run.statusOf(session),
      updatedAt: session.updatedAt,
      ...(session.messageCount === undefined ? {} : { messageCount: session.messageCount }),
      ...(session.tokens === undefined ? {} : { tokens: session.tokens }),
    })),
  );

  async function chooseFolder(): Promise<void> {
    if (run.ide.dirty) {
      toast.show(t("Save or close modified files in the IDE before switching projects"));
      return;
    }
    if (!window.desktop?.chooseProject) {
      toast.show(t("Folder selection is available in the app"));
      return;
    }
    await chooseProject();
  }
  const activeTask = $derived(run.activeTask);
  const user = $derived({
    name: run.userName,
    initial: run.userName.slice(0, 1).toUpperCase(),
  });

  let sidebarHidden = $state(false);
  let twinOpen = $state(false);
  let mode = $state<"agent" | "ide">("agent");
  let ideExplorerHidden = $state(false);
  let ideEntered = $state(false);
  function setMode(next: "agent" | "ide"): void {
    twinOpen = false;
    mode = next;
    if (next === "ide") ideEntered = true;
  }
  const workspace = new Workspace();
  const selectedSubagent = $derived(run.view.subagents.items.find((item) => workspace.surface === `subagent:${item.id}`));
  const selectedModule = $derived(run.modules.state.surfaces.find((item) => workspace.surface === `module:${item.module}:${item.id}`));
  let viewportWidth = $state(1480);
  const sidebarWidth = $derived(sidebarHidden ? 0 : viewportWidth <= 1220 ? 250 : Math.max(270, Math.min(300, viewportWidth * 0.18)));
  const canSplit = $derived(canSplitWorkspace(viewportWidth, sidebarWidth));
  const split = $derived(!selectedSubagent && !selectedModule && canSplit && workspace.layout === "split" && workspace.surface !== "thread");
  const showPanel = $derived(!selectedSubagent && !startScreen && workspace.surface !== "thread");
  const showThread = $derived(startScreen || workspace.surface === "thread" || split);
  let focusToken = $state(0);

  function toggleSidebar(): void {
    if (mode === "ide") ideExplorerHidden = !ideExplorerHidden;
    else sidebarHidden = !sidebarHidden;
  }

  function openPanel(tab: TabId): void {
    workspace.select(tab);
  }

  function openChanges(): void {
    openPanel("changes");
  }

  function navigateSummary(destination: SummaryDestination): void {
    switch (destination.kind) {
      case "settings":
        void settings.openPanel(destination.section);
        break;
      case "panel":
        workspace.select(destination.panel);
        break;
      case "file":
        void fileViewer.open(destination.path, destination.line);
        break;
      case "models":
        window.dispatchEvent(new CustomEvent(MODEL_PICKER_EVENT, { detail: { query: "" } }));
        break;
    }
  }

  function toggleSplit(): void {
    workspace.toggleSplit();
    try { localStorage.setItem(WORKSPACE_LAYOUT_KEY, workspace.layout); } catch { /* Optional preference storage. */ }
  }

  function newTask(): void {
    twinOpen = false;
    workspace.select("thread");
    run.newTask();
    focusToken += 1;
  }

  function exportThread(): void {
    const lines: string[] = [`# ${run.title || run.project}`, ""];
    for (const item of run.view.thread.items) {
      if (item.kind === "message") {
        lines.push(t("## User"), "", item.text, "");
      } else if (item.kind === "answer") {
        if (item.text) lines.push(t("## Response"), "", item.text, "");
        if (item.summaryHtml) lines.push(item.summaryHtml, "");
      } else if (item.kind === "run") {
        lines.push(t("## Work"));
        for (const action of item.summary.list) lines.push(`- ${action.label}`);
        lines.push("");
      } else if (item.kind === "error") {
        lines.push(t("> Error: {0}", [item.text]), "");
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `flecten-${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.show(t("Conversation saved as Markdown"));
  }

  function handleCommand(name: string, args: string): void {
    switch (name) {
      case "undo":
        void run.checkpoints.undo();
        break;
      case "redo":
        void run.checkpoints.redo();
        break;
      case "checkpoints":
        openPanel("history");
        void run.checkpoints.refresh();
        break;
      case "terminal":
        openPanel("terminal");
        break;
      case "new":
      case "clear":
        newTask();
        break;
      case "permissions":
        void settings.openPanel("permissions");
        break;
      case "export":
        exportThread();
        break;
      case "model":
        window.dispatchEvent(new CustomEvent(MODEL_PICKER_EVENT, { detail: { query: args } }));
        break;
      case "compact":
        void run.task.compact(args || undefined);
        break;
      case "search":
        void searchThread(args);
        break;
      case "continue":
        run.submit(`/continue${args ? ` ${args}` : ""}`, run.sendMode, []);
        break;
      default:
        runCustomCommand(name, args);
    }
  }

  let searching = $state(false);

  async function searchThread(query: string): Promise<void> {
    if (!query) {
      toast.show(t("Enter text after /search"));
      return;
    }
    const matches = await findInThread(query);
    searching = (matches ?? 0) > 0;
    if (matches === null) toast.show(t("Search is available in the app"));
    else if (matches === 0) toast.show(t("“{0}” not found in the conversation", [query]));
    else toast.show(t("Matches found: {0}. Press Esc to clear highlighting", [matches]));
  }

  function runCustomCommand(name: string, args: string): void {
    const command = run.commands.find((entry) => entry.name === name);
    if (!command) {
      toast.show(t("Command /{0} not found", [name]));
      return;
    }
    run.submit(`/${name}${args ? ` ${args}` : ""}`, run.sendMode, []);
  }

  function selectTask(id: string): void {
    twinOpen = false;
    workspace.select("thread");
    void run.selectTask(id);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      if (event.defaultPrevented || mode === "ide" || document.querySelector("dialog[open], :popover-open")) return;
      if (searching) {
        event.preventDefault();
        searching = false;
        void findInThread("");
        return;
      }
      if (!settings.open && run.busy) {
        event.preventDefault();
        run.stop();
      }
      return;
    }
    if (mode === "ide" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
    if (!isModifier(event)) return;
    const key = event.key.toLowerCase();
    const target = event.target;
    const editing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable);

    if (key === "b") {
      event.preventDefault();
      toggleSidebar();
    } else if (key === "n") {
      event.preventDefault();
      setMode("agent");
      newTask();
    } else if (key === "z" && !editing) {
      event.preventDefault();
      if (event.shiftKey) void run.checkpoints.redo();
      else void run.checkpoints.undo();
    }
  }

  onMount(() => {
    viewportWidth = window.innerWidth;
    try { workspace.restore(localStorage.getItem(WORKSPACE_LAYOUT_KEY)); } catch { /* Optional preference storage. */ }
    const disconnect = run.connect();
    const openChild = (event: Event): void => {
      const id = (event as CustomEvent<{ id?: unknown }>).detail?.id;
      if (typeof id === "string" && run.view.subagents.items.some((item) => item.id === id)) workspace.select(`subagent:${id}`);
    };
    window.addEventListener(OPEN_SUBAGENT, openChild);
    const refreshIde = (): void => { if (mode === "ide") void run.ide.requestRefresh(); };
    window.addEventListener("focus", refreshIde);
    void run.loadCommands();
    return () => {
      disconnect();
      window.removeEventListener(OPEN_SUBAGENT, openChild);
      window.removeEventListener("focus", refreshIde);
    };
  });

  onDestroy(() => {
    toast.dispose();
  });

  $effect(() => {
    document.title = windowTitle(startScreen ? "" : run.title);
  });
</script>

<svelte:window onkeydown={onKeydown} bind:innerWidth={viewportWidth} />
<GooFilters />

<div class="app" data-harness-region="shell">
  <TitleBar
    sidebarHidden={mode === "ide" ? ideExplorerHidden : sidebarHidden}
    {mode} onModeChange={setMode}
    onToggleSidebar={toggleSidebar}
    onOpenSettings={() => settings.openPanel()}
  />
  <div class="body" class:sidebar-hidden={sidebarHidden || mode === "ide"}>
    <div class="project-sidebar" data-harness-region="sidebar" hidden={mode === "ide"}>
    <Sidebar
      hidden={sidebarHidden}
      {projects}
      {activeTask}
      {user}
      onSelectTask={selectTask}
      onNewTask={newTask}
      onRenameTask={(id, title) => void renameTask(run, { id, title })}
      onDeleteTask={(id) => void deleteTask(run, { id })}
      onSearch={(query) => void run.searchSessions(query)}
      twinActive={twinOpen}
      onOpenTwin={() => { setMode("agent"); twinOpen = true; }}
      onOpenDictionary={() => settings.openPanel("dictionary")}
      onOpenModules={() => settings.openPanel("modules")}
    />
    </div>
    <main class="workspace" data-harness-region="workspace" aria-label="{t("Workspace")}" aria-busy={run.openingTask !== null}>
    {#if run.openingTask}
      <div class="task-loading" role="status">{t("Opening task…")}</div>
    {/if}
    <div class="workspace-content" hidden={mode === "ide"} inert={run.openingTask !== null || mode === "ide"}>
    {#if twinOpen}
      <TwinPanel twin={run.twin} project={run.project} onClose={() => twinOpen = false} />
    {/if}
    <div class="task-workspace" hidden={twinOpen} inert={twinOpen}>
    {#if !startScreen}
      <MainHeader title={run.title || run.project} branch={run.branch}
        phase={run.view.phase} surface={workspace.surface} changes={run.view.thread.changeFiles.length}
        checkpoints={run.checkpoints.list.length} workers={run.view.worker.items} {split} {canSplit}
        subagents={run.view.subagents.items}
        moduleSurfaces={run.modules.state.surfaces.filter((s) => !s.placement)}
        onSelect={(surface) => workspace.select(surface)} onToggleSplit={toggleSplit} />
    {/if}
    {#if selectedSubagent}
      <SubagentPane agent={selectedSubagent} action={run.view.subagents.action(selectedSubagent)} onStop={() => void run.task.stopSubagent(selectedSubagent.id)} />
    {:else if selectedModule}
      <ModuleApprovals items={run.view.thread.items} />
      {#key `${run.activeTask}:${selectedModule.module}:${selectedModule.id}:${selectedModule.revision}`}
        <ModuleSurface surface={selectedModule} sessionId={run.activeTask} {harness} />
      {/key}
    {:else}
    <TwinWork view={run.view.twin} />
    <div class="work-area" class:is-split={split} class:panel-only={!showThread}>
    <div class="thread-surface" hidden={!showThread} inert={!showThread}>
    {#if mode === "agent"}
    <MainPane
      taskId={run.activeTask}
      project={run.project}
      cwd={run.info?.cwd ?? ""}
      stopping={run.view.stopping}
      items={run.view.thread.items}
      live={run.view.live}
      liveLabel={run.view.liveLabel}
      pendingCalls={run.view.thread.pendingCalls}
      busy={run.busy}
      {focusToken}
      {composer}
      onOpenChanges={openChanges}
      onNavigateSummary={navigateSummary}
      onRepeat={(prompt) => run.repeat(prompt)}
      onModelSelect={(provider, model) => run.setModel(provider, model)}
      onReasoningChange={(value) => run.setReasoning(value)}
      onVariantChange={(value) => run.setVariant(value)}
      queued={run.view.queued}
      sendMode={run.sendMode}
      contexts={run.contextMentions}
      files={run.files}
      {tasks}
      onRequestFiles={() => void run.loadFiles()}
      onCommand={handleCommand}
      onPickAttachments={pickAttachments}
      onPasteImage={pasteImage}
      onCompact={(focus) => void run.task.compact(focus)}
      onSend={(text, mode, attachments, contexts) => run.submit(text, mode, attachments, contexts)}
      onSelectTask={selectTask}
      onChooseFolder={() => void chooseFolder()}
      onQueueEdit={(id, text) => run.task.editQueued(id, text)}
      onQueueRemove={(id) => run.task.removeQueued(id)}
      onSendModeChange={(mode) => run.setSendMode(mode)}
      onStop={() => run.stop()}
      jobs={run.view.jobs}
      budget={run.view.budget}
    />
    {/if}
    </div>
    <InspectorPanel
      hidden={!showPanel}
      activeTab={workspace.panel}
      {split}
      files={run.view.thread.changeFiles}
      terminal={run.view.thread.terminalLines}
      workers={run.view.worker.items}
      checkpoints={run.checkpoints.list}
      shellCheckpoints={run.info?.shellCheckpoints}
      onRestoreCheckpoint={(id, target) => void run.checkpoints.restore(id, target)}
      onRefreshCheckpoints={() => void run.checkpoints.refresh()}
    />
    </div>
    {/if}
    </div>
    </div>
    {#if ideEntered}
      <IdePane {run} active={mode === "ide"} explorerHidden={ideExplorerHidden}
        onShowExplorer={() => ideExplorerHidden = false} onToggleExplorer={() => ideExplorerHidden = !ideExplorerHidden} onChooseProject={() => void chooseFolder()}
        onShowAgent={() => { workspace.select("thread"); setMode("agent"); }} onCommand={handleCommand} />
    {/if}
    </main>
  </div>
</div>

{#if run.checkpoints.prompt}
  <RestoreDialog
    prompt={run.checkpoints.prompt}
    onResolve={(choice) => void run.checkpoints.resolve(choice)}
    onDismiss={() => run.checkpoints.dismiss()}
  />
{/if}
<FileViewer />
<SettingsModal hookRuns={run.view.hookRuns} dictionary={run.dictionary} />
<ExtensionRequests />
<ModuleInterfaceHost snapshot={run.modules.state} {harness} />

<style>
  .app {
    display: grid;
    grid-template-rows: 48px minmax(0, 1fr);
    height: 100dvh;
  }
  .body {
    display: grid;
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
    min-height: 0;
  }
  .body.sidebar-hidden { grid-template-columns: 0 minmax(0, 1fr); }
  .project-sidebar { display: flex; grid-column: 1; grid-row: 1; min-width: 0; min-height: 0; }
  .project-sidebar :global(.sidebar) { width: 100%; }
  .workspace { grid-column: 2; grid-row: 1; position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .workspace-content { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
  .task-workspace { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
  .workspace-content[inert] { opacity: 0.45; }
  .task-loading { position: absolute; z-index: 10; top: 16px; right: 24px; padding: 8px 12px; border-radius: 8px; background: var(--raised); color: var(--text); font-size: 13px; }
  .work-area { display: grid; flex: 1; grid-template-columns: minmax(0, 1fr) 0; min-height: 0; min-width: 0; }
  .work-area.is-split { grid-template-columns: minmax(0, 1fr) var(--panel-w); }
  .work-area.panel-only { grid-template-columns: 0 minmax(0, 1fr); }
  .thread-surface { grid-column: 1; grid-row: 1; display: flex; min-width: 0; min-height: 0; }
  .work-area :global(.panel) { grid-column: 2; grid-row: 1; }
  @media (max-width: 720px) {
    .body { grid-template-columns: 0 minmax(0, 1fr); }
    .body :global(.sidebar) { visibility: hidden; }
    .body:not(.sidebar-hidden) :global(.sidebar) {
      position: absolute; inset: 48px auto 0 0; z-index: 20;
      width: min(300px, calc(100vw - 48px)); visibility: visible;
      box-shadow: 12px 0 32px #0006;
    }
  }
</style>
