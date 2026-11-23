import { describe, expect, it } from "bun:test";
import {
  MAX_PROMPT_HISTORY,
  mergePromptHistory,
  PromptHistoryNavigator,
  readPromptHistory,
  recordPromptHistory,
  userPrompts,
} from "../../ui/src/lib/composer/prompt-history";
import { rollMotionState } from "../../ui/src/lib/composer/prompt-roll";
import type { ThreadItem } from "../../ui/src/lib/types";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe("prompt history storage and merging", () => {
  it("records unique prompts, preserves mentions, rejects blank/corrupt entries and enforces cap", () => {
    const storage = memoryStorage();
    const mention = { start: 4, end: 13, path: "src/a.ts", kind: "file" as const };
    recordPromptHistory("/repo", { text: "   ", mentions: [] }, storage);
    expect(readPromptHistory("/repo", storage)).toEqual([]);

    recordPromptHistory("/repo", { text: "See @src/a.ts", mentions: [mention] }, storage);
    recordPromptHistory("/repo", { text: "Run tests", mentions: [] }, storage);
    recordPromptHistory("/repo", { text: "See @src/a.ts", mentions: [mention] }, storage);
    expect(readPromptHistory("/repo", storage)).toEqual([
      { text: "Run tests", mentions: [] },
      { text: "See @src/a.ts", mentions: [mention] },
    ]);

    for (let i = 0; i < MAX_PROMPT_HISTORY + 15; i += 1) {
      recordPromptHistory("/repo", { text: `prompt-${i}`, mentions: [] }, storage);
    }
    const capped = readPromptHistory("/repo", storage);
    expect(capped).toHaveLength(MAX_PROMPT_HISTORY);
    expect(capped.at(-1)?.text).toBe(`prompt-${MAX_PROMPT_HISTORY + 14}`);

    storage.setItem("flecten.composer-history.v1:/corrupt", "{bad-json");
    expect(readPromptHistory("/corrupt", storage)).toEqual([]);
    storage.setItem(
      "flecten.composer-history.v1:/invalid-mention",
      JSON.stringify([{ text: "hi", mentions: [{ start: 0, end: 99, path: "x", kind: "file" }] }]),
    );
    expect(readPromptHistory("/invalid-mention", storage)).toEqual([]);
  });

  it("extracts user messages from a thread and merges them ahead of older workspace history", () => {
    const items: ThreadItem[] = [
      { kind: "message", id: "m1", text: "First prompt" },
      { kind: "message", id: "m2", text: "Twin guidance", actor: "twin" },
      { kind: "answer", id: "a1", text: "Done" },
      { kind: "message", id: "m3", text: "Check @src/app.ts" },
    ];
    expect(userPrompts(items)).toEqual(["First prompt", "Check @src/app.ts"]);

    const mention = { start: 6, end: 17, path: "src/app.ts", kind: "file" as const };
    const merged = mergePromptHistory(
      [
        { text: "Older chat prompt", mentions: [] },
        { text: "Check @src/app.ts", mentions: [mention] },
      ],
      userPrompts(items),
    );
    expect(merged).toEqual([
      { text: "Older chat prompt", mentions: [] },
      { text: "First prompt", mentions: [] },
      { text: "Check @src/app.ts", mentions: [mention] },
    ]);
  });
});

describe("PromptHistoryNavigator", () => {
  const first = { text: "oldest\nline 2", mentions: [] };
  const second = { text: "middle", mentions: [] };
  const third = { text: "latest\nline 2", mentions: [] };
  const entries = [first, second, third];

  it("stashes the unsent draft, cycles up/down, and restores the draft on exit", () => {
    const nav = new PromptHistoryNavigator();
    const draft = { text: "unsent draft", mentions: [] };

    expect(nav.canStep("down", entries, true)).toBe(false);
    expect(nav.canStep("up", entries, false)).toBe(false);
    expect(nav.canStep("up", entries, true)).toBe(true);

    const s1 = nav.step("up", entries, draft);
    expect(s1).toEqual({ snapshot: third, direction: "up" });
    expect(nav.active).toBe(true);
    expect(nav.pinned).toBe(true);

    // Pinned mode allows stepping again immediately even on multiline prompts.
    expect(nav.canStep("up", entries, false)).toBe(true);
    const s2 = nav.step("up", entries, third);
    expect(s2).toEqual({ snapshot: second, direction: "up" });

    const s3 = nav.step("up", entries, second);
    expect(s3).toEqual({ snapshot: first, direction: "up" });
    expect(nav.canStep("up", entries, true)).toBe(false);
    expect(nav.step("up", entries, first)).toBeNull();

    const d1 = nav.step("down", entries, first);
    expect(d1).toEqual({ snapshot: second, direction: "down" });
    const d2 = nav.step("down", entries, second);
    expect(d2).toEqual({ snapshot: third, direction: "down" });
    const restored = nav.step("down", entries, third);
    expect(restored).toEqual({ snapshot: draft, direction: "down" });
    expect(nav.active).toBe(false);
    expect(nav.pinned).toBe(false);
  });

  it("respects unpinning when the user moves the caret inside a recalled prompt", () => {
    const nav = new PromptHistoryNavigator();
    nav.step("up", entries, { text: "", mentions: [] });
    nav.unpin();
    expect(nav.active).toBe(true);
    expect(nav.pinned).toBe(false);
    expect(nav.canStep("up", entries, false)).toBe(false);
    expect(nav.canStep("up", entries, true)).toBe(true);
    expect(nav.canStep("down", entries, false)).toBe(false);
    expect(nav.canStep("down", entries, true)).toBe(true);
  });
});

describe("rollMotionState", () => {
  it("moves along opposite 3D vertical directions for up vs down and settles crisp at progress=1", () => {
    const upInStart = rollMotionState(0, "up", "in");
    const downInStart = rollMotionState(0, "down", "in");
    expect(upInStart.y).toBeLessThan(0);
    expect(downInStart.y).toBeGreaterThan(0);
    expect(upInStart.rotateX).toBeGreaterThan(0);
    expect(downInStart.rotateX).toBeLessThan(0);
    expect(upInStart.z).toBeLessThan(0);
    expect(upInStart.blurY).toBeGreaterThanOrEqual(15);

    const upOutEnd = rollMotionState(1, "up", "out");
    const downOutEnd = rollMotionState(1, "down", "out");
    expect(upOutEnd.y).toBeGreaterThan(0);
    expect(downOutEnd.y).toBeLessThan(0);
    expect(upOutEnd.opacity).toBe(0);
    expect(upOutEnd.blurY).toBeGreaterThanOrEqual(18);

    const settled = rollMotionState(1, "up", "in");
    expect(settled.y).toBeCloseTo(0, 6);
    expect(settled.z).toBeCloseTo(0, 6);
    expect(settled.rotateX).toBeCloseTo(0, 6);
    expect(settled.scaleX).toBeCloseTo(1, 6);
    expect(settled.scaleY).toBeCloseTo(1, 6);
    expect(settled.opacity).toBe(1);
    expect(settled.blurY).toBeCloseTo(0, 6);

    const boosted = rollMotionState(0.2, "up", "in", 1.2);
    const normal = rollMotionState(0.2, "up", "in", 1);
    expect(boosted.blurY).toBeGreaterThan(normal.blurY);
  });
});
