<script module lang="ts">
  export const PANEL_MIN_WIDTH = 320;
  export const PANEL_MAX_WIDTH = 760;
  export const PANEL_WIDTH_KEY = "liquid.inspector-width";

  export function panelMaxWidth(viewport: number): number {
    const available = Math.floor(viewport) - 270 - 360;
    return Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, available));
  }

  export function clampPanelWidth(value: number, viewport: number): number {
    const max = panelMaxWidth(viewport);
    if (!Number.isFinite(value)) return Math.round((PANEL_MIN_WIDTH + max) / 2);
    return Math.min(max, Math.max(PANEL_MIN_WIDTH, Math.round(value)));
  }

  export function defaultPanelWidth(viewport: number): number {
    return clampPanelWidth(Math.min(700, Math.max(500, viewport * 0.35)), viewport);
  }
</script>

<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { onDestroy, onMount, tick } from "svelte";
  import { enterPane } from "../lib/motion";
  import type { AgentCheckpoint, AgentInfo, DiffFile, TabId, TerminalLine, WorkerItem } from "../lib/types";
  import ChangesPane from "./ChangesPane.svelte";
  import HistoryPane from "./HistoryPane.svelte";
  import TerminalPane from "./TerminalPane.svelte";
  import WorkerPane from "./WorkerPane.svelte";

  interface Props {
    hidden: boolean;
    activeTab: TabId;
    split: boolean;
    files: DiffFile[];
    terminal: TerminalLine[];
    workers?: WorkerItem[];
    checkpoints: AgentCheckpoint[];
    shellCheckpoints?: AgentInfo["shellCheckpoints"];
    onRestoreCheckpoint: (id: string, target: "before" | "after") => void;
    onRefreshCheckpoints: () => void;
  }

  let {
    hidden,
    activeTab,
    split,
    files,
    terminal,
    workers = [],
    checkpoints,
    shellCheckpoints,
    onRestoreCheckpoint,
    onRefreshCheckpoints,
  }: Props = $props();

  let panelEl = $state<HTMLElement | null>(null);
  let changesPane: HTMLElement;
  let historyPane: HTMLElement;
  let terminalPane: HTMLElement;
  let workerPane: HTMLElement;
  let viewportWidth = $state(1180);
  let width = $state<number | null>(null);
  let dragging = $state(false);
  let drag: { startX: number; startWidth: number } | null = null;
  const panePositions: Record<TabId, number> = { changes: 0, history: 0, terminal: 0, worker: 0 };

  const maxWidth = $derived(panelMaxWidth(viewportWidth));
  const currentWidth = $derived(width ?? defaultPanelWidth(viewportWidth));

  function persistWidth(value: number): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(value));
    } catch {
      // Storage can be unavailable in private windows; resizing still works.
    }
  }

  function paintWidth(value: number): number {
    const next = clampPanelWidth(value, viewportWidth);
    width = next;
    const parent = panelEl?.parentElement;
    if (parent) parent.style.setProperty("--panel-w", `${next}px`);
    return next;
  }

  function resetWidth(): void {
    width = null;
    panelEl?.parentElement?.style.removeProperty("--panel-w");
    if (typeof localStorage !== "undefined") localStorage.removeItem(PANEL_WIDTH_KEY);
  }

  function measuredWidth(): number {
    return Math.round(panelEl?.getBoundingClientRect().width ?? currentWidth);
  }

  function onResizePointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !panelEl) return;
    event.preventDefault();
    drag = { startX: event.clientX, startWidth: measuredWidth() };
    dragging = true;
    window.addEventListener("pointermove", onResizePointerMove);
    window.addEventListener("pointerup", onResizePointerUp);
    window.addEventListener("pointercancel", onResizePointerUp);
  }

  function onResizePointerMove(event: PointerEvent): void {
    if (!drag) return;
    paintWidth(drag.startWidth + drag.startX - event.clientX);
  }

  function onResizePointerUp(): void {
    window.removeEventListener("pointermove", onResizePointerMove);
    window.removeEventListener("pointerup", onResizePointerUp);
    window.removeEventListener("pointercancel", onResizePointerUp);
    if (!drag) return;
    drag = null;
    dragging = false;
    persistWidth(measuredWidth());
  }

  function onResizeKeydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? 64 : 16;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = measuredWidth() + step;
    else if (event.key === "ArrowRight") next = measuredWidth() - step;
    else if (event.key === "Home") next = PANEL_MIN_WIDTH;
    else if (event.key === "End") next = maxWidth;
    if (next === null) return;
    event.preventDefault();
    persistWidth(paintWidth(next));
  }

  function onWindowResize(): void {
    viewportWidth = window.innerWidth;
    if (width !== null) paintWidth(width);
  }

  function paneFor(tab: TabId): HTMLElement | undefined {
    return { changes: changesPane, history: historyPane, terminal: terminalPane, worker: workerPane }[tab];
  }

  function onPaneScroll(tab: TabId, event: Event): void {
    panePositions[tab] = (event.currentTarget as HTMLElement).scrollTop;
  }

  $effect(() => {
    const tab = activeTab;
    const isHidden = hidden;
    if (isHidden) return;
    void tick().then(() => {
      if (tab === "terminal") return;
      const node = paneFor(tab);
      const top = panePositions[tab];
      if (node && node.scrollTop !== top) node.scrollTop = top;
    });
  });

  onMount(() => {
    viewportWidth = window.innerWidth;
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(PANEL_WIDTH_KEY);
      if (stored !== null) {
        const value = Number(stored);
        if (Number.isFinite(value)) paintWidth(value);
        else localStorage.removeItem(PANEL_WIDTH_KEY);
      }
    }
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  });

  onDestroy(() => {
    window.removeEventListener("pointermove", onResizePointerMove);
    window.removeEventListener("pointerup", onResizePointerUp);
    window.removeEventListener("pointercancel", onResizePointerUp);
  });

  $effect(() => {
    const tab = activeTab;
    const isHidden = hidden;
    void tick().then(() => {
      if (isHidden) return;
      const node = paneFor(tab);
      if (node) enterPane(node);
    });
  });

