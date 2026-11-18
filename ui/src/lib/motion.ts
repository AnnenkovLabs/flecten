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
  let active: Animation | undefined;

  function settle(value: boolean): void {
    node.hidden = !value;
    node.style.overflow = "";
    node.style.height = "";
  }

  function apply(value: boolean, animate: boolean, start?: number): void {
    active?.cancel();
    active = undefined;

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
    active = node.animate(frames, {
      duration: value ? 220 : 160,
      easing: DRAWER,
    });

    active.onfinish = () => {
      active = undefined;
      settle(value);
    };
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
    destroy() {
      queued += 1;
      active?.cancel();
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

/** Reveal the incoming edge while keeping the page at its final reading position. */
export function revealSurface(node: HTMLElement, edge: "left" | "right", dock = false) {
  if (prefersReducedMotion()) return;
  const depth = dock ? "28%" : "min(12%, 80px)";
  const from = edge === "left" ? `inset(0 ${depth} 0 0)` : `inset(0 0 0 ${depth})`;
  return node.animate([{ clipPath: from }, { clipPath: "inset(0)" }], {
    duration: dock ? 240 : 190,
    easing: DRAWER,
  });
}

export function revealWhenShown(node: HTMLElement, shown: boolean) {
  let current = shown;
  let active: Animation | undefined;
  return {
    update(next: boolean) {
      if (next === current) return;
      current = next;
      active?.cancel();
      if (next) active = revealSurface(node, "left");
    },
    destroy() {
      active?.cancel();
    },
  };
}

export function revealDockFromRight(_node: HTMLElement) {
  return {
    duration: prefersReducedMotion() ? 0 : 240,
    easing: (t: number) => 1 - (1 - t) ** 3,
    css: (t: number) => `clip-path: inset(0 0 0 ${(1 - t) * 28}%)`,
  };
}
