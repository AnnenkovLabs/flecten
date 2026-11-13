<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { untrack } from "svelte";
  import { modal } from "../../lib/modal";
  let { line, total, onGo, onClose }: { line: number; total: number; onGo: (line: number, column: number) => void; onClose: () => void } = $props();
  let input: HTMLInputElement;
  let value = $state(untrack(() => String(line)));
  let error = $state("");
  function go(): void {
    const [line, column = "1"] = value.split(":");
    const row = Number(line); const col = Number(column);
    if (!Number.isInteger(row) || row < 1 || row > total || !Number.isInteger(col) || col < 1) { error = t("Enter a line number from 1 to {0}, optionally followed by a colon and column number.", [total]); return; }
    onGo(row, col); onClose();
  }
</script>
<dialog use:modal={() => input} aria-label={t("Go to line")} oncancel={(event) => { event.preventDefault(); onClose(); }}>
  <form onsubmit={(event) => { event.preventDefault(); go(); }}><label for="go-line">{t("Go to line")} <span>1…{total}</span></label><input bind:this={input} id="go-line" bind:value={value} placeholder={t("line:column")} aria-invalid={!!error} /><p role="status">{error || t("Enter a line number or line:column. Press Enter to go, Esc to cancel.")}</p></form>
</dialog>
<style>
  dialog { top: 72px; margin: 0 auto; width: min(520px, calc(100vw - 32px)); padding: 16px; background: var(--raised); color: var(--text); border: 1px solid var(--line-strong); border-radius: 8px; } dialog::backdrop { background: #0005; } form { display: flex; flex-direction: column; gap: 8px; } label { display: flex; justify-content: space-between; font-size: 13px; } label span, p { color: var(--muted); font-size: 12px; } input { height: 36px; padding-inline: 10px; background: var(--bg); border: 1px solid var(--line-strong); border-radius: 4px; font-size: 14px; } p { margin: 0; }
</style>