</script>

<aside
  class="panel"
  {hidden}
  class:is-resizing={dragging}
  class:is-split={split}
  id="inspector-panel"
  inert={hidden}
  aria-label={t("Task workspace")}
  bind:this={panelEl}
>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    hidden={!split}
    class="resizer"
    class:is-active={dragging}
    role="separator"
    aria-orientation="vertical"
    aria-label={t("Panel width")}
    aria-valuemin={PANEL_MIN_WIDTH}
    aria-valuemax={maxWidth}
    aria-valuenow={currentWidth}
    aria-valuetext={t("{0} pixels", [currentWidth])}
    tabindex={hidden || !split ? -1 : 0}
    title={t("Drag to resize. Double-click to reset.")}
    onpointerdown={onResizePointerDown}
    onkeydown={onResizeKeydown}
    ondblclick={resetWidth}
  ></div>

  <div class="panel-body">
    <div
      class="panel-pane"
      id="pane-changes"
      role="tabpanel"
      aria-labelledby="tab-changes"
      hidden={activeTab !== "changes"}
      bind:this={changesPane}
      onscroll={(event) => onPaneScroll("changes", event)}
    >
      <ChangesPane {files} />
    </div>
    <div
      class="panel-pane"
      id="pane-history"
      role="tabpanel"
      aria-labelledby="tab-history"
      hidden={activeTab !== "history"}
      bind:this={historyPane}
      onscroll={(event) => onPaneScroll("history", event)}
    >
      <HistoryPane
        {checkpoints}
        shell={shellCheckpoints}
        onRestore={onRestoreCheckpoint}
        onRefresh={onRefreshCheckpoints}
      />
    </div>
    <div
      class="panel-pane terminal-pane"
      id="pane-terminal"
      role="tabpanel"
      aria-labelledby="tab-terminal"
      hidden={activeTab !== "terminal"}
      bind:this={terminalPane}
    >
      <TerminalPane lines={terminal} />
    </div>
    <div
      class="panel-pane"
      id="pane-worker"
      role="tabpanel"
      aria-labelledby="tab-worker"
      hidden={activeTab !== "worker"}
      bind:this={workerPane}
      onscroll={(event) => onPaneScroll("worker", event)}
    >
      <WorkerPane items={workers} />
    </div>
  </div>
</aside>

<style>
  .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: clip;
    background: var(--bg);
  }

  .panel.is-split { background: var(--panel); border-left: 1px solid var(--line); }

  .panel.is-resizing {
    user-select: none;
  }

  .resizer {
    position: absolute;
    inset-block: 0;
    left: 0;
    z-index: 6;
    width: 10px;
    cursor: col-resize;
    touch-action: none;
    outline: none;
  }

  .resizer::after {
    content: "";
    position: absolute;
    inset-block: 0;
    left: 0;
    width: 2px;
    background: transparent;
    transition: background 180ms var(--ease);
  }

  .resizer:hover::after,
  .resizer:focus-visible::after,
  .resizer.is-active::after {
    background: var(--primary);
  }

  .resizer:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .panel-body {
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .panel-pane {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    padding-top: 16px;
  }

  .terminal-pane {
    padding-top: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

</style>
