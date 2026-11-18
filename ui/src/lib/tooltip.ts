/** One top-layer tooltip serves explicitly annotated application controls. */
export function tooltipLayer(layer: HTMLElement): { destroy: () => void } {
  let anchor: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  let focused: HTMLElement | null = null;
  let opening: ReturnType<typeof setTimeout> | undefined;
  let closing: ReturnType<typeof setTimeout> | undefined;

  function target(node: EventTarget | null): HTMLElement | null {
    return node instanceof Element ? node.closest<HTMLElement>("[data-tooltip]") : null;
  }

  function clearTimers(): void {
    clearTimeout(opening);
    clearTimeout(closing);
    opening = undefined;
    closing = undefined;
  }

  function describe(element: HTMLElement, add: boolean): void {
    const ids = (element.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    const next = ids.filter((id) => id !== layer.id);
    const text = element.dataset.tooltip ?? "";
    if (
      add &&
      text !== element.getAttribute("aria-label") &&
      text !== element.textContent?.trim()
    ) {
      next.push(layer.id);
    }
    if (next.length) element.setAttribute("aria-describedby", next.join(" "));
    else element.removeAttribute("aria-describedby");
  }

  function hide(): void {
    clearTimers();
    if (anchor) describe(anchor, false);
    anchor = null;
    observer.disconnect();
    resize.disconnect();
    if (layer.matches(":popover-open")) layer.hidePopover();
  }

  function position(): void {
    if (!anchor?.isConnected || !anchor.dataset.tooltip?.trim()) {
      hide();
      return;
    }
    const bounds = anchor.getBoundingClientRect();
    if (!bounds.width || !bounds.height) {
      hide();
      return;
    }
    const width = layer.offsetWidth;
    const height = layer.offsetHeight;
    const gap = 7;
    const inset = 8;
    const below = bounds.bottom + gap;
    const above = bounds.top - gap - height;
    const top = below + height <= window.innerHeight - inset || above < inset ? below : above;
    layer.style.left = `${Math.max(inset, Math.min(bounds.left + (bounds.width - width) / 2, window.innerWidth - width - inset))}px`;
    layer.style.top = `${Math.max(inset, Math.min(top, window.innerHeight - height - inset))}px`;
  }

  const resize = new ResizeObserver(position);
  const observer = new MutationObserver(() => {
    if (!anchor) return;
    layer.textContent = anchor.dataset.tooltip ?? "";
    describe(anchor, true);
    position();
  });

  function show(element: HTMLElement): void {
    hide();
    if (!element.isConnected || !element.dataset.tooltip?.trim()) return;
    anchor = element;
    layer.textContent = element.dataset.tooltip ?? "";
    // A tooltip opened from a modal must remain inside that dialog's inert boundary.
    (element.closest("dialog[open]") ?? document.body).append(layer);
    layer.showPopover();
    describe(element, true);
    position();
    observer.observe(element, { attributes: true, attributeFilter: ["data-tooltip"] });
    resize.observe(element);
    resize.observe(layer);
  }

  function request(element: HTMLElement | null, delay: number): void {
    clearTimers();
    if (!element?.dataset.tooltip?.trim()) {
      hide();
      return;
    }
    if (anchor === element) return;
    if (anchor) hide();
    // Focus can be restored synchronously while Chromium is opening another popover.
    opening = setTimeout(() => show(element), delay);
  }

  function deferHide(): void {
    clearTimeout(opening);
    clearTimeout(closing);
    closing = setTimeout(() => {
      if (focused) request(focused, 0);
      else if (hovered) request(hovered, 500);
      else hide();
    }, 150);
  }

  function pointerOver(event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    if (event.target instanceof Node && layer.contains(event.target)) {
      clearTimeout(closing);
      return;
    }
    const element = target(event.target);
    if (element === hovered) return;
    hovered = element;
    if (element) request(element, 500);
  }

  function pointerOut(event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    const next = event.relatedTarget;
    if (next instanceof Node && (anchor?.contains(next) || layer.contains(next))) return;
    if (target(next) === hovered && hovered) return;
    hovered = null;
    deferHide();
  }

  function focusIn(event: FocusEvent): void {
    if (document.documentElement.dataset.focusNavigation === "pointer") return;
    if (!(event.target instanceof Element) || !event.target.matches(":focus-visible")) return;
    focused = target(event.target);
    if (focused) request(focused, 0);
  }

  function focusOut(): void {
    focused = null;
    if (hovered !== anchor) deferHide();
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !anchor) return;
    const ownsFocus =
      event.target instanceof Node &&
      (anchor.contains(event.target) || layer.contains(event.target));
    hide();
    if (ownsFocus) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function scroll(event: Event): void {
    if (!(event.target instanceof Node) || !layer.contains(event.target)) hide();
  }

  function pointerDown(event: PointerEvent): void {
    if (!(event.target instanceof Node) || !layer.contains(event.target)) hide();
  }

  document.addEventListener("pointerover", pointerOver);
  document.addEventListener("pointerout", pointerOut);
  document.addEventListener("pointerdown", pointerDown, true);
  document.addEventListener("focusin", focusIn);
  document.addEventListener("focusout", focusOut);
  document.addEventListener("keydown", keydown, true);
  document.addEventListener("scroll", scroll, true);
  window.addEventListener("resize", hide);
  window.addEventListener("blur", hide);

  return {
    destroy: () => {
      hide();
      document.removeEventListener("pointerover", pointerOver);
      document.removeEventListener("pointerout", pointerOut);
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
    },
  };
}
