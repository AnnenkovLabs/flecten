import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtinTools } from "../../src/tools/builtin";
import { runEdit } from "../../src/tools/edit/run";
import { runRead } from "../../src/tools/read/run";
import { ToolRegistry } from "../../src/tools/registry";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const dirs: string[] = [];
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-tools-files-"));
  dirs.push(dir);
  return dir;
}

function context(cwd: string, reads = new ReadTracker()): ToolContext {
  return {
    sessionId: "s_test",
    cwd,
    signal: new AbortController().signal,
    logDir: join(cwd, ".liquid/logs"),
    limits,
    reads,
  };
}

function makeFifo(path: string): boolean {
  if (process.platform === "win32") return false;
  const result = Bun.spawnSync({ cmd: ["mkfifo", path] });
  return result.exitCode === 0;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("read files", () => {
  test("prints line numbers and hides CRLF from the output", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.txt"), "one\r\ntwo\r\nthree\r\n");
    const result = await runRead({ path: "a.txt", limit: 2 }, context(cwd));
    expect(result.ok).toBe(true);
    expect(result.output).toContain("1: one");
    expect(result.output).toContain("2: two");
    expect(result.output).not.toContain("\r");
    expect(result.output).toContain("offset=3");
  });

  test("decodes UTF-16LE and UTF-8 BOM files", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "utf16.txt"), Buffer.from("\uFEFFhi\nthere\n", "utf16le"));
    await writeFile(join(cwd, "utf8.txt"), Buffer.from("\uFEFFhi\nthere\n", "utf8"));

    const utf16 = await runRead({ path: "utf16.txt" }, context(cwd));
    expect(utf16.ok).toBe(true);
    expect(utf16.output).toContain("1: hi");
    expect(utf16.output).toContain("2: there");

    const reads = new ReadTracker();
    const utf8 = await runRead({ path: "utf8.txt" }, context(cwd, reads));
    expect(utf8.ok).toBe(true);
    expect(utf8.output).toContain("1: hi");
    expect(utf8.output).not.toContain("\uFEFF");

    const edited = await runEdit(
      { path: "utf8.txt", oldString: "hi", newString: "HELLO" },
      context(cwd, reads),
    );
    expect(edited.ok).toBe(true);
    const bytes = await readFile(join(cwd, "utf8.txt"));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString("utf8")).toBe("HELLO\nthere\n");
  });

  test("rejects binary files by NUL sampling", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "bin.dat"), Buffer.from([0x61, 0x00, 0x62, 0x00]));
    const result = await runRead({ path: "bin.dat" }, context(cwd));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("binary");
  });

  test("rejects a FIFO without opening it", async () => {
    const cwd = await tempDir();
    const fifo = join(cwd, "pipe");
    if (!makeFifo(fifo)) return;
    const result = await runRead({ path: "pipe" }, context(cwd));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not a regular file");
  });

  test("reads an offset range", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.txt"), "one\ntwo\nthree\nfour\nfive\n");
    const result = await runRead({ path: "a.txt", offset: 3, limit: 2 }, context(cwd));
    expect(result.ok).toBe(true);
    expect(result.output).toContain("3: three");
    expect(result.output).toContain("4: four");
    expect(result.output).not.toContain("2: two");
    expect(result.output).toContain("offset=5");
  });
});

