import { describe, expect, test } from "bun:test";
import { diffText } from "../../src/tools/util/diff";

describe("line diff", () => {
  test("reports no changes for equal text", () => {
    expect(diffText("a\nb\n", "a\nb\n")).toEqual({ add: 0, del: 0, hunks: [] });
  });

  test("counts additions and removals", () => {
    const result = diffText("a\nb\nc\n", "a\nB\nc\nd\n");
    expect(result.add).toBe(2);
    expect(result.del).toBe(1);
    expect(result.hunks.length).toBeGreaterThan(0);
    const kinds = result.hunks.flatMap((hunk) => hunk.lines.map((line) => line.kind));
    expect(kinds).toContain("add");
    expect(kinds).toContain("del");
    expect(kinds).toContain("ctx");
  });

  test("tracks line numbers", () => {
    const result = diffText("one\ntwo\n", "one\nthree\n");
    const changed = result.hunks[0]?.lines.filter((line) => line.kind !== "ctx") ?? [];
    expect(changed.map((line) => line.oldLine)).toContain(2);
    expect(changed.map((line) => line.newLine)).toContain(2);
  });

  test("handles new files", () => {
    const result = diffText("", "a\nb\n");
    expect(result.add).toBe(2);
    expect(result.del).toBe(0);
  });
});
