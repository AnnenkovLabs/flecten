import { mount, unmount } from "svelte";
import type { ModuleSurface } from "../../../../shared/modules";
import ModuleSurfaceView from "../../components/ModuleSurface.svelte";
import type { ModuleHarness } from "./harness";

interface Portal {
  key: string;
  anchor: HTMLElement;
  container: HTMLElement;
  view: ReturnType<typeof mount>;
  restore(): void;
}

/** Explicit CSS selectors are extension addresses. Native components stay mounted for recovery. */
export class ModulePortals {
  readonly #mounted = new Map<string, Portal>();
  readonly #observer: MutationObserver;
  #surfaces: readonly ModuleSurface[] = [];
  #scheduled = false;
  #closed = false;
  readonly #rule = document.createElement("style");

  constructor(
    readonly root: HTMLElement,
    readonly harness: ModuleHarness,
    readonly report: (message: string) => void,
  ) {
    this.#rule.textContent =
      "[data-module-replaced]{display:none!important}[data-module-portal]{display:flex;flex-direction:column;min-width:0;min-height:0;flex:1}[data-module-portal]>section{flex:1}";
    document.head.append(this.#rule);
    this.#observer = new MutationObserver(() => {
      if (this.#scheduled || this.#closed) return;
      this.#scheduled = true;
      queueMicrotask(() => {
        this.#scheduled = false;
        if (!this.#closed) this.#reconcile();
      });
    });
    this.#observer.observe(root, { childList: true, subtree: true, attributes: true });
  }

  update(surfaces: readonly ModuleSurface[]): void {
    this.#surfaces = surfaces
      .filter((s) => s.placement)
      .toSorted(
        (a, b) =>
          (b.placement?.order ?? 0) - (a.placement?.order ?? 0) ||
          a.module.localeCompare(b.module) ||
          a.id.localeCompare(b.id),
      );
    this.#reconcile();
  }
  #reconcile(): void {
    const desired = new Set(this.#surfaces.map((s) => `${s.module}:${s.id}:${s.revision}`));
    for (const [key, portal] of this.#mounted) {
      if (!desired.has(key) || !portal.anchor.isConnected || !portal.container.isConnected)
        this.#remove(key);
    }
    const occupied = new Set<HTMLElement>();
    for (const surface of this.#surfaces) {
      const placement = surface.placement;
      if (!placement) continue;
      const key = `${surface.module}:${surface.id}:${surface.revision}`;
      let anchor: HTMLElement | undefined;
      try {
        anchor = [...this.root.querySelectorAll<HTMLElement>(placement.selector)].find(
          (node) => !node.closest("[data-module-portal]"),
        );
      } catch (error) {
        this.report(`${surface.module}/${surface.id}: ${String(error)}`);
        continue;
      }
      if (!anchor || (placement.position === "replace" && occupied.has(anchor))) {
        this.#remove(key);
        continue;
      }
      if (placement.position === "replace") occupied.add(anchor);
      const existing = this.#mounted.get(key);
      if (existing?.anchor === anchor) continue;
      this.#remove(key);
      if (anchor.parentElement?.closest("[data-module-replaced]")) continue;
      const container = document.createElement("div");
      container.dataset.modulePortal = `${surface.module}:${surface.id}`;
      container.style.height =
        placement.position === "replace" ? `${anchor.getBoundingClientRect().height}px` : "auto";
      if (anchor.dataset.harnessRegion === "shell") container.style.height = "100dvh";
      let restore = () => {};
      if (placement.position === "replace") {
        // ponytail: retain native views for recovery; mount them lazily once view stores are independent.
        const inert = anchor.inert;
        anchor.dataset.moduleReplaced = key;
        anchor.inert = true;
        restore = () => {
          if (anchor.dataset.moduleReplaced === key) {
            delete anchor.dataset.moduleReplaced;
            anchor.inert = inert;
          }
        };
        anchor.after(container);
      } else if (placement.position === "before") anchor.before(container);
      else if (placement.position === "after") anchor.after(container);
      else if (placement.position === "prepend") anchor.prepend(container);
      else anchor.append(container);
      const view = mount(ModuleSurfaceView, {
        target: container,
        props: {
          surface,
          harness: this.harness,
          get sessionId() {
            return "";
          },
        },
      });
      this.#mounted.set(key, { key, anchor, container, view, restore });
    }
  }
  #remove(key: string): void {
    const portal = this.#mounted.get(key);
    if (!portal) return;
    this.#mounted.delete(key);
    portal.restore();
    void unmount(portal.view);
    portal.container.remove();
  }
  close(): void {
    this.#closed = true;
    this.#observer.disconnect();
    for (const key of this.#mounted.keys()) this.#remove(key);
    this.#rule.remove();
  }
}
