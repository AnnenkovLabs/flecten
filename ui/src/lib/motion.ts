/// <reference lib="dom" />

const DRAWER = "cubic-bezier(0.32, 0.72, 0, 1)";

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function shouldAnimate(current: boolean, next: boolean): boolean {
  return current !== next;
}

export function expandable(node: HTMLElement, open: boolean) {
  let current = open;

  function settle(value: boolean): void {
    node.hidden = !value;
    node.style.overflow = "";
    node.style.height = "";
  }

  function apply(value: boolean, animate: boolean, start?: number): void {
    for (const animation of node.getAnimations()) animation.cancel();

    if (!animate || prefersReducedMotion()) {
      settle(value);
      return;
    }

    const from = start ?? (node.hidden ? 0 : node.getBoundingClientRect().height);
    node.hidden = false;
    node.style.overflow = "hidden";
    const height = node.scrollHeight;
    const frames = [
      { height: `${from}px`, opacity: value && from === 0 ? 0 : 1 },
      { height: `${value ? height : 0}px`, opacity: value ? 1 : 0 },
    ];
    const animation = node.animate(frames, {
      duration: value ? 220 : 160,
      easing: DRAWER,
    });

    animation.onfinish = () => settle(value);
  }

  apply(open, false);

  let queued = 0;

  return {
    update(next: boolean) {
      if (!shouldAnimate(current, next)) return;
      current = next;
      const from = node.hidden ? 0 : node.getBoundingClientRect().height;
      const ticket = ++queued;
      queueMicrotask(() => {
        if (ticket === queued) apply(next, true, from);
      });
    },
  };
}

/** A settings section changes identity only when navigation changes, never while editing. */
export function settingsSection(node: HTMLElement, identity: string) {
  let current = identity;
  let active: Animation | undefined;
  return {
    update(next: string) {
      if (next === current) return;
      current = next;
      active?.cancel();
      if (prefersReducedMotion()) return;
      active = node.animate([{ opacity: 0.45 }, { opacity: 1 }], {
        duration: 140,
        easing: DRAWER,
      });
    },
    destroy() {
      active?.cancel();
    },
  };
}

export function enterPane(node: HTMLElement): void {
  if (prefersReducedMotion()) return;
  for (const animation of node.getAnimations()) animation.cancel();
  node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: DRAWER });
}
