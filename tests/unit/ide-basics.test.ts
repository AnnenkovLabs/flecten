import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdeTerminal } from "../../src/app/ide-terminal";
import { createHandlers } from "../../src/app/server-handlers";
import type { AppService } from "../../src/app/service";

async function project(
  run: (cwd: string, handlers: ReturnType<typeof createHandlers>) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "ide-basics-"));
  const terminal = new IdeTerminal(cwd, () => ({}));
  const handlers = createHandlers(
    { info: () => ({ cwd }), ideTerminal: terminal } as unknown as AppService,
    () => undefined,
  );
  try {
    await run(cwd, handlers);
  } finally {
    await terminal.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
}

test("explorer creates empty folders and files, renames without overwrite, and trashes recoverable contents", async () => {
  await project(async (cwd, handlers) => {
    const change = (input: Record<string, unknown>) =>
      handlers["files.change"]({ type: "files.change", ...input });
    await change({ operation: "create", path: "src", directory: true });
    await change({ operation: "create", path: "src/a.ts", directory: false });
    await writeFile(join(cwd, "src/a.ts"), "const answer = 42;\n");
    await change({ operation: "create", path: "empty", directory: true });
    expect(await handlers["files.list"]({ type: "files.list" })).toMatchObject({
      files: ["src/a.ts"],
      directories: ["empty", "src"],
    });
    await expect(
      change({ operation: "create", path: "src/a.ts", directory: false }),
    ).rejects.toThrow();
    await change({ operation: "rename", path: "src/a.ts", destination: "empty/b.ts" });
    expect(await readFile(join(cwd, "empty/b.ts"), "utf8")).toContain("42");
    await expect(
      change({ operation: "rename", path: "src", destination: "empty" }),
    ).rejects.toThrow("существует");
    await expect(change({ operation: "trash", path: "empty" })).rejects.toThrow();
    await change({ operation: "trash", path: "empty", confirm: true });
    const trash = await readdir(join(cwd, ".liquid/ide-trash"));
    expect(
      await readFile(join(cwd, ".liquid/ide-trash", trash[0] ?? "missing", "b.ts"), "utf8"),
    ).toContain("42");
    await expect(
      change({ operation: "create", path: "../escaped", directory: false }),
    ).rejects.toThrow();
    await expect(
      change({ operation: "create", path: ".liquid/no", directory: false }),
    ).rejects.toThrow();
    await symlink(tmpdir(), join(cwd, "outside"));
    await expect(
      change({ operation: "create", path: "outside/escaped", directory: false }),
    ).rejects.toThrow();
    await expect(
      change({ operation: "rename", path: "outside", destination: "link" }),
    ).rejects.toThrow();
  });
});

test("project search returns real line positions, literal metacharacters, case and word options and redacts secrets", async () => {
  await project(async (cwd, handlers) => {
    await writeFile(
      join(cwd, "sample.ts"),
      "const answer = 'a.b';\nAnswer answers answer\nключ ключи\nsecret ghp_abcdefghijklmnopqrstuvwxyz0123456789\n",
    );
    const find = async (query: string, extra = {}) =>
      (await handlers["files.search"]({ type: "files.search", query, ...extra }))?.search as {
        matches: Array<{ line: number; column: number; text: string }>;
        limited: boolean;
      };
    expect((await find("a.b")).matches).toMatchObject([{ line: 1, column: 17 }]);
    expect((await find("answer", { wholeWord: true })).matches).toHaveLength(3);
    expect((await find("answer", { wholeWord: true, caseSensitive: true })).matches).toHaveLength(
      2,
    );
    expect((await find("ключ", { wholeWord: true })).matches).toHaveLength(1);
    await writeFile(join(cwd, "unicode.txt"), "İ needle\n");
    expect((await find("needle")).matches).toMatchObject([{ line: 1, column: 3 }]);
    expect((await find("ghp_abcdefghijklmnopqrstuvwxyz")).matches).toHaveLength(0);
    expect((await find("answer", { include: "missing/" })).matches).toHaveLength(0);
    await writeFile(join(cwd, "many.txt"), "needle\n".repeat(600));
    expect(await find("needle")).toMatchObject({ limited: true });
    expect((await find("needle")).matches).toHaveLength(500);
  });
});

test("user PTY accepts real interactive input, reports cursor deltas and is stopped with its service", async () => {
  await project(async (_, handlers) => {
    const terminal = (input: Record<string, unknown>) =>
      handlers["ide.terminal"]({ type: "ide.terminal", ...input });
    await terminal({ action: "read", cols: 90, rows: 20 });
    await terminal({ action: "write", data: "printf 'IDE_TERMINAL_OK\\n'\r" });
    let data = "";
    let cursor = 0;
    for (let i = 0; i < 50; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const reply = (await terminal({ action: "read", cursor }))?.terminal as {
        data: string;
        cursor: number;
      };
      cursor = reply.cursor;
      data += reply.data;
      if (data.includes("IDE_TERMINAL_OK\r\n")) break;
    }
    expect(data).toContain("IDE_TERMINAL_OK\r\n");
    expect((await terminal({ action: "read", cursor }))?.terminal).toMatchObject({ data: "" });
    await terminal({ action: "resize", cols: 120, rows: 30 });
    expect((await terminal({ action: "stop" }))?.terminal).toMatchObject({ running: false });
  });
});

