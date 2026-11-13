<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { popoverPlacement } from "../lib/popover";

  interface Props {
    anchor: HTMLElement | null;
    label: string;
    width?: number;
    maxHeight?: number;
    preferred?: "above" | "below";
    class?: string;
    onClose: () => void;
    onkeydown?: (event: KeyboardEvent) => void;
    children: Snippet;
  }

  let {
    anchor, label, width = 304, maxHeight = 328, preferred = "above",
    class: className = "", onClose, onkeydown, children,
  }: Props = $props();
  let menu: HTMLDivElement;

  onMount(() => {
    const position = (): void => {
      if (!anchor) return;
      const visible = window.visualViewport;
      const viewport = {
        left: visible?.offsetLeft ?? 0, top: visible?.offsetTop ?? 0,
        width: visible?.width ?? window.innerWidth, height: visible?.height ?? window.innerHeight,
      };
      const placement = popoverPlacement(anchor.getBoundingClientRect(), viewport, width, maxHeight, preferred);
      menu.style.width = `${placement.width}px`;
      menu.style.maxHeight = `${placement.maxHeight}px`;
      menu.style.left = `${placement.left}px`;
      // Short menus sit against their trigger instead of reserving their maximum height.
      const top = placement.top < anchor.getBoundingClientRect().top
        ? placement.top + placement.maxHeight - menu.getBoundingClientRect().height
        : placement.top;
      menu.style.top = `${Math.max(viewport.top + 8,
        Math.min(top, viewport.top + viewport.height - 8 - menu.getBoundingClientRect().height))}px`;
    };
    menu.showPopover();
    position();
    const observer = new ResizeObserver(position);
    observer.observe(menu);
    if (anchor) observer.observe(anchor);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  });
</script>

<div
  bind:this={menu}
  class="floating-menu {className}"
  popover="auto"
  role="dialog"
  aria-label={label}
  tabindex="-1"
  {onkeydown}
  ontoggle={(event) => { if (event.newState === "closed" && menu.isConnected) onClose(); }}
>
  {@render children()}
</div>

<style>
  .floating-menu {
    position: fixed;
    inset: auto;
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(240, 239, 237, 0.06);
    opacity: 0;
    translate: 0 2px;
    transition:
      opacity 120ms var(--ease),
      translate 120ms var(--ease),
      display 120ms allow-discrete,
      overlay 120ms allow-discrete;
  }

  .floating-menu:popover-open {
    display: flex;
    flex-direction: column;
    opacity: 1;
    translate: 0 0;
  }

  @starting-style {
    .floating-menu:popover-open { opacity: 0; translate: 0 2px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .floating-menu { transition: none; translate: none; }
  }
</style>
