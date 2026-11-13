<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { copyText, COPY_FEEDBACK_MS } from "../lib/clipboard.svelte";
  import { renderMarkdown } from "../lib/markdown/render";
  import { renderMermaid } from "../lib/markdown/mermaid";
  import { themeCss } from "../lib/markdown/theme";

  interface Props {
    text: string;
  }

  let { text }: Props = $props();

  const html = $derived(renderMarkdown(text));
  const timers = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>();
  let root = $state<HTMLDivElement | null>(null);
  let mermaidTimer: ReturnType<typeof setTimeout> | undefined;
  let renderPass = 0;

  function copyLabel(button: HTMLButtonElement): string {
    const block = button.closest(".code-block");
    const language = block?.querySelector(".code-lang")?.textContent?.trim();
    return language && language !== "text" ? t("Copy code: {0}", [language]) : t("Copy code");
  }

  function feedback(button: HTMLButtonElement, label: string, text: string): void {
    const timer = timers.get(button);
    if (timer) clearTimeout(timer);
    button.textContent = text;
    button.setAttribute("aria-label", label);
    button.classList.toggle("is-copied", text === t("Copied"));
    timers.set(
      button,
      setTimeout(() => {
        timers.delete(button);
        if (!button.isConnected) return;
        button.textContent = t("Copy");
        button.setAttribute("aria-label", copyLabel(button));
        button.classList.remove("is-copied");
      }, COPY_FEEDBACK_MS),
    );
  }

  async function copyCode(button: HTMLButtonElement): Promise<void> {
    const block = button.closest(".code-block");
    if (!block) return;
    const code =
      block.querySelector<HTMLElement>(".diagram-source code") ??
      block.querySelector<HTMLElement>("pre code");
    const value = code?.textContent ?? "";
    if (!value) {
      feedback(button, t("Nothing to copy"), t("Empty"));
      return;
    }
    if (await copyText(value)) feedback(button, t("Code copied"), t("Copied"));
    else feedback(button, t("Could not copy. Try again."), t("Error"));
  }

  function showFailure(node: HTMLElement): void {
    if (node.querySelector(".diagram-error")) return;
    const error = document.createElement("p");
    error.className = "diagram-error";
    error.setAttribute("role", "status");
    error.textContent = t("Could not render the Mermaid diagram. The source code is shown below.");
    node.querySelector(".mermaid-canvas")?.before(error);
  }

  async function renderDiagrams(element: HTMLElement, pass: number): Promise<void> {
    const nodes = Array.from(element.querySelectorAll<HTMLElement>(".mermaid-diagram"));
    for (const [index, node] of nodes.entries()) {
      const source = node.querySelector(".diagram-source code")?.textContent?.trim();
      const canvas = node.querySelector<HTMLElement>(".mermaid-canvas");
      if (!source || !canvas) continue;
      try {
        const svg = await renderMermaid(source, `liquid-mermaid-${pass}-${index}`);
        if (pass !== renderPass || !node.isConnected) return;
        if (!svg) throw new Error("unsafe svg");
        canvas.innerHTML = svg;
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", t("Mermaid diagram, source code below"));
      } catch {
        if (pass !== renderPass || !node.isConnected) return;
        showFailure(node);
      }
    }
  }

  $effect(() => {
    const id = "liquid-markdown-theme";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = themeCss;
    document.head.append(style);
  });

  $effect(() => {
    const element = root;
    if (!element) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button.code-copy");
      if (!(button instanceof HTMLButtonElement) || !element.contains(button)) return;
      event.preventDefault();
      void copyCode(button);
    };
    element.addEventListener("click", onClick);
    return () => element.removeEventListener("click", onClick);
  });

  $effect(() => {
    const element = root;
    void html;
    if (!element) return;
    renderPass += 1;
    const pass = renderPass;
    clearTimeout(mermaidTimer);
    if (!element.querySelector(".mermaid-diagram")) return;
    mermaidTimer = setTimeout(() => {
      void renderDiagrams(element, pass);
    }, 250);
    return () => clearTimeout(mermaidTimer);
  });

  $effect(() => {
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  });
</script>

<div class="markdown" bind:this={root}>{@html html}</div>
