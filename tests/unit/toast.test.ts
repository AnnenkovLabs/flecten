import { describe, expect, test } from "bun:test";
import {
  infoDuration,
  pushToast,
  type ToastItem,
  toastDuration,
} from "../../ui/src/lib/toast-stack";

const info = (id: number, text = `info ${id}`): ToastItem => ({ id, text, tone: "info" });
const error = (id: number, text = `error ${id}`): ToastItem => ({ id, text, tone: "error" });

describe("toast stack", () => {
  test("temporary errors have six seconds to read before dismissal", () => {
    expect(toastDuration(error(1, "Провайдер вернул HTTP 404."))).toBe(6_000);
    expect(toastDuration(info(1, "Скопировано"))).toBe(infoDuration("Скопировано"));
  });
  test("an info notice stays longer for a longer text, within a cap", () => {
    expect(infoDuration("Скопировано")).toBeGreaterThanOrEqual(2_400);
    expect(infoDuration("Скопировано")).toBeLessThan(infoDuration("x".repeat(60)));
    expect(infoDuration("x".repeat(1_000))).toBe(6_000);
  });

  test("new notices go to the end, next to the composer", () => {
    const { items, shown, dropped } = pushToast([info(1)], error(2));
    expect(items.map((item) => item.id)).toEqual([1, 2]);
    expect(shown.id).toBe(2);
    expect(dropped).toEqual([]);
  });

  test("the same text again moves the notice instead of stacking a copy", () => {
    const { items, shown } = pushToast([info(1, "Скопировано"), error(2)], info(3, "Скопировано"));
    expect(items.map((item) => item.id)).toEqual([2, 1]);
    expect(shown.id).toBe(1);
  });

  test("past the limit the oldest info gives way before any error", () => {
    const { items, dropped } = pushToast([error(1), info(2), error(3)], info(4));
    expect(items.map((item) => item.id)).toEqual([1, 3, 4]);
    expect(dropped).toEqual([2]);
  });

  test("when every notice is an error, the oldest error gives way", () => {
    const { items, dropped } = pushToast([error(1), error(2), error(3)], error(4));
    expect(items.map((item) => item.id)).toEqual([2, 3, 4]);
    expect(dropped).toEqual([1]);
  });
});