describe("edit files", () => {
  test("preserves CRLF when the replacement uses LF", async () => {
    const cwd = await tempDir();
    const path = join(cwd, "a.txt");
    await writeFile(path, "one\r\ntwo\r\nthree\r\n");
    const reads = new ReadTracker();
    await runRead({ path: "a.txt" }, context(cwd, reads));

    const result = await runEdit(
      { path: "a.txt", oldString: "one\ntwo", newString: "ONE\nTWO" },
      context(cwd, reads),
    );
    expect(result.ok).toBe(true);
    expect(await readFile(path, "utf8")).toBe("ONE\r\nTWO\r\nthree\r\n");
  });

  test("keeps mixed line endings exactly as they were", async () => {
    const cwd = await tempDir();
    const path = join(cwd, "mixed.txt");
    await writeFile(path, "a\r\nb\nc\r\n");
    const reads = new ReadTracker();
    await runRead({ path: "mixed.txt" }, context(cwd, reads));

    const result = await runEdit(
      { path: "mixed.txt", oldString: "b", newString: "B" },
      context(cwd, reads),
    );
    expect(result.ok).toBe(true);
    expect(await readFile(path, "utf8")).toBe("a\r\nB\nc\r\n");
  });

  test.each([
    ["replace", "a\nb\nC", "\uFEFFa\r\nb\nC\r\nd\n"],
    ["change", "A\nB\nc", "\uFEFFA\r\nB\nc\r\nd\n"],
    ["insert", "a\nnew\nb\nc", "\uFEFFa\r\nnew\r\nb\nc\r\nd\n"],
    ["delete", "b\nc", "\uFEFFb\nc\r\nd\n"],
  ])(
    "preserves mixed endings within multiline registry edits: %s",
    async (_, replacement, expected) => {
      const cwd = await tempDir();
      const path = join(cwd, "mixed.txt");
      await writeFile(path, "\uFEFFa\r\nb\nc\r\nd\n");
      const ctx = context(cwd);
      const registry = new ToolRegistry(builtinTools(), { limits });
      expect(
        (await registry.run({ id: "r", name: "read", args: { path: "mixed.txt" } }, ctx)).ok,
      ).toBe(true);
      const result = await registry.run(
        {
          id: "e",
          name: "edit",
          args: { path: "mixed.txt", oldString: "a\nb\nc", newString: replacement },
        },
        ctx,
      );
      expect(result.ok).toBe(true);
      expect(await readFile(path, "utf8")).toBe(expected);
    },
  );

  test.each([
    ["remove", "a\r\nb\n", "a\nb", "a\r\nb"],
    ["add", "a\r\nb\nc", "a\nb\nc\n", "a\r\nb\nc\r\n"],
  ])(
    "preserves mixed endings when final newline is the only edit: %s",
    async (_, source, next, expected) => {
      const cwd = await tempDir();
      const path = join(cwd, "mixed.txt");
      await writeFile(path, source);
      const ctx = context(cwd);
      const registry = new ToolRegistry(builtinTools(), { limits });
      expect(
        (await registry.run({ id: "r", name: "read", args: { path: "mixed.txt" } }, ctx)).ok,
      ).toBe(true);
      const result = await registry.run(
        {
          id: "e",
          name: "edit",
          args: {
            path: "mixed.txt",
            oldString: source.replaceAll("\r\n", "\n"),
            newString: next,
          },
        },
        ctx,
      );
      expect(result.ok).toBe(true);
      expect(await readFile(path, "utf8")).toBe(expected);
    },
  );

  test("rejects an oversized mixed-ending alignment before writing", async () => {
    const cwd = await tempDir();
    const path = join(cwd, "mixed.txt");
    const lines = Array.from({ length: 2100 }, (_, index) => `line ${index}`);
    const source = lines.map((line, index) => line + (index % 2 === 0 ? "\r\n" : "\n")).join("");
    await writeFile(path, source);
    const ctx = context(cwd);
    const registry = new ToolRegistry(builtinTools(), { limits });
    expect(
      (await registry.run({ id: "r", name: "read", args: { path: "mixed.txt" } }, ctx)).ok,
    ).toBe(true);
    const result = await registry.run(
      {
        id: "e",
        name: "edit",
        args: {
          path: "mixed.txt",
          oldString: lines.join("\n"),
          newString: lines.join("\n").toUpperCase(),
        },
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("smaller exact edits");
    expect(await readFile(path, "utf8")).toBe(source);
  });

  test("applies multiple hunks in one call and keeps CRLF", async () => {
    const cwd = await tempDir();
    const path = join(cwd, "a.txt");
    await writeFile(path, "one\r\ntwo\r\nthree\r\n");
    const reads = new ReadTracker();
    await runRead({ path: "a.txt" }, context(cwd, reads));

    const result = await runEdit(
      {
        path: "a.txt",
        edits: [
          { oldString: "one", newString: "ONE" },
          { oldString: "three", newString: "THREE" },
        ],
      },
      context(cwd, reads),
    );
    expect(result.ok).toBe(true);
    expect(await readFile(path, "utf8")).toBe("ONE\r\ntwo\r\nTHREE\r\n");
    expect(result.output).toContain("2 replacement(s)");
  });

  test("rejects overlapping hunks without writing", async () => {
    const cwd = await tempDir();
    const path = join(cwd, "a.txt");
    await writeFile(path, "alpha beta\n");
    const reads = new ReadTracker();
    await runRead({ path: "a.txt" }, context(cwd, reads));

    const result = await runEdit(
      {
        path: "a.txt",
        edits: [
          { oldString: "alpha beta", newString: "x" },
          { oldString: "beta", newString: "y" },
        ],
      },
      context(cwd, reads),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("overlap");
    expect(await readFile(path, "utf8")).toBe("alpha beta\n");
  });

  test("verifies surrounding context before writing", async () => {
    const cwd = await tempDir();
    const path = join(cwd, "a.txt");
    await writeFile(path, "one\ntwo\n");
    const reads = new ReadTracker();
    await runRead({ path: "a.txt" }, context(cwd, reads));

    const result = await runEdit(
      { path: "a.txt", oldString: "one\nmissing", newString: "x" },
      context(cwd, reads),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Could not find oldString");
    expect(await readFile(path, "utf8")).toBe("one\ntwo\n");
  });

  test("rejects mixing the old and new arguments", async () => {
    const cwd = await tempDir();
    const path = join(cwd, "a.txt");
    await writeFile(path, "one\n");
    const reads = new ReadTracker();
    await runRead({ path: "a.txt" }, context(cwd, reads));

    const result = await runEdit(
      {
        path: "a.txt",
        oldString: "one",
        newString: "ONE",
        edits: [{ oldString: "one", newString: "1" }],
      },
      context(cwd, reads),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("either");
    expect(await readFile(path, "utf8")).toBe("one\n");
  });
});
