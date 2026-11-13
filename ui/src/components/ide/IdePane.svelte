<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { onMount, tick } from "svelte";
  import { fade } from "svelte/transition";
  import { prefersReducedMotion } from "../../lib/motion";
  import type { RunStore } from "../../lib/run.svelte";
  import { isDirty } from "../../lib/ide-document";
  import { splitPath } from "../../lib/file-text";
  import { modLabel } from "../../lib/platform";
  import { commandShortcut, type CommandId } from "../../lib/ide/commands";
  import { editorLanguage } from "../../lib/ide/editor";
  import type { EditorAction } from "../../lib/ide/editor-actions";
  import Icon from "../Icon.svelte";
  import TerminalPane from "../TerminalPane.svelte";
  import AgentChanges from "./AgentChanges.svelte";
  import AgentIsland from "./AgentIsland.svelte";
  import AgentSidebar from "./AgentSidebar.svelte";
  import ChangeReview from "./ChangeReview.svelte";
  import DiscardDialog from "./DiscardDialog.svelte";
  import EditorDocument from "./EditorDocument.svelte";
  import EditorTabs from "./EditorTabs.svelte";
  import FileExplorer from "./FileExplorer.svelte";
  import FileOperation from "./FileOperation.svelte";
  import GoToLine from "./GoToLine.svelte";
  import IdeMenu from "./IdeMenu.svelte";
  import SourceControl from "./SourceControl.svelte";
  import GitDiff from "./GitDiff.svelte";
  import ProjectSearch from "./ProjectSearch.svelte";
  import QuickOpen from "./QuickOpen.svelte";
  import ResizeHandle from "./ResizeHandle.svelte";
  import WorkspaceTerminal from "./WorkspaceTerminal.svelte";
  import "./ide.css";

  let { run, active, explorerHidden, onShowExplorer, onToggleExplorer, onShowAgent, onChooseProject, onCommand }: {
    run: RunStore; active: boolean; explorerHidden: boolean;
    onShowAgent: () => void; onCommand: (name: string, args: string) => void;
    onShowExplorer: () => void; onToggleExplorer: () => void; onChooseProject: () => void;
  } = $props();
  const ide = $derived(run.ide);
  let showLeft = $state(false);
  let leftTab = $state<"files" | "search" | "git" | "changes">("files");
  let agentOpen = $state(true);
  let agentFocus = $state(0);
  let reviewPath = $state<string | null>(null);
  let quickOpen = $state<"files" | "commands" | null>(null);
  let goLine = $state(false);
  let outputOpen = $state(false);
  let outputTab = $state<"terminal" | "agent">("terminal");
  let terminalEntered = $state(false);
  let splitPathValue = $state<string | null>(null);
  let focused = $state<"primary" | "secondary">("primary");
  let primaryAction = $state<{ name: EditorAction; token: number } | null>(null);
  let secondaryAction = $state<{ name: EditorAction; token: number } | null>(null);
  let actionToken = 0;
  let operation = $state<{ name: "create-file" | "create-folder" | "rename" | "trash"; path: string } | null>(null);
  let line = $state(1);
  let column = $state(1);
  let viewportWidth = $state(1480);
  const document = $derived(ide.active);
  const secondary = $derived(ide.tabs.find((tab) => tab.path === splitPathValue));
  const target = $derived(focused === "secondary" && secondary ? secondary : document);
  const gitDiff = $derived(ide.git.diff);
  const review = $derived(run.view.thread.changeFiles.find((file) => file.path === reviewPath));
  const reviewing = $derived(!!review || !!gitDiff);
  const prefs = $derived(ide.layout.values);
  const agentWidth = $derived(Math.min(prefs.agentWidth, Math.max(300, viewportWidth - (explorerHidden ? 0 : 180) - 464)));
  const filesWidth = $derived(Math.min(prefs.filesWidth, Math.max(180, viewportWidth - (agentOpen ? agentWidth : 0) - 464)));

  function showAgent(): void { agentOpen = true; agentFocus += 1; }
  function selectLeft(tab: "files" | "search" | "git" | "changes"): void { showLeft = leftTab === tab ? !showLeft : true; leftTab = tab; onShowExplorer(); if (tab === "git") void ide.git.refresh(); }
  function leftKeydown(event: KeyboardEvent): void {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); onShowExplorer(); showLeft = true;
    const tabs = ["files", "search", "git", "changes"] as const;
    const index = tabs.indexOf(leftTab);
    leftTab = tabs[event.key === "Home" ? 0 : event.key === "End" ? 3 : (index + (event.key === "ArrowDown" ? 1 : 3)) % 4]!;
    void tick().then(() => window.document.getElementById(`ide-tab-${leftTab}`)?.focus());
  }
  function open(path: string): void { showLeft = false; reviewPath = null; ide.git.diff = null; focused = "primary"; void ide.open(path); }
  function edit(name: EditorAction): void {
    const action = { name, token: ++actionToken };
    if (focused === "secondary" && secondary) secondaryAction = action; else primaryAction = action;
  }
  function execute(id: CommandId): void {
    switch (id) {
      case "new-file": operation = { name: "create-file", path: "" }; break;
      case "new-folder": operation = { name: "create-folder", path: "" }; break;
      case "open-folder": onChooseProject(); break;
      case "quick-open": quickOpen = "files"; break;
      case "palette": quickOpen = "commands"; break;
      case "save": if (target && !reviewing) void ide.save(target.path); break;
      case "save-all": void ide.saveAll(); break;
      case "reload": if (target && !reviewing) void ide.reload(target.path); break;
      case "close": if (gitDiff) ide.git.diff = null; else if (review) reviewPath = null; else if (focused === "secondary" && secondary) splitPathValue = null; else if (document) ide.close(document.path); break;
      case "close-all": ide.closeMany(ide.tabs.map((tab) => tab.path)); break;
      case "close-others": ide.closeMany(ide.tabs.filter((tab) => tab !== target).map((tab) => tab.path)); break;
      case "reopen": ide.reopen(); break;
      case "previous-tab": reviewPath = null; ide.git.diff = null; focused = "primary"; ide.cycle(-1); break;
      case "next-tab": reviewPath = null; ide.git.diff = null; focused = "primary"; ide.cycle(1); break;
      case "back": reviewPath = null; ide.git.diff = null; focused = "primary"; ide.navigate(-1); break;
      case "forward": reviewPath = null; ide.git.diff = null; focused = "primary"; ide.navigate(1); break;
      case "go-line": if (target && !reviewing) goLine = true; break;
      case "search-project": leftTab = "search"; showLeft = true; onShowExplorer(); void tick().then(() => window.document.getElementById("project-query")?.focus()); break;
      case "toggle-files": onToggleExplorer(); break;
      case "toggle-agent": agentOpen ? agentOpen = false : showAgent(); break;
      case "toggle-terminal": outputOpen = !outputOpen; if (outputOpen) terminalEntered = true; break;
      case "split": if (secondary) splitPathValue = null; else if (document) { splitPathValue = document.path; agentOpen = false; } break;
      case "wrap": ide.layout.set({ wrap: !prefs.wrap }); break;
      case "font-up": ide.layout.set({ fontSize: Math.min(22, prefs.fontSize + 1) }); break;
      case "font-down": ide.layout.set({ fontSize: Math.max(11, prefs.fontSize - 1) }); break;
      case "font-reset": ide.layout.set({ fontSize: 13 }); break;
      default: if (!reviewing) edit(id);
    }
  }
  function keydown(event: KeyboardEvent): void {
    if (!active || event.defaultPrevented || window.document.querySelector("dialog[open], :popover-open")) return;
    const command = commandShortcut(event);
    if (command) { event.preventDefault(); event.stopPropagation(); execute(command); }
  }
  function cursor(nextLine: number, nextColumn: number): void { line = nextLine; column = nextColumn; }
  $effect(() => { if (active) void ide.requestRefresh(); });
  onMount(() => {
    ide.layout.restore();
    const beforeUnload = (event: BeforeUnloadEvent): void => { if (ide.dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("keydown", keydown, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("keydown", keydown, true); };
  });
</script>

<svelte:window bind:innerWidth={viewportWidth} />
<section class="ide" class:explorer-hidden={explorerHidden} class:agent-open={agentOpen} class:show-left={showLeft} aria-label="IDE" hidden={!active} style={`--ide-files-size:${filesWidth}px;--ide-agent-size:${agentWidth}px;--ide-output-size:${prefs.outputHeight}px`}>
  <div class="ide-activity" role="tablist" aria-label={t("IDE panels")} aria-orientation="vertical">
    {#each [{ id: "files", label: t("Files"), icon: "file" }, { id: "search", label: t("Search project"), icon: "search" }, { id: "git", label: t("Source control"), icon: "branch" }, { id: "changes", label: t("Agent changes"), icon: "spark" }] as tab}
      <button id={`ide-tab-${tab.id}`} class:changes-trigger={tab.id === "changes"} type="button" role="tab" aria-selected={leftTab === tab.id} aria-controls="ide-left-panel" tabindex={leftTab === tab.id ? 0 : -1} title={tab.label} aria-label={tab.label} onclick={() => selectLeft(tab.id as typeof leftTab)} onkeydown={leftKeydown}><Icon name={tab.icon as "file" | "search" | "branch" | "spark"} size={21} />{#if tab.id === "changes" && run.view.thread.changeFiles.length}<span class="activity-count">{run.view.thread.changeFiles.length}</span>{/if}</button>
    {/each}
    <span class="activity-spacer"></span>
    <button type="button" aria-label={t("Command palette")} title={t("Command palette ({0}+Shift+P)", [modLabel])} onclick={() => execute("palette")}><Icon name="terminal" size={20} /></button>
  </div>
  <div class="ide-explorer" hidden={explorerHidden} id="ide-left-panel" role="tabpanel" aria-labelledby={`ide-tab-${leftTab}`}>
    <div class="left-surface" hidden={leftTab !== "files"}><FileExplorer {ide} project={run.project} onOpen={open} {onChooseProject} onOperation={(name, path) => operation = { name, path }} /></div>
    <div class="left-surface" hidden={leftTab !== "search"}><ProjectSearch search={ide.search} onReplace={async () => { await ide.search.applyReplace(ide.tabs.filter((tab) => isDirty(tab) || tab.saving).map((tab) => tab.path)); await ide.requestRefresh(); }} onOpen={(match) => { reviewPath = null; ide.git.diff = null; showLeft = false; focused = "primary"; void ide.openAt(match.path, match.line, match.column, match.length); }} /></div>
    <div class="left-surface ide-changes" hidden={leftTab !== "changes"}><AgentChanges files={run.view.thread.changeFiles} selected={reviewPath} onSelect={(path) => { reviewPath = path; ide.git.diff = null; showLeft = false; }} onClose={() => leftTab = "files"} /></div>
    <div class="left-surface" hidden={leftTab !== "git"}><SourceControl git={ide.git} onDiff={(path, staged) => { reviewPath = null; void ide.git.show(path, staged); }} /></div>
    <ResizeHandle value={filesWidth} min={180} max={440} initial={240} label={t("Explorer width")} onChange={(filesWidth) => ide.layout.set({ filesWidth })} />
  </div>
  <div class="ide-main">
    <header class="ide-toolbar"><IdeMenu onExecute={execute} /><span class="toolbar-spacer"></span><button class="quick-trigger" type="button" title={t("Open file ({0}+P)", [modLabel])} onclick={() => quickOpen = "files"}><Icon name="search" size={14} /><span>{t("Open file…")}</span><kbd>{modLabel}+P</kbd></button><button class="ide-tool" type="button" aria-label={t("Split editor")} title={t("Split editor ({0}+\\)", [modLabel])} aria-pressed={!!secondary} disabled={!document} onclick={() => execute("split")}><Icon name="layers" size={16} /></button><button class="ide-tool" type="button" aria-pressed={outputOpen} title={t("Terminal ({0}+`)", [modLabel])} aria-label={t("Terminal")} onclick={() => execute("toggle-terminal")}><Icon name="terminal" size={16} /></button><button class="ide-tool agent-trigger" class:active={agentOpen} type="button" aria-expanded={agentOpen} aria-controls="ide-agent" onclick={() => execute("toggle-agent")}><Icon name="panel-right" size={16} /><span>{t("Agent")}</span></button></header>
    <EditorTabs {ide} reviewing={reviewing} onSelect={open} />
    <div class="editor-surface" id="ide-editor">
      {#if gitDiff}<GitDiff diff={gitDiff} onEdit={() => open(gitDiff.path)} onClose={() => ide.git.diff = null} />{/if}
      {#if review}<ChangeReview file={review} onEdit={() => open(review.path)} onClose={() => reviewPath = null} />{/if}
      <div class="editor-columns" class:is-split={!!secondary} hidden={reviewing}>
        {#if document}<EditorDocument {ide} {document} action={primaryAction} focused={focused === "primary" || !secondary} onFocus={() => focused = "primary"} onCursor={cursor} />{:else}<div class="ide-welcome"><Icon name="layers" size={36} /><h1>{t("Workspace")}</h1><p>{t("Open a file or create a new one.")}</p><button type="button" onclick={() => execute("quick-open")}>{t("Open file")} <kbd>{modLabel}+P</kbd></button><button type="button" onclick={() => execute("new-file")}>{t("New file")} <kbd>{modLabel}+N</kbd></button><button type="button" onclick={() => execute("palette")}>{t("All commands")} <kbd>{modLabel}+Shift+P</kbd></button><div class="shortcut-hints"><span>{t("Search project")} <kbd>{modLabel}+Shift+F</kbd></span><span>{t("Terminal")} <kbd>{modLabel}+\u0060</kbd></span></div></div>{/if}
        {#if secondary}<EditorDocument {ide} document={secondary} action={secondaryAction} focused={focused === "secondary"} onFocus={() => focused = "secondary"} onCursor={cursor} onClose={() => splitPathValue = null} />{/if}
      </div>
    </div>
    <section class="ide-output" aria-label={t("Terminal and output")} hidden={!outputOpen}>
      <ResizeHandle value={prefs.outputHeight} min={100} max={Math.min(500, window.innerHeight * .6)} initial={220} label={t("Terminal height")} horizontal reverse onChange={(outputHeight) => ide.layout.set({ outputHeight })} />
      <header><div role="tablist" aria-label={t("IDE output")}><button role="tab" type="button" aria-selected={outputTab === "terminal"} onclick={() => { outputTab = "terminal"; terminalEntered = true; }}>{t("Terminal")}</button><button role="tab" type="button" aria-selected={outputTab === "agent"} onclick={() => outputTab = "agent"}>{t("Agent output")}</button></div><button type="button" aria-label={t("Hide terminal")} onclick={() => outputOpen = false}><Icon name="x" size={14} /></button></header>
      <div class="terminal-surface" hidden={outputTab !== "terminal"}>{#if terminalEntered}<WorkspaceTerminal visible={active && outputOpen && outputTab === "terminal"} />{/if}</div>
      <div class="terminal-surface" hidden={outputTab !== "agent"}><TerminalPane lines={run.view.thread.terminalLines} /></div>
    </section>
    {#if active}<AgentIsland {run} expanded={agentOpen} onToggle={() => execute("toggle-agent")} />{/if}
    <footer class="ide-status"><button class="status-branch" title={run.branch || run.project} onclick={() => selectLeft("git")}><Icon name="branch" size={12} />{run.branch || run.project}</button><span class="status-spacer"></span>{#if target && !reviewing}<span class="save-status">{!target.file?.hash ? t("Read-only") : target.saving ? t("Saving…") : isDirty(target) ? t("Unsaved") : t("Saved")}</span><button title={t("Go to line")} onclick={() => execute("go-line")}>{t("Ln {0}, Col {1}", [line, column])}</button><button title={t("Change indent size")} onclick={() => ide.layout.set({ tabSize: prefs.tabSize === 2 ? 4 : 2 })}>{t("Spaces: {0}", [prefs.tabSize])}</button><span class="encoding">UTF-8 · {target.text.includes("\r\n") ? "CRLF" : "LF"}</span><button title={t("Wrap long lines")} aria-pressed={prefs.wrap} onclick={() => execute("wrap")}>{editorLanguage(target.path).label}</button>{/if}</footer>
  </div>
  {#if agentOpen && active}<div class="ide-agent" in:fade={{ duration: prefersReducedMotion() ? 0 : 140 }}><ResizeHandle value={prefs.agentWidth} min={300} max={600} initial={360} label={t("Agent pane width")} reverse edge="start" onChange={(agentWidth) => ide.layout.set({ agentWidth })} /><AgentSidebar {run} focusToken={agentFocus} onClose={() => agentOpen = false} {onShowAgent} onOpenChanges={() => { leftTab = "changes"; onShowExplorer(); }} onCommand={(name, args) => { if (name === "terminal") { outputOpen = true; outputTab = "agent"; } else { onCommand(name, args); if (["new", "clear", "checkpoints"].includes(name)) onShowAgent(); } }} /></div>{/if}
</section>
{#if active && quickOpen}<QuickOpen files={ide.files} recent={ide.tabs.map((tab) => tab.path)} mode={quickOpen} onOpen={open} onExecute={execute} onClose={() => quickOpen = null} />{/if}
{#if active && goLine && target}<GoToLine {line} total={target.text.split("\n").length} onGo={(line, column) => ide.locate(target!.path, line, column)} onClose={() => goLine = false} />{/if}
{#if active && operation}<FileOperation {ide} operation={operation.name} path={operation.path} onClose={() => operation = null} />{/if}
{#if active && ide.pending}<DiscardDialog path={ide.pending.path} onResolve={(choice) => void ide.resolvePending(choice)} />{/if}
