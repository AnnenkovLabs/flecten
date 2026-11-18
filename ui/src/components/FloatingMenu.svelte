<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { overlayPresence } from "../lib/overlay-presence";
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
    function position(): void {
      if (!anchor) return;
      const visible = window.visualViewport;
      const viewport = {
        left: visible?.offsetLeft ?? 0, top: visible?.offsetTop ?? 0,
        width: visible?.width ?? window.innerWidth, height: visible?.height ?? window.innerHeight,
      };
      const trigger = anchor.getBoundingClientRect();
      const placement = popoverPlacement(trigger, viewport, width, maxHeight, preferred);
      const above = placement.top < trigger.top;
      menu.style.setProperty("--menu-lift", above ? "6px" : "-6px");
      menu.style.setProperty("--menu-origin-y", above ? "bottom" : "top");
      menu.style.setProperty("--menu-origin-x", `${Math.max(0, Math.min(placement.width, trigger.left + trigger.width / 2 - placement.left))}px`);
      menu.style.width = `${placement.width}px`;
      menu.style.maxHeight = `${placement.maxHeight}px`;
      menu.style.left = `${placement.left}px`;
      if (!menu.matches(":popover-open")) return;
      // Short menus sit against their trigger instead of reserving their maximum height.
      const height = menu.offsetHeight;
      const top = above
        ? placement.top + placement.maxHeight - height
        : placement.top;
      menu.style.top = `${Math.max(viewport.top + 8,
        Math.min(top, viewport.top + viewport.height - 8 - height))}px`;
    }
    function onToggle(event: ToggleEvent): void {
      if (event.newState !== "open") return;
      position();
      queueMicrotask(position);
    }
    menu.addEventListener("beforetoggle", onToggle);
    if (!menu.matches(":popover-open")) menu.showPopover();
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
      menu.removeEventListener("beforetoggle", onToggle);
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
  transition:overlayPresence|global
  role="dialog"
  aria-label={label}
  tabindex="-1"
  {onkeydown}
  onbeforetoggle={(event) => { if (event.newState === "closed" && event.currentTarget.isConnected) onClose(); }}
>
  {@render children()}
</div>

<style>
  .floating-menu {
    --overlay-exit-ms: 120;
    --overlay-exit-time: calc(var(--overlay-exit-ms) * 1ms);
    --menu-lift: 6px;
    --menu-origin-y: bottom;
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
    translate: 0 var(--menu-lift);
    scale: 0.985 0.96;
    transform-origin: var(--menu-origin-x, 16px) var(--menu-origin-y);
    transition:
      opacity var(--overlay-exit-time) var(--ease),
      translate var(--overlay-exit-time) var(--ease),
      scale var(--overlay-exit-time) var(--ease),
      display var(--overlay-exit-time) allow-discrete,
      overlay var(--overlay-exit-time) allow-discrete;
  }

  .floating-menu:not(:popover-open) {
    pointer-events: none;
  }

  .floating-menu:popover-open {
    display: flex;
    flex-direction: column;
    opacity: 1;
    translate: 0 0;
    scale: 1;
    transition-duration: 180ms;
  }

  @starting-style {
    .floating-menu:popover-open { opacity: 0; translate: 0 var(--menu-lift); scale: 0.985 0.96; }
  }

  @media (prefers-reduced-motion: reduce) {
    .floating-menu { transition: none !important; }
  }
</style>
