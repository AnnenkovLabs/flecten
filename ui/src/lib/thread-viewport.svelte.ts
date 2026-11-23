import { tick } from "svelte";
import { type ThreadAnchor, type ThreadRange, ThreadWindow } from "./thread-window";

interface Measurements {
  width: number;
  heights: Map<string, number>;
}
const measurements = new Map<string, Measurements>();

function sameRange(a: ThreadRange, b: ThreadRange): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    Math.abs(a.before - b.before) < 0.5 &&
    Math.abs(a.after - b.after) < 0.5
  );
}

/** DOM ownership and measurements stay here; Thread owns follow/search/navigation intent. */
export class ThreadViewport {
  readonly window = new ThreadWindow();
  #range = $state<ThreadRange>({ start: 0, end: 0, before: 0, after: 0 });
  #top = 0;
  #height = 600;
  #insetValue = 0;
  #task = "";
  #width = 0;
  #scroller: HTMLElement | undefined;
  #content: HTMLElement | undefined;
  #header: HTMLElement | undefined;
  #observer: ResizeObserver | undefined;
  #rows = new Map<string, HTMLElement>();
  #frame = 0;
  #change = 0;
  #follow = (): boolean => false;
  #onResize = (): void => {};
  #onAdjust = (_scrollTop: number): void => {};

  get range(): ThreadRange {
    return this.#range;
  }

  setRows(task: string, ids: readonly string[]): void {
    if (task !== this.#task) {
      this.#save();
      this.#task = task;
      const cached = measurements.get(task);
      this.#width = cached?.width ?? 0;
      this.window.setRows(ids, cached?.heights ?? new Map());
      this.#top = 0;
      this.#updateRange();
      this.#schedule();
    } else if (this.window.setRows(ids)) {
      this.#updateRange();
      this.#schedule();
    }
  }

  attach(
    scroller: HTMLElement,
    content: HTMLElement,
    follows: () => boolean,
    onResize: () => void,
    onAdjust: (scrollTop: number) => void,
    header?: HTMLElement,
  ): () => void {
    this.#scroller = scroller;
    this.#content = content;
    this.#header = header;
    this.#follow = follows;
    this.#onResize = onResize;
    this.#onAdjust = onAdjust;
    this.#observer = new ResizeObserver(() => this.#schedule());
    this.#observer.observe(scroller);
    this.#observer.observe(content);
    if (header) this.#observer.observe(header);
    for (const element of this.#rows.values()) this.#observer.observe(element);
    this.refreshInset();
    this.scroll();
    this.#schedule();
    return () => {
      this.#save();
      this.#change += 1;
      this.#observer?.disconnect();
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      this.#observer = undefined;
      this.#scroller = undefined;
      this.#content = undefined;
      this.#header = undefined;
    };
  }

  row = (element: HTMLElement, id: string): { destroy(): void } => {
    this.#rows.set(id, element);
    this.#observer?.observe(element);
    this.#schedule();
    return {
      destroy: () => {
        this.#observer?.unobserve(element);
        if (this.#rows.get(id) === element) this.#rows.delete(id);
      },
    };
  };

  refreshInset(): void {
    const content = this.#content;
    const scroller = this.#scroller;
    if (!content || !scroller) {
      this.#insetValue = 0;
      return;
    }
    this.#insetValue =
      content.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop +
      Number.parseFloat(getComputedStyle(content).paddingTop) +
      (this.#header?.getBoundingClientRect().height ?? 0);
  }

  scroll(): void {
    const scroller = this.#scroller;
    if (!scroller || scroller.clientHeight === 0) return;
    this.#height = scroller.clientHeight;
    this.#top = Math.max(0, scroller.scrollTop - this.#insetValue);
    this.#updateRange();
  }

  /** Measure mounted rows right after a window slice renders so scroll compensation runs before paint. */
  syncAfterRender(): void {
    if (!this.#scroller || !this.#content || this.#scroller.clientHeight === 0) return;
    if (this.#frame) {
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
    }
    this.#measure();
  }

  anchor(): ThreadAnchor | undefined {
    const scroller = this.#scroller;
    if (scroller?.isConnected) {
      const top = scroller.getBoundingClientRect().top;
      let visible: { id: string; top: number } | undefined;
      for (const [id, element] of this.#rows) {
        if (!element.isConnected) continue;
        const bounds = element.getBoundingClientRect();
        if (bounds.bottom > top && (!visible || bounds.top < visible.top))
          visible = { id, top: bounds.top };
      }
      // Pending measurements can put the logical index ahead of the rendered rows.
      if (visible) return { id: visible.id, offset: top - visible.top };
    }
    return this.window.anchor(this.#top);
  }

  restore(anchor: ThreadAnchor): number | undefined {
    const top = this.window.restore(anchor);
    return top === undefined ? undefined : top + this.#insetValue;
  }

  reveal(id: string): void {
    const top = this.window.topOf(id);
    if (top === undefined || !this.#scroller) return;
    const nextTop = Math.max(0, top + this.#insetValue - this.#height / 3);
    this.#scroller.scrollTop = nextTop;
    this.#onAdjust(nextTop);
    this.scroll();
  }

  #updateRange(): void {
    const next = this.window.range(this.#top, this.#height);
    if (!sameRange(this.#range, next)) this.#range = next;
  }

  #schedule(): void {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#measure();
    });
  }

  #measure(): void {
    const scroller = this.#scroller;
    const content = this.#content;
    if (!scroller || !content || scroller.clientHeight === 0) return;
    this.refreshInset();
    this.#height = scroller.clientHeight;
    this.#top = Math.max(0, scroller.scrollTop - this.#insetValue);
    const width = content.clientWidth;
    const widthChanged = this.#width > 0 && Math.abs(width - this.#width) > 1;
    this.#width = width;

    if (widthChanged) {
      const scrollTop = scroller.scrollTop;
      const anchor = this.anchor();
      this.window.reset();
      for (const [id, element] of this.#rows) {
        this.window.measure(id, element.getBoundingClientRect().height);
      }
      this.#updateRange();
      const change = ++this.#change;
      void tick().then(() => {
        if (change !== this.#change || this.#scroller !== scroller) return;
        if (!this.#follow() && anchor && Math.abs(scroller.scrollTop - scrollTop) < 1) {
          const restored = this.restore(anchor);
          if (restored !== undefined) {
            scroller.scrollTop = restored;
            this.#onAdjust(restored);
          }
        }
        this.scroll();
        this.#onResize();
      });
      return;
    }

    const first = this.window.indexAt(this.#top);
    let deltaAbove = 0;
    for (const [id, element] of this.#rows) {
      if (!element.isConnected) continue;
      const index = this.window.indexOf(id);
      const previous = this.window.heightOf(id);
      if (this.window.measure(id, element.getBoundingClientRect().height)) {
        if (index !== undefined && index < first) {
          deltaAbove += this.window.heightOf(id) - previous;
        }
      }
    }

    if (!this.#follow() && Math.abs(deltaAbove) >= 0.5) {
      const nextTop = Math.max(0, scroller.scrollTop + deltaAbove);
      scroller.scrollTop = nextTop;
      this.#onAdjust(nextTop);
      this.#top = Math.max(0, nextTop - this.#insetValue);
    }

    this.#updateRange();
    this.#onResize();
  }

  #save(): void {
    if (!this.#task) return;
    measurements.delete(this.#task);
    measurements.set(this.#task, { width: this.#width, heights: this.window.measurements() });
    if (measurements.size > 20) {
      const oldest = measurements.keys().next().value;
      if (oldest !== undefined) measurements.delete(oldest);
    }
  }
}
