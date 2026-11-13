import { describe, expect, test } from "bun:test";
import { builtinTools } from "../../src/tools/builtin";
import { repairToolInput } from "../../src/tools/repair";

const tools = builtinTools();
const tool = (name: string) => {
  const found = tools.find((entry) => entry.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
};

describe("tool input repair", () => {
  test("renames aliased fields", () => {
    const result = repairToolInput(tool("read"), { file_path: "src/a.ts" });
    expect(result.correction).toBeUndefined();
    expect(result.input).toMatchObject({ path: "src/a.ts" });
    expect(result.notes.join(" ")).toContain("Renamed");
  });

  test("drops null optional fields", () => {
    const result = repairToolInput(tool("read"), { path: "a.ts", offset: null, limit: null });
    expect(result.correction).toBeUndefined();
    expect(result.input).toMatchObject({ path: "a.ts" });
    expect(result.notes.join(" ")).toContain("null");
  });

  test("parses a JSON-stringified array", () => {
    const result = repairToolInput(tool("done"), {
      summary: "done",
      evidence: '["bun test", "bun run check"]',
    });
    expect(result.correction).toBeUndefined();
    expect(result.input).toMatchObject({
      summary: "done",
      evidence: ["bun test", "bun run check"],
    });
  });

  test("wraps a bare string in an array", () => {
    const result = repairToolInput(tool("done"), { summary: "done", evidence: "bun test" });
    expect(result.correction).toBeUndefined();
    expect(result.input).toMatchObject({ evidence: ["bun test"] });
  });

  test("wraps a bare root string as the primary field", () => {
    const result = repairToolInput(tool("read"), "src/a.ts");
    expect(result.correction).toBeUndefined();
    expect(result.input).toMatchObject({ path: "src/a.ts" });
  });

  test("repairs truncated JSON args", () => {
    const result = repairToolInput(tool("read"), '{"path": "a.ts"');
    expect(result.correction).toBeUndefined();
    expect(result.input).toMatchObject({ path: "a.ts" });
  });

  test("unwraps double-stringified args", () => {
    const result = repairToolInput(tool("read"), JSON.stringify(JSON.stringify({ path: "a.ts" })));
    expect(result.correction).toBeUndefined();
    expect(result.input).toMatchObject({ path: "a.ts" });
  });

  test("strips chat markdown from paths", () => {
    const result = repairToolInput(tool("read"), { path: "[notes.md](http://notes.md)" });
    expect(result.correction).toBeUndefined();
    expect(result.input).toMatchObject({ path: "notes.md" });
  });

  test("does not rewrite string content that looks like JSON", () => {
    const content = '["a", "b"]';
    const result = repairToolInput(tool("write"), { path: "a.json", content });
    expect(result.correction).toBeUndefined();
    expect(result.input).toMatchObject({ content });
  });

  test("timeout aliases preserve milliseconds without guessing from their magnitude", () => {
    for (const timeout of [30, 600, 601, 30_000]) {
      const result = repairToolInput(tool("bash"), { command: "ls", timeout });
      expect(result.correction).toBeUndefined();
      expect(result.input).toMatchObject({ timeoutMs: timeout });
    }
  });

  test("returns a readable correction instead of a raw validator blob", () => {
    const result = repairToolInput(tool("edit"), { path: "a.ts", oldString: "old" });
    expect(result.correction).toContain('Invalid arguments for tool "edit"');
    expect(result.correction).toContain("newString");
    expect(result.correction).toContain("Received fields");
    expect(result.correction).not.toContain("ZodError");
  });
});
