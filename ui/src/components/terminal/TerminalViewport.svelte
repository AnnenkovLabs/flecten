<script lang="ts">
  import { onMount } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";
  import type { TerminalTabInfo } from "../../../../shared/terminal";
  import { copyText } from "../../lib/clipboard.svelte";
  import { openExternal } from "../../lib/desktop";
  import { t } from "../../lib/i18n.svelte";
  import { macPlatform } from "../../lib/platform";
  import type { TerminalStore } from "../../lib/terminal/store.svelte";
  import {
    buildTerminalOptions,
    createTerminalLinkProvider,
    highlightTerminalMatch,
    protectTerminalPalette,
    searchTerminalBuffer,
    type TerminalMatch,
  } from "../../lib/terminal/xterm-config";
  import Icon from "../Icon.svelte";
  import TerminalOverlays from "./TerminalOverlays.svelte";

  interface Props {
    store: TerminalStore;
    tab: TerminalTabInfo;
    active: boolean;
    findToken: number;
    onOpenFile?: ((path: string, line?: number, column?: number) => void) | undefined;
    onNewTab: () => void;
  }

  let { store, tab, active, findToken, onOpenFile, onNewTab }: Props = $props();

  let host: HTMLDivElement;
  let terminal: Terminal | undefined;
  let fit: FitAddon | undefined;
  let lastCols = 0;
  let lastRows = 0;
  let lastCursor = 0;
  let hasSelection = $state(false);
  let findOpen = $state(false);
  let findQuery = $state("");
  let findCase = $state(false);
  let matches = $state<TerminalMatch[]>([]);
  let matchIndex = $state(0);
  let contextMenu = $state<{ x: number; y: number } | null>(null);
  let lastFindToken = 0;

  const errorText = $derived(store.errors[tab.id] ?? null);

  function fitAndResize(): void {
    if (!active || !fit || !terminal || !host || !host.clientWidth || !host.clientHeight) return;
    try {
      fit.fit();
    } catch {
      return;
    }
    const cols = Math.max(10, terminal.cols);
    const rows = Math.max(2, terminal.rows);
    if (cols !== lastCols || rows !== lastRows) {
      lastCols = cols;
      lastRows = rows;
      store.resize(tab.id, cols, rows);
    }
  }

  async function pasteClipboard(): Promise<void> {
    if (!terminal) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) terminal.paste(text);
    } catch {}
  }

  function runFind(jump = true): void {
    if (!terminal) return;
    matches = searchTerminalBuffer(terminal, findQuery, findCase);
    if (matches.length === 0) {
      matchIndex = 0;
      return;
    }
    matchIndex = matches.length - 1;
    const hit = matches[matchIndex];
    if (jump && hit) highlightTerminalMatch(terminal, hit);
  }

  function openFind(): void {
    findOpen = true;
    contextMenu = null;
    if (terminal?.hasSelection()) {
      const selected = terminal.getSelection().trim();
      if (selected && !selected.includes("\n")) findQuery = selected;
    }
    runFind(false);
  }

  function closeFind(): void {
    findOpen = false;
    terminal?.clearSelection();
    terminal?.focus();
  }

  function stepFind(delta: number): void {
    if (!terminal || matches.length === 0) return;
    matchIndex = (matchIndex + delta + matches.length) % matches.length;
    const hit = matches[matchIndex];
    if (hit) highlightTerminalMatch(terminal, hit);
  }

  function openContextMenu(event: MouseEvent): void {
    event.preventDefault();
    contextMenu = {
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 210)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 240)),
    };
  }

  function onMiddleClick(event: MouseEvent): void {
    if (event.button === 1 && !macPlatform) {
      event.preventDefault();
      void pasteClipboard();
    }
  }

  function handleKeyEvent(term: Terminal, event: KeyboardEvent): boolean {
    if (event.type !== "keydown") return true;
    const mod = macPlatform ? event.metaKey : event.ctrlKey;
    const code = event.code;
    if (mod && !event.shiftKey && !event.altKey && code === "Backquote") return false;
    if (mod && event.shiftKey && !event.altKey && code === "KeyP") return false;
    if (event.key === "F1") return false;

    if (mod && event.shiftKey && !event.altKey && code === "Backquote") {
      event.preventDefault();
      onNewTab();
      return false;
    }
    if (
      (macPlatform && event.metaKey && !event.ctrlKey && !event.altKey && code === "KeyC") ||
      (event.ctrlKey && event.shiftKey && !event.altKey && code === "KeyC") ||
      (!macPlatform &&
        event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        code === "KeyC" &&
        term.hasSelection())
    ) {
      if (term.hasSelection()) {
        event.preventDefault();
        void copyText(term.getSelection());
        term.clearSelection();
        return false;
      }
      return !macPlatform;
    }
    if (
      (macPlatform && event.metaKey && !event.ctrlKey && !event.altKey && code === "KeyV") ||
      (event.ctrlKey && event.shiftKey && !event.altKey && code === "KeyV") ||
      (!macPlatform && event.ctrlKey && !event.shiftKey && !event.altKey && code === "KeyV")
    ) {
      event.preventDefault();
      void pasteClipboard();
      return false;
    }
    if (mod && !event.shiftKey && !event.altKey && code === "KeyF") {
      event.preventDefault();
      openFind();
      return false;
    }
    if (
      (macPlatform && event.metaKey && !event.shiftKey && !event.altKey && code === "KeyK") ||
      (event.ctrlKey && event.shiftKey && !event.altKey && code === "KeyK")
    ) {
      event.preventDefault();
      term.clear();
      return false;
    }
    if (mod && !event.altKey && (code === "Equal" || code === "NumpadAdd")) {
      event.preventDefault();
      store.zoom(1);
      return false;
    }
    if (mod && !event.altKey && (code === "Minus" || code === "NumpadSubtract")) {
      event.preventDefault();
      store.zoom(-1);
      return false;
    }
    if (mod && !event.altKey && (code === "Digit0" || code === "Numpad0")) {
      event.preventDefault();
      store.resetZoom();
      return false;
    }
    return true;
  }

  onMount(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const term = new Terminal(buildTerminalOptions(host, store.fontSize, reducedMotion));
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    terminal = term;
    fit = fitAddon;

    const paletteDisposable = protectTerminalPalette(term);
    const linkDisposable = term.registerLinkProvider(
      createTerminalLinkProvider(term, {
        onUrl: (url) => void openExternal(url).catch(() => undefined),
        ...(onOpenFile ? { onFile: onOpenFile } : {}),
      }),
    );
    const selectionDisposable = term.onSelectionChange(() => {
      hasSelection = term.hasSelection();
    });
    const titleDisposable = term.onTitleChange((nextTitle) => {
      store.setDynamicTitle(tab.id, nextTitle);
    });
    const dataDisposable = term.onData((data) => store.write(tab.id, data));
    term.attachCustomKeyEventHandler((event) => handleKeyEvent(term, event));

    let alive = true;
    let replayed = false;
    const queued: Array<{ data: string; cursor: number }> = [];

    const unsubscribe = store.subscribe(tab.id, (event) => {
      if (!alive) return;
      if (event.type === "reset") {
        lastCursor = 0;
        queued.length = 0;
        term.reset();
        return;
      }
      if (event.type === "clear") {
        term.clear();
        return;
      }
      if (event.type === "data") {
        if (!replayed) {
          queued.push({ data: event.data, cursor: event.cursor });
          return;
        }
        if (event.cursor <= lastCursor) return;
        lastCursor = event.cursor;
        term.write(event.data);
      }
    });

    void store
      .readReplay(tab.id, 0)
      .then((snapshot) => {
        if (!alive) return;
        replayed = true;
        if (snapshot.data) term.write(snapshot.data);
        lastCursor = snapshot.cursor;
        for (const chunk of queued) {
          if (chunk.cursor > lastCursor) {
            lastCursor = chunk.cursor;
            term.write(chunk.data);
          }
        }
        queued.length = 0;
      })
      .catch(() => {
        replayed = true;
      });

    let fitFrame: number | null = null;
    const scheduleFit = (): void => {
      if (fitFrame !== null) return;
      fitFrame = requestAnimationFrame(() => {
        fitFrame = null;
        fitAndResize();
      });
    };
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(host);

    const dismissMenu = (): void => {
      contextMenu = null;
    };
    window.addEventListener("pointerdown", dismissMenu);
    window.addEventListener("blur", dismissMenu);
    if (active) {
      requestAnimationFrame(() => {
        fitAndResize();
        term.focus();
      });
    }

    return () => {
      alive = false;
      if (fitFrame !== null) cancelAnimationFrame(fitFrame);
      window.removeEventListener("pointerdown", dismissMenu);
      window.removeEventListener("blur", dismissMenu);
      observer.disconnect();
      unsubscribe();
      paletteDisposable();
      linkDisposable.dispose();
      selectionDisposable.dispose();
      titleDisposable.dispose();
      dataDisposable.dispose();
      term.dispose();
      terminal = undefined;
      fit = undefined;
    };
  });

  $effect(() => {
    const size = store.fontSize;
    if (terminal && terminal.options.fontSize !== size) {
      terminal.options.fontSize = size;
      requestAnimationFrame(fitAndResize);
    }
  });

  $effect(() => {
    if (active && terminal) {
      requestAnimationFrame(() => {
        fitAndResize();
        if (!findOpen) terminal?.focus();
      });
    }
  });

  $effect(() => {
    if (active && findToken !== lastFindToken) {
      lastFindToken = findToken;
      if (findToken > 0) openFind();
    }
  });
