import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SandboxPolicy } from "../../src/security/sandbox";
import { CheckpointStore } from "../../src/store/checkpoints";
import { runApplyPatch } from "../../src/tools/apply-patch/run";
import { runAsk } from "../../src/tools/ask/run";
import { runDelete } from "../../src/tools/delete/run";
import { runMove } from "../../src/tools/move/run";
import { runTodo } from "../../src/tools/todo/run";
import type { Todo } from "../../src/tools/todo/schema";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";
import { runWebFetch } from "../../src/tools/web/run";

const dirs: string[] = [];
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-tools-pack-"));
  dirs.push(dir);
  return dir;
}
function context(cwd: string, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionId: "s_test",
    cwd,
    signal: new AbortController().signal,
    logDir: join(cwd, ".liquid/logs"),
    limits,
    reads: new ReadTracker(),
    ...overrides,
  };
}
function patchData(result: Awaited<ReturnType<typeof runApplyPatch>>): {
  files: Array<{ path: string; from?: string; state: string }>;
  checkpointId?: string;
} {
  return result.data as { files: Array<{ path: string; from?: string; state: string }> };
}
function todoData(result: Awaited<ReturnType<typeof runTodo>>): Todo[] {
  return (result.data as { todos: Todo[] }).todos;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("apply_patch", () => {
  test("applies add, update, delete and move in one transaction", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.txt"), "one\ntwo\nthree\n");
    await writeFile(join(cwd, "b.txt"), "alpha\nbeta\n");
    await writeFile(join(cwd, "doomed.txt"), "gone\n");

    const patch = [
      "*** Begin Patch",
      "*** Add File: added.txt",
      "+hello",
      "+world",
      "*** Update File: a.txt",
      "@@",
      " one",
      "-two",
      "+two changed",
      " three",
      "*** Delete File: doomed.txt",
      "*** Update File: b.txt",
      "*** Move to: moved/b.txt",
      "*** End Patch",
    ].join("\n");

    const result = await runApplyPatch({ patch }, context(cwd));
    expect(result.ok).toBe(true);
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("one\ntwo changed\nthree\n");
    expect(await readFile(join(cwd, "added.txt"), "utf8")).toBe("hello\nworld");
    expect(await readFile(join(cwd, "moved/b.txt"), "utf8")).toBe("alpha\nbeta\n");
    await expect(readFile(join(cwd, "doomed.txt"), "utf8")).rejects.toThrow();
    await expect(readFile(join(cwd, "b.txt"), "utf8")).rejects.toThrow();

    const data = patchData(result);
    expect(data.files.map((file) => file.state).sort()).toEqual(["A", "D", "M", "R"]);
    expect(data.files.find((file) => file.state === "R")?.from).toBe("b.txt");
  });

  test("rolls back every file when one hunk does not match", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.txt"), "keep\n");
    await writeFile(join(cwd, "b.txt"), "one\n");

    const patch = [
      "*** Begin Patch",
      "*** Add File: new.txt",
      "+new",
      "*** Update File: a.txt",
      "@@",
      "-keep",
      "+changed",
      "*** Update File: b.txt",
      "@@",
      "-missing context",
      "+broken",
      "*** End Patch",
    ].join("\n");

    const result = await runApplyPatch({ patch }, context(cwd));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("does not match");
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("keep\n");
    expect(await readFile(join(cwd, "b.txt"), "utf8")).toBe("one\n");
    await expect(readFile(join(cwd, "new.txt"), "utf8")).rejects.toThrow();
    expect((await readdir(cwd)).filter((name) => name.includes("liquid-tmp"))).toEqual([]);
  });

  test("captures and finalizes a checkpoint", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.txt"), "old\n");
    const store = new CheckpointStore({ cwd });

    const result = await runApplyPatch(
      {
        patch: [
          "*** Begin Patch",
          "*** Update File: a.txt",
          "@@",
          "-old",
          "+new",
          "*** End Patch",
        ].join("\n"),
      },
      context(cwd, { checkpoints: store }),
    );

    expect(result.ok).toBe(true);
    const id = patchData(result).checkpointId;
    expect(id).toBeDefined();
    if (id === undefined) return;
    const checkpoint = await store.get(id);
    expect(checkpoint.finalizedAt).toBeDefined();
    expect(checkpoint.files[0]?.path).toBe("a.txt");
  });

  test("refuses to patch through a symlink escaping the workspace", async () => {
    const cwd = await tempDir();
    const outside = await tempDir();
    await symlink(outside, join(cwd, "link"));

    const result = await runApplyPatch(
      {
        patch: ["*** Begin Patch", "*** Add File: link/escaped.txt", "+nope", "*** End Patch"].join(
          "\n",
        ),
      },
      context(cwd),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("symbolic link");
    await expect(readFile(join(outside, "escaped.txt"), "utf8")).rejects.toThrow();
  });
});

