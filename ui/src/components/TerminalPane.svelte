<script module lang="ts">
  export const TERMINAL_LINE_LIMIT = 600;

  export function stripAnsi(input: string): string {
    let output = "";
    let index = 0;
    while (index < input.length) {
      const char = input[index];
      if (char !== "\u001B") {
        output += char;
        index += 1;
        continue;
      }
      const next = input[index + 1];
      if (next === "[") {
        index += 2;
        while (index < input.length) {
          const code = input.charCodeAt(index);
          index += 1;
          if (code >= 0x40 && code <= 0x7e) break;
        }
        continue;
      }
      if (next === "]") {
        index += 2;
        while (index < input.length) {
          if (input[index] === "\u0007") {
            index += 1;
            break;
          }
          if (input[index] === "\u001B" && input[index + 1] === "\\") {
            index += 2;
            break;
          }
          index += 1;
        }
        continue;
      }
      index += next === undefined ? 1 : 2;
    }
    return output;
  }

  export function cleanTerminalText(input: string): string {
    const cleaned = stripAnsi(input).replaceAll("\r\n", "\n");
    const lastReturn = cleaned.lastIndexOf("\r");
    return lastReturn >= 0 ? cleaned.slice(lastReturn + 1) : cleaned;
  }
</script>

<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { onMount, tick } from "svelte";
  import type { TerminalLine } from "../lib/types";
  import Icon from "./Icon.svelte";
  import CopyButton from "./CopyButton.svelte";

  interface Props {
    lines: TerminalLine[];
  }

  const ZOOM_KEY = "liquid.terminal.zoom";

  let { lines }: Props = $props();
  let scrollEl = $state<HTMLDivElement | null>(null);
  let follow = $state(true);
  let pending = $state(0);
  let zoom = $state(1);
  let lastCount = 0;

  const truncated = $derived(lines.length >= TERMINAL_LINE_LIMIT);

  function copyOutput(): string {
    return lines.map((line) => `${line.prompt ? "$ " : ""}${cleanTerminalText(line.text)}`).join("\n");
  }

  function scrollToBottom(): void {
    if (!scrollEl) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function jumpToLatest(): void {
    follow = true;
    pending = 0;
    void tick().then(scrollToBottom);
  }

  function onScroll(): void {
    if (!scrollEl) return;
    const nearBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 28;
    follow = nearBottom;
    if (nearBottom) pending = 0;
  }

  function setZoom(value: number): void {
    zoom = Math.min(1.4, Math.max(0.8, Math.round(value * 10) / 10));
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(ZOOM_KEY, String(zoom));
      } catch {
        // Zoom is cosmetic; persistence is optional.
      }
    }
  }

  $effect(() => {
    const count = lines.length;
    const grew = count - lastCount;
    lastCount = count;
    if (grew > 0 && !follow) pending += grew;
    if (follow) void tick().then(scrollToBottom);
  });

  onMount(() => {
    if (typeof localStorage !== "undefined") {
      const stored = Number(localStorage.getItem(ZOOM_KEY));
      if (Number.isFinite(stored) && stored >= 0.8 && stored <= 1.4) zoom = stored;
    }
    lastCount = lines.length;
    void tick().then(scrollToBottom);
    const observer = new ResizeObserver(() => {
      if (follow) scrollToBottom();
    });
    if (scrollEl) observer.observe(scrollEl);
    return () => observer.disconnect();
  });

</script>

<div class="terminal-head">
  <div class="term-actions">
    <button
      class="term-btn"
      type="button"
      aria-label={t("Decrease terminal font size")}
      title={t("Decrease terminal font size")}
      disabled={zoom <= 0.8}
      onclick={() => setZoom(zoom - 0.1)}
    >
      A−
    </button>
    <button
      class="term-btn"
      type="button"
      aria-label={t("Increase terminal font size")}
      title={t("Increase terminal font size")}
      disabled={zoom >= 1.4}
      onclick={() => setZoom(zoom + 0.1)}
    >
      A+
    </button>
    <CopyButton text={copyOutput} label={t("Copy all output")} disabled={lines.length === 0} />
  </div>
