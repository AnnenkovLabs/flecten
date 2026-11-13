import { tick } from "svelte";
import { type ThreadAnchor, type ThreadRange, ThreadWindow } from "./thread-window";

interface Measurements {
  width: number;
  heights: Map<string, number>;
}
const measurements = new Map<string, Measurements>();

/** DOM ownership and measurements stay here; Thread owns follow/search/navigation intent. */
export class ThreadViewport {
  readonly window = new ThreadWindow();
  #revision = $state(0);
  #top = $state(0);
  #height = $state(600);
  #task = "";
  #width = 0;
  #scroller: HTMLElement | undefined;
  #content: HTMLElement | undefined;
  #observer: ResizeObserver | undefined;
  #rows = new Map<string, HTMLElement>();
  #frame = 0;
  #change = 0;
  #adjusting = false;
  #follow = (): boolean => false;
  #onResize = (): void => {};

  get range(): ThreadRange {
    void this.#revision;
    return this.window.range(this.#top, this.#height);
  }

  get adjusting(): boolean {
    return this.#adjusting;
  }

  setRows(task: string, ids: readonly string[]): void {
    if (task !== this.#task) {
      this.#save();
      this.#task = task;
      const cached = measurements.get(task);
      this.#width = cached?.width ?? 0;
      this.window.setRows(ids, cached?.heights ?? new Map());
      this.#top = 0;
      this.#revision += 1;
      this.#adjusting = true;
      this.#schedule();
    } else if (this.window.setRows(ids)) {
      this.#revision += 1;
      this.#adjusting = true;
      this.#schedule();
    }
  }

  attach(
    scroller: HTMLElement,
    content: HTMLElement,
    follows: () => boolean,
    onResize: () => void,
  ): () => void {
    this.#scroller = scroller;
    this.#content = content;
    this.#follow = follows;
    this.#onResize = onResize;
    this.#observer = new ResizeObserver(() => this.#schedule());
    this.#observer.observe(scroller);
    this.#observer.observe(content);
    for (const element of this.#rows.values()) this.#observer.observe(element);
    this.scroll();
    this.#schedule();
    return () => {
      this.#save();
      this.#change += 1;
      this.#observer?.disconnect();
      cancelAnimationFrame(this.#frame);
      this.#observer = undefined;
      this.#adjusting = false;
      this.#scroller = undefined;
      this.#content = undefined;
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

  scroll(): void {
    const scroller = this.#scroller;
    if (!scroller || scroller.clientHeight === 0) return;
    this.#height = scroller.clientHeight;
    this.#top = Math.max(0, scroller.scrollTop - this.#inset());
  }

  anchor(): ThreadAnchor | undefined {
    return this.window.anchor(this.#top);
  }

  restore(anchor: ThreadAnchor): number | undefined {
    const top = this.window.restore(anchor);
    return top === undefined ? undefined : top + this.#inset();
  }

  reveal(id: string): void {
    const top = this.window.topOf(id);
    if (top === undefined || !this.#scroller) return;
    this.#scroller.scrollTop = Math.max(0, top + this.#inset() - this.#height / 3);
    this.scroll();
  }

  #inset(): number {
    const content = this.#content;
    const scroller = this.#scroller;
    if (!content || !scroller) return 0;
    return (
      content.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop +
      Number.parseFloat(getComputedStyle(content).paddingTop)
    );
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
    const scrollTop = scroller.scrollTop;
    const anchor = this.anchor();
    const width = content.clientWidth;
    let changed = false;
    if (this.#width && Math.abs(width - this.#width) > 1) {
      this.window.reset();
      changed = true;
    }
    this.#width = width;
    for (const [id, element] of this.#rows)
      changed = this.window.measure(id, element.getBoundingClientRect().height) || changed;
    this.scroll();
    if (!changed) {
      this.#onResize();
      const change = this.#change;
      requestAnimationFrame(() => {
        if (change === this.#change) this.#adjusting = false;
      });
      return;
    }
    this.#adjusting = true;
    this.#revision += 1;
    const change = ++this.#change;
    void tick().then(() => {
      if (change !== this.#change || this.#scroller !== scroller) return;
      if (!this.#follow() && anchor && Math.abs(scroller.scrollTop - scrollTop) < 1)
        scroller.scrollTop = this.restore(anchor) ?? scrollTop;
      this.scroll();
      this.#onResize();
      requestAnimationFrame(() => {
        if (change === this.#change) this.#adjusting = false;
      });
    });
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