test("Git UI stages only explicit paths, shows real diffs, unstages and commits in its project", async () => {
  await project(async (cwd, handlers) => {
    const run = async (...args: string[]) => {
      const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
      const output = await new Response(child.stdout).text();
      if (await child.exited) throw new Error(await new Response(child.stderr).text());
      return output;
    };
    await run("init");
    await run("config", "user.name", "IDE Test");
    await run("config", "user.email", "ide@example.test");
    await writeFile(join(cwd, "a.txt"), "first\n");
    await run("add", "a.txt");
    await run("commit", "-m", "initial");
    await writeFile(join(cwd, "a.txt"), "second\n");
    const git = (input: Record<string, unknown>) =>
      handlers["files.git"]({ type: "files.git", ...input });
    expect((await git({ action: "status" }))?.git).toMatchObject({
      repository: true,
      entries: [{ path: "a.txt", worktree: "M" }],
    });
    expect((await git({ action: "diff", path: "a.txt", staged: false }))?.git).toMatchObject({
      path: "a.txt",
      text: expect.stringContaining("+second"),
    });
    await expect(git({ action: "stage", path: "." })).rejects.toThrow();
    await git({ action: "stage", path: "a.txt" });
    expect((await git({ action: "status" }))?.git).toMatchObject({
      entries: [{ index: "M", worktree: " " }],
    });
    await git({ action: "unstage", path: "a.txt" });
    expect(await run("diff", "--cached")).toBe("");
    await git({ action: "stage", path: "a.txt" });
    await git({ action: "commit", message: "edited from IDE" });
    expect((await run("log", "-1", "--format=%s")).trim()).toBe("edited from IDE");
    await writeFile(join(cwd, "a[1].txt"), "literal path\n");
    await writeFile(join(cwd, "a1.txt"), "other path\n");
    await git({ action: "stage", path: "a[1].txt" });
    expect(await run("diff", "--cached", "--name-only")).toBe("a[1].txt\n");
    await git({ action: "unstage", path: "a[1].txt" });
    await mkdir(join(cwd, "nested"));
    await writeFile(join(cwd, "nested/inside.txt"), "inside\n");
    const { workspaceGit } = await import("../../src/app/workspace-git");
    expect(await workspaceGit(join(cwd, "nested"), { action: "status" })).toMatchObject({
      entries: [{ path: "inside.txt" }],
    });
    await workspaceGit(join(cwd, "nested"), { action: "stage", path: "inside.txt" });
    await git({ action: "stage", path: "a1.txt" });
    await expect(
      workspaceGit(join(cwd, "nested"), { action: "commit", message: "nested" }),
    ).rejects.toThrow("вне открытого проекта");
  });
});

test("project replace previews exact files and refuses to overwrite changes made after preview", async () => {
  await project(async (cwd, handlers) => {
    await writeFile(join(cwd, "a.txt"), "hello hello\n");
    await writeFile(join(cwd, "b.txt"), "Hello\n");
    const options = {
      type: "files.replace",
      query: "hello",
      replacement: "world",
      caseSensitive: false,
      wholeWord: true,
      include: "",
    };
    const preview = (await handlers["files.replace"]({ ...options, action: "preview" }))
      ?.replacement as { files: Array<{ path: string; expectedHash: string; count: number }> };
    expect(preview.files.map((file) => file.count)).toEqual([2, 1]);
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("hello hello\n");
    await writeFile(join(cwd, "b.txt"), "external edit\n");
    expect(
      (await handlers["files.replace"]({ ...options, action: "apply", files: preview.files }))
        ?.replacement,
    ).toMatchObject({ completed: ["a.txt"], errors: [{ path: "b.txt" }] });
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("world world\n");
    expect(await readFile(join(cwd, "b.txt"), "utf8")).toBe("external edit\n");
    await writeFile(join(cwd, "unicode.txt"), "İ hello\n");
    const next = (
      await handlers["files.replace"]({ ...options, include: "unicode.txt", action: "preview" })
    )?.replacement as { files: typeof preview.files };
    await handlers["files.replace"]({
      ...options,
      include: "unicode.txt",
      action: "apply",
      files: next.files,
    });
    expect(await readFile(join(cwd, "unicode.txt"), "utf8")).toBe("İ world\n");
  });
});