describe("delete and move", () => {
  test("deletes files, refuses non-empty directories and supports recursive delete", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "file.txt"), "data\n");
    await mkdir(join(cwd, "dir"));
    await writeFile(join(cwd, "dir", "inner.txt"), "inside\n");

    expect((await runDelete({ path: "file.txt" }, context(cwd))).ok).toBe(true);
    await expect(readFile(join(cwd, "file.txt"), "utf8")).rejects.toThrow();

    const refused = await runDelete({ path: "dir" }, context(cwd));
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain("recursive");

    const removed = await runDelete({ path: "dir", recursive: true }, context(cwd));
    expect(removed.ok).toBe(true);
    await expect(readFile(join(cwd, "dir", "inner.txt"), "utf8")).rejects.toThrow();
  });

  test("moves files and only overwrites on request", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "from.txt"), "source\n");
    await writeFile(join(cwd, "target.txt"), "target\n");

    const refused = await runMove({ from: "from.txt", to: "target.txt" }, context(cwd));
    expect(refused.ok).toBe(false);
    expect(await readFile(join(cwd, "target.txt"), "utf8")).toBe("target\n");

    const moved = await runMove(
      { from: "from.txt", to: "target.txt", overwrite: true },
      context(cwd),
    );
    expect(moved.ok).toBe(true);
    expect(await readFile(join(cwd, "target.txt"), "utf8")).toBe("source\n");
    await expect(readFile(join(cwd, "from.txt"), "utf8")).rejects.toThrow();
  });
});

describe("todo", () => {
  test("persists todos across contexts and applies updates", async () => {
    const cwd = await tempDir();
    const added = await runTodo(
      { op: "add", content: "Write tests", priority: "high" },
      context(cwd),
    );
    expect(added.ok).toBe(true);
    const first = todoData(added)[0];
    expect(first?.content).toBe("Write tests");
    if (first === undefined) return;

    await runTodo({ op: "add", content: "Ship it" }, context(cwd));

    const listed = await runTodo({ op: "list" }, context(cwd));
    expect(todoData(listed)).toHaveLength(2);

    const updated = await runTodo(
      { op: "update", id: first.id, status: "completed" },
      context(cwd),
    );
    expect(todoData(updated).find((todo) => todo.id === first.id)?.status).toBe("completed");

    const stored = JSON.parse(
      await readFile(join(cwd, ".liquid", "todos", "s_test.json"), "utf8"),
    ) as { version: number; todos: Todo[] };
    expect(stored.version).toBe(1);
    expect(stored.todos).toHaveLength(2);
    expect(stored.todos.find((todo) => todo.id === first.id)?.status).toBe("completed");

    const removed = await runTodo({ op: "remove", id: first.id }, context(cwd));
    expect(todoData(removed)).toHaveLength(1);
    const cleared = await runTodo({ op: "clear" }, context(cwd));
    expect(todoData(cleared)).toEqual([]);
    expect(todoData(await runTodo({ op: "list" }, context(cwd)))).toEqual([]);
  });
});

describe("ask", () => {
  test("returns the structured question without terminating the turn", async () => {
    const cwd = await tempDir();
    const options = [{ label: "Ship", description: "Release now" }, { label: "Wait" }];
    const result = await runAsk(
      { question: "Release?", options, allowCustom: false },
      context(cwd),
    );

    expect(result.ok).toBe(true);
    expect(result.terminate).toBeUndefined();
    expect(result.data).toEqual({
      kind: "question",
      question: "Release?",
      options,
    });
    expect(result.output).toContain("Ship");
  });
});

describe("web", () => {
  test("fetches HTML from a local server and extracts text and title", async () => {
    const cwd = await tempDir();
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          "<html><head><title>Local &amp; Test</title><style>.x{}</style></head><body><h1>Hello</h1><p>world &lt;3</p><script>bad()</script></body></html>",
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
    });

    try {
      const result = await runWebFetch({ url: `http://127.0.0.1:${server.port}/` }, context(cwd));
      expect(result.ok).toBe(true);
      expect(result.output).toContain("Title: Local & Test");
      expect(result.output).toContain("Hello");
      expect(result.output).toContain("world <3");
      expect(result.output).not.toContain("bad()");
      const data = result.data as { title: string; finalUrl: string };
      expect(data.title).toBe("Local & Test");
      expect(data.finalUrl).toContain("127.0.0.1");
    } finally {
      server.stop(true);
    }
  });

  test("reports a clear error when the sandbox denies network access", async () => {
    const cwd = await tempDir();
    const sandbox = new SandboxPolicy({ workspaceRoot: cwd, allowNetwork: false });
    const result = await runWebFetch({ url: "https://example.com/" }, context(cwd, { sandbox }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Network access denied");
  });
});