</div>
<div class="terminal-wrap">
  <div
    class="terminal"
    bind:this={scrollEl}
    onscroll={onScroll}
    style={`--term-scale: ${zoom}`}
    role="log"
    aria-live="polite"
    aria-label={t("Terminal output")}
  >
    {#if truncated}
      <div class="term-note" title={t("Earlier lines are no longer stored in the interface")}>{t("Showing the last {0} lines", [TERMINAL_LINE_LIMIT])}</div>
    {/if}
    {#if lines.length === 0}
      <div class="term-empty">{t("No commands yet")}</div>
    {/if}
    {#each lines as line, index (index)}
      <div class="term-line {line.tone ?? ""}">
        {#if line.prompt}<span class="term-prompt">$</span>{/if}
        {cleanTerminalText(line.text)}
        {#if line.cursor}<span class="term-cursor" aria-hidden="true"></span>{/if}
      </div>
    {/each}
  </div>
  {#if !follow}
    <button class="term-jump" type="button" onclick={jumpToLatest}>
      <Icon name="chevron-down" size={13} /> {t("Scroll to latest lines")} {#if pending > 0}<span class="term-pending">+{pending}</span>{/if}
    </button>
  {/if}
</div>

<style>
  .terminal-head {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 44px;
    flex: none;
    padding: 0 8px 0 16px;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 12px;
  }

  .term-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
    flex: none;
  }

  .term-btn {
    display: grid;
    place-items: center;
    min-width: 40px;
    height: 40px;
    border-radius: 6px;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 12px;
    transition:
      background var(--t-touch) var(--ease),
      color var(--t-touch) var(--ease),
      border-radius 460ms var(--ease-jelly);
  }

  .term-btn:disabled {
    opacity: 0.4;
  }

  .term-btn:hover:not(:disabled) {
    border-radius: 9px;
    background: rgba(240, 239, 237, 0.06);
    color: var(--text-2);
  }

  .term-btn:focus-visible,
  .term-jump:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .terminal-wrap {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
    background: #0d0d0d;
  }

  .terminal {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 16px;
    color: var(--text-2);
    font-family: var(--mono);
    font-size: calc(12.5px * var(--term-scale, 1));
    line-height: 1.9;
  }

  .term-line {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .term-empty {
    color: var(--muted);
  }

  .term-note {
    margin-bottom: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    background: rgba(211, 189, 145, 0.08);
    color: var(--warning);
    font-family: var(--font);
    font-size: 12px;
    line-height: 1.45;
  }

  .term-prompt {
    margin-right: 6px;
    color: var(--primary);
  }

  .term-line.pass {
    color: #aacb80;
  }

  .term-line.muted {
    color: var(--muted);
  }

  .term-cursor {
    display: inline-block;
    width: 7px;
    height: 15px;
    vertical-align: text-bottom;
    background: var(--text-2);
    animation: term-blink 1.1s steps(2, start) infinite;
  }

  @keyframes term-blink {
    0%,
    49% {
      opacity: 1;
    }
    50%,
    100% {
      opacity: 0;
    }
  }

  .term-jump {
    position: absolute;
    right: 16px;
    bottom: 14px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 0 12px;
    border-radius: 8px;
    background: var(--raised);
    box-shadow:
      0 0 0 1px rgba(240, 239, 237, 0.1),
      0 8px 24px rgba(0, 0, 0, 0.35);
    color: var(--text-2);
    font-size: 12px;
    animation: jump-in 320ms var(--ease-jelly);
  }

  .term-pending {
    color: var(--primary);
    font-variant-numeric: tabular-nums;
  }

  @keyframes jump-in {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @media (max-height: 720px) {
    .terminal {
      padding: 12px 16px;
      line-height: 1.75;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .term-jump {
      animation: none;
    }

    .term-cursor {
      animation: none;
      opacity: 1;
    }
  }
</style>
