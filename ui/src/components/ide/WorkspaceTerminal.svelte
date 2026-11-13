<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { onMount } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { terminalCommand } from "../../lib/ide/terminal";
  import { copyText } from "../../lib/clipboard.svelte";
  import "@xterm/xterm/css/xterm.css";
  import Icon from "../Icon.svelte";
  let { visible }: { visible: boolean } = $props();
  let host: HTMLDivElement;
  let error = $state<string | null>(null);
  let terminal: Terminal | undefined;
  let fit: FitAddon | undefined;
  let cursor = 0;
  let epoch = -1;
  let stopped = $state(false);
  let hasSelection = $state(false);

  async function restart(): Promise<void> { await terminalCommand("restart"); cursor = 0; epoch = -1; stopped = false; error = null; terminal?.focus(); }
  onMount(() => {
    const tokens = getComputedStyle(host);
    terminal = new Terminal({ cursorBlink: false, fontSize: 13, fontFamily: tokens.getPropertyValue("--mono"), scrollback: 3000, screenReaderMode: true, theme: { background: tokens.getPropertyValue("--bg").trim(), foreground: tokens.getPropertyValue("--text-2").trim(), cursor: tokens.getPropertyValue("--text").trim(), selectionBackground: tokens.getPropertyValue("--raised-hover").trim() } });
    fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(host);
    const selection = terminal.onSelectionChange(() => hasSelection = terminal?.hasSelection() ?? false);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && event.ctrlKey && event.shiftKey && event.code === "KeyC" && terminal?.hasSelection()) {
        void copyText(terminal.getSelection()); return false;
      }
      return true;
    });
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let writes = Promise.resolve();
    const input = terminal.onData((data) => {
      writes = writes.then(async () => { await terminalCommand("write", { data }); }).catch((cause: unknown) => { error = String(cause); });
    });
    async function poll(): Promise<void> {
      if (!alive) return;
      if (visible && !stopped) {
        try {
          const result = await terminalCommand("read", { cursor });
          if (!alive) return;
          if (result.reset || (epoch !== -1 && result.epoch !== epoch)) terminal?.reset();
          epoch = result.epoch; cursor = result.cursor;
          if (result.data) terminal?.write(result.data);
          stopped = !result.running;
        } catch (cause) { if (alive) error = t("Terminal unavailable. {0}", [String(cause)]); }
      }
      if (alive) timer = setTimeout(() => void poll(), error ? 2000 : 150);
    }
    const observer = new ResizeObserver(() => {
      if (!visible || !host.clientWidth || !host.clientHeight) return;
      fit?.fit();
      if (terminal) void terminalCommand("resize", { cols: Math.max(10, terminal.cols), rows: Math.max(2, terminal.rows) }).catch((cause: unknown) => { error = String(cause); });
    });
    observer.observe(host); void poll();
    return () => { alive = false; clearTimeout(timer); observer.disconnect(); input.dispose(); selection.dispose(); terminal?.dispose(); };
  });
  $effect(() => { if (visible) requestAnimationFrame(() => { fit?.fit(); terminal?.focus(); }); });
</script>
<div class="workspace-terminal">
  <div class="terminal-actions"><span>{stopped ? t("Shell exited") : t("Project shell")}</span><button type="button" disabled={!hasSelection} aria-label={t("Copy")} title={t("Copy")} onclick={() => terminal && void copyText(terminal.getSelection())}><Icon name="copy" size={14} /></button><button type="button" aria-label={t("Clear terminal")} title={t("Clear terminal")} onclick={() => terminal?.clear()}><Icon name="trash" size={14} /></button><button type="button" aria-label={t("Restart terminal")} title={t("Restart terminal")} onclick={() => void restart().catch((cause: unknown) => error = String(cause))}><Icon name="refresh" size={14} /></button><button type="button" aria-label={t("Stop terminal")} title={t("Stop terminal")} onclick={() => void terminalCommand("stop").then(() => stopped = true).catch((cause: unknown) => error = String(cause))}><Icon name="stop" size={14} /></button></div>
  {#if error}<p role="alert">{error}<button type="button" onclick={() => void restart()}>{t("Retry")}</button></p>{/if}
  <div class="terminal-host" bind:this={host}></div>
</div>
<style>
  .workspace-terminal { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; } .terminal-actions { display: flex; align-items: center; gap: 4px; padding-inline: 16px 8px; height: 28px; flex: none; color: var(--muted); font-size: 12px; } .terminal-actions span { flex: 1; } button { width: 28px; height: 28px; } .terminal-host { flex: 1; min-height: 0; min-width: 0; padding: 4px 12px 6px; overflow: hidden; } p { display: flex; gap: 12px; padding-inline: 16px; font-size: 12px; color: var(--error); } p button { width: auto; text-decoration: underline; }
</style>