</script>

<div class="term-viewport" hidden={!active}>
  <TerminalOverlays
    {tab}
    {findOpen}
    {findQuery}
    {findCase}
    matchCount={matches.length}
    {matchIndex}
    {contextMenu}
    {hasSelection}
    onFindQuery={(value) => {
      findQuery = value;
      runFind(true);
    }}
    onToggleCase={() => {
      findCase = !findCase;
      runFind(true);
    }}
    onStepFind={stepFind}
    onCloseFind={closeFind}
    onCopy={() => {
      if (terminal?.hasSelection()) void copyText(terminal.getSelection());
      contextMenu = null;
      terminal?.focus();
    }}
    onPaste={() => {
      contextMenu = null;
      void pasteClipboard().then(() => terminal?.focus());
    }}
    onSelectAll={() => {
      terminal?.selectAll();
      contextMenu = null;
    }}
    onOpenFind={openFind}
    onClear={() => {
      terminal?.clear();
      contextMenu = null;
      terminal?.focus();
    }}
    onRestart={() => {
      contextMenu = null;
      void store.restart(tab.id);
    }}
    onCloseTab={() => {
      contextMenu = null;
      void store.close(tab.id);
    }}
  />

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="term-xterm-host terminal-host"
    bind:this={host}
    oncontextmenu={openContextMenu}
    onauxclick={onMiddleClick}
  ></div>

  {#if errorText}
    <div class="term-status-bar is-error" role="alert">
      <span>{errorText}</span>
      {#if tab.owner === "user"}
        <button class="term-status-action" type="button" onclick={() => void store.restart(tab.id)}>
          <Icon name="refresh" size={13} /> {t("Restart terminal")}
        </button>
      {/if}
    </div>
  {:else if !tab.running}
    <div class="term-status-bar" role="status">
      <span>
        {tab.exitCode !== null
          ? t("Process exited with code {0}", [tab.exitCode])
          : t("Shell exited")}
      </span>
      {#if tab.owner === "user"}
        <button class="term-status-action" type="button" onclick={() => void store.restart(tab.id)}>
          <Icon name="refresh" size={13} /> {t("Restart terminal")}
        </button>
      {/if}
      <button class="term-status-action" type="button" onclick={() => void store.close(tab.id)}>
        {t("Close terminal")}
      </button>
    </div>
  {/if}
</div>
