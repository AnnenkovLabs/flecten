<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import manropeCyrillic from "../assets/fonts/manrope-cyrillic.woff2?url";
  import manropeLatin from "../assets/fonts/manrope-latin.woff2?url";
  import { parseSummaryMessage, SUMMARY_SANDBOX } from "../lib/markdown/sanitize";
  import type { SummaryActionMessage } from "../lib/markdown/sanitize";
  import { SummaryHtmlStream, type SummaryToken } from "../lib/markdown/summary-tokenizer";
  import { ACCENT_ROLES_CSS, summaryKitCss } from "../lib/markdown/summary-kit";
  import { themeCss } from "../lib/markdown/theme";
  import { fallbackToken, HARNESS_TOKENS } from "../lib/markdown/tokens";

  interface Props {
    html: string;
    complete?: boolean;
    title?: string;
    onAction?: (message: SummaryActionMessage) => void;
  }

  let { html, complete = false, title = t("Summary"), onAction }: Props = $props();

  const TYPE = "liquid-summary";
  const VERSION = 1;
  // ponytail: hard cap per artifact. Stream larger reports from disk if they ever need it.
  const MAX_SUMMARY_CHARS = 512 * 1024;
  const CYRILLIC_RANGE =
    "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116";
  const LATIN_RANGE =
    "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

  // Accent tokens reach the frame under internal names; ACCENT_ROLES_CSS gives them back
  // to var(--primary) only where accent is allowed.
  const ACCENT: Record<string, string> = {
    "--primary": "--summary-accent",
    "--primary-end": "--summary-accent-end",
    "--primary-hover": "--summary-accent-hover",
  };

  function tokensCss(): string {
    const style =
      typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
    const entries = Object.keys(HARNESS_TOKENS).map((name) => {
      const value = style?.getPropertyValue(name).trim() || fallbackToken(name);
      const accent = ACCENT[name];
      return accent ? `${accent}:${value};${name}:var(--text-2)` : `${name}:${value}`;
    });
    return `:root{${entries.join(";")}}${ACCENT_ROLES_CSS}`;
  }

  function base64(data: ArrayBuffer): string {
    const bytes = new Uint8Array(data);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  }

  async function fontFace(url: string, range: string): Promise<string> {
    try {
      const response = await fetch(url);
      if (!response.ok) return "";
      const data = await response.arrayBuffer();
      return `@font-face{font-family:"Manrope";src:url(data:font/woff2;base64,${base64(data)}) format("woff2");font-weight:200 800;font-style:normal;font-display:block;unicode-range:${range}}`;
    } catch {
      return "";
    }
  }

  let faces: Promise<string> | null = null;
  function fontCss(): Promise<string> {
    faces ??= Promise.all([fontFace(manropeCyrillic, CYRILLIC_RANGE), fontFace(manropeLatin, LATIN_RANGE)]).then(
      (parts) => parts.join(""),
    );
    return faces;
  }

  // ponytail: cache the config for this artifact; hoist the cache to the module if
  // many summaries on screen make the repeated font encoding visible.
  let config: Promise<string> | null = null;

  function configCss(): Promise<string> {
    config ??= fontCss().then(
      (font) =>
        `${font}${themeCss}${summaryKitCss}${tokensCss()}html,body{margin:0;max-width:100%;background:transparent}body{color:var(--text-body);font-family:var(--font);-webkit-font-smoothing:antialiased}#summary-root{max-width:100%;padding:0}`,
    );
    return config;
  }

  const summaryUrl = "liquid-summary://shell";

  let frame = $state<HTMLIFrameElement | null>(null);
  let height = $state(0);
  let streaming = $state(false);
  const visible = $derived(streaming && height > 0);

  let scanner = new SummaryHtmlStream();
  let sourceText = "";
  let pending: SummaryToken[] = [];
  let frameReady = false;
  let configuring = false;
  let finished = false;
  let sentFinish = false;
  let raf = 0;
  let shrinkTimer: ReturnType<typeof setTimeout> | undefined;

  function post(message: Record<string, unknown>): void {
    frame?.contentWindow?.postMessage({ type: TYPE, version: VERSION, ...message }, "*");
  }

  function applyHeight(next: number): void {
    const value = Math.max(0, Math.min(20000, Math.ceil(next)));
    if (value >= height) {
      clearTimeout(shrinkTimer);
      height = value;
      return;
    }
    clearTimeout(shrinkTimer);
    shrinkTimer = setTimeout(() => {
      height = value;
    }, 140);
  }

  function resetStream(): void {
    scanner = new SummaryHtmlStream();
    sourceText = "";
    pending = [];
    finished = false;
    sentFinish = false;
    streaming = false;
    height = 0;
    clearTimeout(shrinkTimer);
    if (frameReady) post({ kind: "reset" });
  }

  function flush(): void {
    if (!frameReady) return;
    const target = frame?.contentWindow;
    if (!target) return;
    if (pending.length > 0) {
      target.postMessage({ type: TYPE, version: VERSION, kind: "append", tokens: pending }, "*");
      pending = [];
    }
    if (finished && !sentFinish) {
      target.postMessage({ type: TYPE, version: VERSION, kind: "finish" }, "*");
      sentFinish = true;
    }
  }

  function schedule(): void {
    if (raf !== 0) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      flush();
    });
  }

  $effect(() => {
    const source = html.slice(0, MAX_SUMMARY_CHARS);
    const done = complete;
    if (!source.startsWith(sourceText) || (finished && source !== sourceText)) resetStream();
    if (source.length > sourceText.length) {
      const chunk = source.slice(sourceText.length);
      sourceText = source;
      for (const token of scanner.push(chunk)) pending.push(token);
    }
    if (done && !finished) {
      for (const token of scanner.finish()) pending.push(token);
      finished = true;
    }
    schedule();
  });

  $effect(() => {
    const element = frame;
    if (!element) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== element.contentWindow) return;
      const message = parseSummaryMessage(event.data);
      if (!message) return;
      if (message.kind === "ready") {
        if (frameReady || configuring) return;
        const target = element.contentWindow;
        if (!target) return;
        configuring = true;
        void configCss()
          .then((css) => {
            target.postMessage({ type: TYPE, version: VERSION, kind: "config", css }, "*");
            frameReady = true;
            schedule();
          })
          .finally(() => {
            configuring = false;
          });
        return;
      }
      if (message.kind === "content") {
        streaming = true;
        return;
      }
      if (message.kind === "height") {
        applyHeight(message.height);
        return;
      }
      onAction?.(message);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  });

  $effect(() => {
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      clearTimeout(shrinkTimer);
    };
  });
