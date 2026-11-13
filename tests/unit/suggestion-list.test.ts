import { expect, test } from "bun:test";
import { suggestionList } from "../../ui/src/lib/composer/suggestion-list";

test("command and context suggestions share keyboard navigation, composition and cleanup", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = new EventTarget();
  Object.defineProperty(globalThis, "window", { value: target, configurable: true });
  const moved: number[] = [];
  const selected: number[] = [];
  const scrolled: number[] = [];
  let closed = 0;
  const node = {
    querySelectorAll: () =>
      Array.from({ length: 3 }, (_, index) => ({
        scrollIntoView: () => scrolled.push(index),
      })),
  } as unknown as Parameters<typeof suggestionList>[0];
  const options = {
    count: 3,
    active: 0,
    onMove: (index: number) => moved.push(index),
    onSelect: (index: number) => selected.push(index),
    onClose: () => {
      closed += 1;
    },
  };
  const action = suggestionList(node, options);
  function press(key: string, extra = {}) {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(
      event,
      { key, isComposing: false, altKey: false, ctrlKey: false, metaKey: false },
      extra,
    );
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }
  try {
    expect(press("ArrowDown")).toBe(true);
    expect(moved).toEqual([1]);
    action.update({ ...options, active: 2 });
    press("ArrowDown");
    press("ArrowUp");
    expect(moved).toEqual([1, 2, 1]);
    expect(press("Enter")).toBe(true);
    expect(selected).toEqual([2]);
    expect(press("Enter", { isComposing: true })).toBe(false);
    expect(press("ArrowDown", { ctrlKey: true })).toBe(false);
    expect(press("x")).toBe(false);
    action.update({ ...options, count: 0 });
    expect(press("Enter")).toBe(false);
    press("ArrowDown");
    expect(moved).toHaveLength(3);
    press("Escape");
    expect(closed).toBe(1);
    await Promise.resolve();
    expect(scrolled).toEqual([1, 2, 1]);
    action.destroy();
    expect(press("Escape")).toBe(false);
    expect(closed).toBe(1);
  } finally {
    action.destroy();
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
