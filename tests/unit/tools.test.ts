import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBash } from "../../src/tools/bash/run";
import { builtinTools } from "../../src/tools/builtin";
import { runDone } from "../../src/tools/done/run";
import { runEdit } from "../../src/tools/edit/run";
import { runGlob } from "../../src/tools/glob/run";
import { runGrep } from "../../src/tools/grep/run";
import { runRead } from "../../src/tools/read/run";
import { ToolRegistry } from "../../src/tools/registry";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";
import { runWrite } from "../../src/tools/write/run";

const dirs: string[] = [];
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-tools-"));
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

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("tool specs", () => {
  test("names are unique and schemas are object shaped", () => {
    const tools = builtinTools();
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    for (const tool of tools) {
      expect(tool.parameters.type).toBe("object");
      expect(Array.isArray(tool.parameters.required)).toBe(true);
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });
});

describe("read", () => {
  test("pages through a file and records the read", async () => {
    const cwd = await tempDir();
    const path = join(cwd, "a.txt");
    await writeFile(path, "one\ntwo\nthree\n");
    const reads = new ReadTracker();
    const result = await runRead({ path: "a.txt", limit: 2 }, context(cwd, reads));
    expect(result.ok).toBe(true);
    expect(result.output).toContain("one");
    expect(result.output).toContain("two");
    expect(result.output).toContain("more lines");
    expect(reads.verify(path, "one\ntwo\nthree\n")).toBe("ok");
  });

  test("reports a missing file", async () => {
    const cwd = await tempDir();
    const result = await runRead({ path: "nope.txt" }, context(cwd));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });
});

describe("write and edit", () => {
  test("writes a new file", async () => {
    const cwd = await tempDir();
    const result = await runWrite(
      { path: "src/a.ts", content: "export const a = 1;\n" },
      context(cwd),
    );
    expect(result.ok).toBe(true);
    expect(await readFile(join(cwd, "src/a.ts"), "utf8")).toBe("export const a = 1;\n");
    expect(result.data).toMatchObject({ kind: "file", state: "A", add: 1 });
  });

  test("requires reading before editing", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "const a = 1;\n");
    const result = await runEdit({ path: "a.ts", oldString: "1", newString: "2" }, context(cwd));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Read a.ts");
  });

  test("refuses an edit after the file changed", async () => {
    const cwd = await tempDir();
    const path = join(cwd, "a.ts");
    await writeFile(path, "one\n");
    const reads = new ReadTracker();
    await runRead({ path: "a.ts" }, context(cwd, reads));
    await writeFile(path, "two\n");
    const result = await runEdit(
      { path: "a.ts", oldString: "two", newString: "three" },
      context(cwd, reads),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("changed after it was read");
  });

  test("edits after a read and refuses an ambiguous match", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "one one\n");
    const reads = new ReadTracker();
    await runRead({ path: "a.ts" }, context(cwd, reads));

    const ambiguous = await runEdit(
      { path: "a.ts", oldString: "one", newString: "two" },
      context(cwd, reads),
    );
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.error).toContain("matches 2 places");

    const result = await runEdit(
      { path: "a.ts", oldString: "one", newString: "two", replaceAll: true },
      context(cwd, reads),
    );
    expect(result.ok).toBe(true);
    expect(await readFile(join(cwd, "a.ts"), "utf8")).toBe("two two\n");
    expect(result.data).toMatchObject({ kind: "file", add: 1, del: 1 });
  });
});

describe("search", () => {
  test("grep finds lines", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "const needle = 1;\nconst other = 2;\n");
    const result = await runGrep({ pattern: "needle", maxResults: 10 }, context(cwd));
    expect(result.ok).toBe(true);
    expect(result.output).toContain("a.ts");
    expect(result.output).toContain("needle");
  });

  test("grep searches a single file", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "const needle = 1;\n");
    const result = await runGrep({ pattern: "needle", path: "a.ts" }, context(cwd));
    expect(result.ok).toBe(true);
    expect(result.output).toContain("a.ts:1:");
  });

  test("glob finds files", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "");
    await writeFile(join(cwd, "b.md"), "");
    const result = await runGlob({ pattern: "*.ts" }, context(cwd));
    expect(result.ok).toBe(true);
    expect(result.output).toContain("a.ts");
    expect(result.output).not.toContain("b.md");
  });
});

describe("bash and done", () => {
  test("captures output and exit code", async () => {
    const cwd = await tempDir();
    const ok = await runBash({ command: "printf hi" }, context(cwd));
    expect(ok.ok).toBe(true);
    expect(ok.output).toBe("hi");
    expect(ok.data).toMatchObject({ kind: "terminal", exitCode: 0 });

    const failed = await runBash({ command: "exit 7" }, context(cwd));
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("code 7");
  });

  test("done terminates the loop", async () => {
    const result = await runDone({ summary: "shipped", evidence: ["bun test"] });
    expect(result.terminate).toBe(true);
    expect(result.output).toContain("shipped");
  });
});

describe("registry", () => {
  test("repairs aliases and reports a note", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "hello\n");
    const registry = new ToolRegistry(builtinTools(), { limits });
    const result = await registry.run(
      { id: "call-1", name: "read_file", args: { file_path: "a.ts" } },
      context(cwd),
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain("hello");
    expect(result.notice).toContain("Input repair:");
  });

  test("returns a model-readable correction for invalid args", async () => {
    const cwd = await tempDir();
    const registry = new ToolRegistry(builtinTools(), { limits });
    const result = await registry.run(
      { id: "call-2", name: "edit", args: { path: "a.ts" } },
      context(cwd),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid arguments");
    expect(result.error).toContain("oldString");
  });

  test("spills oversized output to a log file", async () => {
    const cwd = await tempDir();
    const registry = new ToolRegistry(builtinTools(), {
      limits: { ...limits, maxOutputBytes: 200 },
    });
    const result = await registry.run(
      { id: "call-3", name: "bash", args: { command: "printf 'x%.0s' {1..2000}" } },
      context(cwd),
    );
    expect(result.ok).toBe(true);
    expect(result.fullOutputPath).toBeDefined();
    expect(result.trailer).toContain("full output");
  });
});
