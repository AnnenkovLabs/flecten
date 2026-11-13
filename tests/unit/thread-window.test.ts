import { describe, expect, test } from "bun:test";
import { MAX_THREAD_ROWS, ThreadWindow, threadRowKeys } from "../../ui/src/lib/thread-window";

function rows(count = 10_000): string[] {
  return Array.from({ length: count }, (_, index) => `message-${index}`);
}

describe("thread window", () => {
  test("row identity survives a replay assigning new renderer ids and a run inserted before an answer", () => {
    expect(threadRowKeys([{ kind: "message" }, { kind: "answer" }])).toEqual([
      "message:0",
      "answer:0",
    ]);
    expect(threadRowKeys([{ kind: "message" }, { kind: "run" }, { kind: "answer" }])).toEqual([
      "message:0",
      "run:0",
      "answer:0",
    ]);
  });
  test("bounds the mounted slice of a ten thousand row thread at every scroll position", () => {
    const window = new ThreadWindow();
    window.setRows(rows());
    for (const top of [0, 1000, 100_000, 1_000_000, window.total - 640]) {
      const range = window.range(top, 640);
      expect(range.end - range.start).toBeLessThanOrEqual(MAX_THREAD_ROWS);
      expect(range.start).toBeLessThanOrEqual(window.indexAt(top));
      expect(range.end).toBeGreaterThan(window.indexAt(top));
      expect(
        range.before + window.offset(range.end) - window.offset(range.start) + range.after,
      ).toBe(window.total);
    }
  });

  test("uses measured variable heights and preserves the visible item when an earlier row changes", () => {
    const window = new ThreadWindow();
    window.setRows(rows(100));
    window.measure("message-0", 42);
    window.measure("message-1", 1400);
    expect(window.indexAt(42)).toBe(1);
    expect(window.indexAt(1441)).toBe(1);
    expect(window.indexAt(1442)).toBe(2);
    const anchor = window.anchor(window.offset(60) + 37);
    if (!anchor) throw new Error("anchor missing");
    const original = window.restore(anchor) ?? 0;
    window.measure("message-10", 960);
    expect(window.restore(anchor)).toBe(original + 800);
    expect(window.anchor(window.restore(anchor) ?? 0)).toEqual(anchor);
  });

  test("search can reveal an unmounted match without rendering intervening messages", () => {
    const window = new ThreadWindow();
    window.setRows(rows());
    const top = window.topOf("message-6500");
    expect(top).toBe(6500 * 160);
    const range = window.range(top ?? 0, 940);
    expect(range.start).toBeLessThanOrEqual(6500);
    expect(range.end).toBeGreaterThan(6500);
    expect(range.end - range.start).toBeLessThanOrEqual(MAX_THREAD_ROWS);
    expect(window.topOf("missing")).toBeUndefined();
  });

  test("restores cached measurements and survives appending, removing and resizing rows", () => {
    const window = new ThreadWindow();
    const ids = rows(100);
    window.setRows(ids);
    window.measure("message-40", 420);
    const anchor = window.anchor(window.offset(40) + 12);
    if (!anchor) throw new Error("anchor missing");
    const reopened = new ThreadWindow();
    reopened.setRows([...ids, "new"], window.measurements());
    expect(reopened.restore(anchor)).toBe(window.restore(anchor));
    const count = reopened.length;
    reopened.setRows([...ids, "new"]);
    expect(reopened.length).toBe(count);
    reopened.reset();
    expect(reopened.restore(anchor)).toBe(40 * 160 + 12);
    reopened.setRows(ids.filter((id) => id !== anchor.id));
    expect(reopened.restore(anchor)).toBeUndefined();
  });

  test("caps DOM even when rows are empty and keeps short threads fully mounted", () => {
    const window = new ThreadWindow();
    const ids = rows(1000);
    window.setRows(ids);
    for (const id of ids) window.measure(id, 0);
    const range = window.range(500, 940);
    expect(range.end - range.start).toBeLessThanOrEqual(MAX_THREAD_ROWS);
    expect(range.start).toBeLessThanOrEqual(500);
    expect(range.end).toBeGreaterThan(500);
    window.setRows(rows(30));
    expect(window.range(2000, 640)).toEqual({ start: 0, end: 30, before: 0, after: 0 });
  });
});