</script>

<div
  class="summary-shell"
  class:is-loading={!visible}
  class:is-visible={visible}
  aria-busy={!visible}
>
  {#if !visible}
    <div class="summary-skeleton" role="status" aria-label={t("Preparing summary")}>
      <span class="line is-title" style="width: 38%"></span>
      <span class="line" style="width: 92%"></span>
      <span class="line" style="width: 78%"></span>
      <span class="block" style="height: 48px"></span>
      <span class="line" style="width: 84%"></span>
    </div>
  {/if}
  <iframe
    bind:this={frame}
    class="summary summary-frame"
    {title}
    src={summaryUrl}
    sandbox={SUMMARY_SANDBOX}
    referrerpolicy="no-referrer"
    scrolling="no"
    style:height={`${height}px`}
  ></iframe>
</div>

<style>
  .summary-shell {
    position: relative;
    margin-top: 18px;
    padding: 20px 22px 22px;
    border-radius: 12px;
    background:
      linear-gradient(180deg, rgba(240, 239, 237, 0.028), rgba(240, 239, 237, 0.008)),
      var(--surface);
    box-shadow:
      inset 0 1px 0 rgba(240, 239, 237, 0.07),
      0 0 0 1px rgba(255, 255, 255, 0.065);
    animation: summary-enter 520ms var(--ease-soft) both;
  }

  .summary-shell.is-loading {
    min-height: 176px;
  }

  .summary-frame {
    display: block;
    width: 100%;
    border: 0;
    background: transparent;
    color-scheme: dark;
    opacity: 0;
    pointer-events: none;
    transition: opacity 260ms var(--ease);
  }

  .summary-shell.is-visible .summary-frame {
    opacity: 1;
    pointer-events: auto;
  }

  .summary-skeleton {
    position: absolute;
    inset: 20px 22px 22px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: none;
  }

  .summary-skeleton .line,
  .summary-skeleton .block {
    display: block;
    border-radius: 5px;
    background: linear-gradient(
      90deg,
      var(--raised) 0%,
      var(--line-strong) 48%,
      var(--raised) 100%
    );
    background-size: 220% 100%;
    animation: summary-shimmer 1.5s linear infinite;
  }

  .summary-skeleton .line {
    height: 10px;
  }

  .summary-skeleton .line.is-title {
    height: 14px;
    margin-bottom: 2px;
  }

  .summary-skeleton .block {
    margin: 3px 0;
  }

  @keyframes summary-enter {
    from {
      opacity: 0;
      transform: translateY(11px) scale(0.992);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes summary-shimmer {
    from {
      background-position: 120% 0;
    }
    to {
      background-position: -120% 0;
    }
  }

  @media (max-width: 640px) {
    .summary-shell {
      padding: 16px 16px 18px;
      border-radius: 10px;
    }

    .summary-skeleton {
      inset: 16px 16px 18px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .summary-shell {
      animation: none;
    }

    .summary-frame {
      transition: none;
    }

    .summary-skeleton .line,
    .summary-skeleton .block {
      animation: none;
    }
  }
</style>
