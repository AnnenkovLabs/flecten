export interface ThreadAnchor {
  id: string;
  offset: number;
}

export interface ThreadRange {
  start: number;
  end: number;
  before: number;
  after: number;
}

export const MAX_THREAD_ROWS = 80;
const INITIAL_ROW_HEIGHT = 160;

/** Renderer ids are recreated on replay; a kind's chronological position survives reopening. */
export function threadRowKeys(items: readonly { kind: string }[]): string[] {
  const counts = new Map<string, number>();
  return items.map((item) => {
    const ordinal = counts.get(item.kind) ?? 0;
    counts.set(item.kind, ordinal + 1);
    return `${item.kind}:${ordinal}`;
  });
}

/** A Fenwick index keeps measured, variable-height rows searchable without mounting them. */
export class ThreadWindow {
  #ids: readonly string[] = [];
  #indices = new Map<string, number>();
  #heights = new Map<string, number>();
  #tree = new Float64Array(1);

  get length(): number {
    return this.#ids.length;
  }
  get total(): number {
    return this.offset(this.length);
  }

  setRows(ids: readonly string[], heights?: ReadonlyMap<string, number>): boolean {
    if (ids.length === this.length && ids.every((id, index) => id === this.#ids[index]) && !heights)
      return false;
    this.#ids = [...ids];
    if (heights) this.#heights = new Map(heights);
    this.#indices = new Map(ids.map((id, index) => [id, index]));
    this.#tree = new Float64Array(ids.length + 1);
    for (let index = 0; index < ids.length; index += 1)
      this.#add(index, this.#heights.get(ids[index] ?? "") ?? INITIAL_ROW_HEIGHT);
    return true;
  }

  measurements(): Map<string, number> {
    return new Map(this.#heights);
  }

  reset(): void {
    this.#heights.clear();
    this.setRows(this.#ids, new Map());
  }

  measure(id: string, height: number): boolean {
    const index = this.#indices.get(id);
    if (index === undefined || !Number.isFinite(height)) return false;
    const next = Math.max(1, height);
    const previous = this.#heights.get(id) ?? INITIAL_ROW_HEIGHT;
    if (Math.abs(next - previous) < 0.5) return false;
    this.#heights.set(id, next);
    this.#add(index, next - previous);
    return true;
  }

  offset(index: number): number {
    let total = 0;
    for (
      let cursor = Math.min(this.length, Math.max(0, index));
      cursor > 0;
      cursor -= cursor & -cursor
    )
      total += this.#tree[cursor] ?? 0;
    return total;
  }

  topOf(id: string): number | undefined {
    const index = this.#indices.get(id);
    return index === undefined ? undefined : this.offset(index);
  }

  indexAt(top: number): number {
    if (this.length === 0) return 0;
    let index = 0;
    let sum = 0;
    let step = 1;
    while (step * 2 <= this.length) step *= 2;
    for (; step > 0; step = Math.floor(step / 2)) {
      const next = index + step;
      const value = this.#tree[next] ?? 0;
      if (next <= this.length && sum + value <= Math.max(0, top)) {
        index = next;
        sum += value;
      }
    }
    return Math.min(index, this.length - 1);
  }

  anchor(top: number): ThreadAnchor | undefined {
    const index = this.indexAt(top);
    const id = this.#ids[index];
    return id === undefined ? undefined : { id, offset: top - this.offset(index) };
  }

  restore(anchor: ThreadAnchor): number | undefined {
    const top = this.topOf(anchor.id);
    return top === undefined ? undefined : Math.max(0, top + anchor.offset);
  }

  range(top: number, height: number): ThreadRange {
    if (this.length <= 40) return { start: 0, end: this.length, before: 0, after: 0 };
    const viewport = Math.max(1, height);
    const first = this.indexAt(top);
    const start = Math.max(this.indexAt(Math.max(0, top - viewport)), first - 20);
    const end = Math.min(
      this.length,
      Math.max(first + 1, this.indexAt(top + viewport * 2) + 1),
      start + MAX_THREAD_ROWS,
    );
    return {
      start,
      end,
      before: this.offset(start),
      after: Math.max(0, this.total - this.offset(end)),
    };
  }

  #add(index: number, delta: number): void {
    for (let cursor = index + 1; cursor < this.#tree.length; cursor += cursor & -cursor)
      this.#tree[cursor] = (this.#tree[cursor] ?? 0) + delta;
  }
}
