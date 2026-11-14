import { describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckpointError, CheckpointStore } from "../../src/store/checkpoints";

async function makeWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "liquid-checkpoints-"));
}

async function exists(path: string): Promise<boolean> {
  return lstat(path)
    .then(() => true)
    .catch(() => false);
}

function captureOptions(paths: string[], label: string) {
  return { paths, label, tool: "write", sessionId: "s-1" };
}

describe("checkpoints", () => {
  test("capture and restore remove a file created after the checkpoint", async () => {
    const dir = await makeWorkspace();
    try {
      const file = join(dir, "new.txt");
      const store = new CheckpointStore({ cwd: dir });
      await store.init();

      const checkpoint = await store.capture(captureOptions(["new.txt"], "create"));
      expect(checkpoint.files).toEqual([{ path: "new.txt" }]);
      expect(checkpoint.bytes).toBe(0);
      expect(checkpoint.label).toBe("create");
      expect(checkpoint.tool).toBe("write");
      expect(checkpoint.sessionId).toBe("s-1");
      expect(await exists(join(dir, ".liquid", "checkpoints", "manifests"))).toBe(true);
      expect(await store.list()).toEqual([checkpoint]);
      expect(await store.get(checkpoint.id)).toEqual(checkpoint);

      await writeFile(file, "created");
      const result = await store.restore(checkpoint.id);
      expect(result.removed).toEqual(["new.txt"]);
      expect(result.restored).toEqual([]);
      expect(await exists(file)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("restore returns an edited file to its pre-image with its mode", async () => {
    const dir = await makeWorkspace();
    try {
      const file = join(dir, "note.txt");
      await writeFile(file, "before");
      await chmod(file, 0o640);

      const store = new CheckpointStore({ cwd: dir });
      const checkpoint = await store.capture(captureOptions(["note.txt"], "edit"));
      expect(checkpoint.files[0]?.beforeHash).toHaveLength(64);
      if (process.platform !== "win32") expect(checkpoint.files[0]?.mode).toBe(0o640);
      expect(checkpoint.bytes).toBe(6);

      await writeFile(file, "after");
      const diff = await store.diff(checkpoint.id);
      expect(diff.files[0]?.status).toBe("modified");

      const result = await store.restore(checkpoint.id);
      expect(result.restored).toEqual(["note.txt"]);
      expect(await readFile(file, "utf8")).toBe("before");
      // Windows does not expose POSIX permission bits; content restoration is checked everywhere.
      if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o640);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("restore recreates a deleted file", async () => {
    const dir = await makeWorkspace();
    try {
      const file = join(dir, "deleted.txt");
      await writeFile(file, "keep me");

      const store = new CheckpointStore({ cwd: dir });
      const checkpoint = await store.capture(captureOptions(["deleted.txt"], "delete"));
      await unlink(file);

      const result = await store.restore(checkpoint.id);
      expect(result.restored).toEqual(["deleted.txt"]);
      expect(await readFile(file, "utf8")).toBe("keep me");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("recordAfter enables redo of the post-image", async () => {
    const dir = await makeWorkspace();
    try {
      const file = join(dir, "doc.txt");
      await writeFile(file, "one");

      const store = new CheckpointStore({ cwd: dir });
      const checkpoint = await store.capture(captureOptions(["doc.txt"], "edit"));
      await writeFile(file, "two");
      await expect(store.restore(checkpoint.id, "after")).rejects.toThrow(/no after state/i);

      const finalized = await store.recordAfter(checkpoint.id);
      expect(finalized.finalizedAt).toBeDefined();
      expect(finalized.files[0]?.afterHash).toHaveLength(64);
      expect(finalized.files[0]?.beforeHash).not.toBe(finalized.files[0]?.afterHash);
      expect(finalized.bytes).toBe(6);

      await store.restore(checkpoint.id);
      expect(await readFile(file, "utf8")).toBe("one");

      const redo = await store.restore(checkpoint.id, "after");
      expect(redo.restored).toEqual(["doc.txt"]);
      expect(await readFile(file, "utf8")).toBe("two");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("accepts pre-images without reading the filesystem", async () => {
    const dir = await makeWorkspace();
    try {
      const file = join(dir, "pre.txt");
      await writeFile(file, "disk");

      const store = new CheckpointStore({ cwd: dir });
      const checkpoint = await store.capture({
        paths: ["pre.txt"],
        label: "pre-image",
        tool: "edit",
        sessionId: "s-1",
        preImages: { "./pre.txt": { content: "memory" } },
      });
      expect(checkpoint.bytes).toBe(6);

      const absent = await store.capture({
        paths: ["later.txt"],
        label: "pre-image",
        tool: "write",
        sessionId: "s-1",
        preImages: { "later.txt": null },
      });
      await writeFile(join(dir, "later.txt"), "later");

      await store.restore(checkpoint.id);
      expect(await readFile(file, "utf8")).toBe("memory");
      await store.restore(absent.id);
      expect(await exists(join(dir, "later.txt"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects symlink targets and symlink ancestors", async () => {
    const dir = await makeWorkspace();
    try {
      const store = new CheckpointStore({ cwd: dir });
      await writeFile(join(dir, "real.txt"), "data");
      await symlink(join(dir, "real.txt"), join(dir, "link.txt"));
      await mkdir(join(dir, "outside"));
      await symlink(join(dir, "outside"), join(dir, "alias"));

      await expect(store.capture(captureOptions(["link.txt"], "symlink"))).rejects.toThrow(
        /symbolic link/i,
      );
      await expect(store.capture(captureOptions(["alias/file.txt"], "symlink"))).rejects.toThrow(
        /symbolic link/i,
      );
      expect(await store.list()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("captures one path in a 10k-file tree under one second", async () => {
    const dir = await makeWorkspace();
    try {
      const tree = join(dir, "tree");
      await mkdir(tree, { recursive: true });
      const names = Array.from({ length: 10_000 }, (_, index) => join(tree, `file-${index}.txt`));
      for (let index = 0; index < names.length; index += 500) {
        await Promise.all(names.slice(index, index + 500).map((path) => writeFile(path, "")));
      }

      const store = new CheckpointStore({ cwd: dir });
      await store.init();
      const started = performance.now();
      const checkpoint = await store.capture(captureOptions(["tree/file-5000.txt"], "performance"));
      const elapsed = performance.now() - started;

      expect(checkpoint.files[0]?.beforeHash).toHaveLength(64);
      expect(elapsed).toBeLessThan(1000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("prune keeps referenced objects and removes unreferenced ones", async () => {
    const dir = await makeWorkspace();
    try {
      const file = join(dir, "f.txt");
      const store = new CheckpointStore({ cwd: dir });
      await store.init();

      await writeFile(file, "a");
      const first = await store.capture(captureOptions(["f.txt"], "prune"));
      await writeFile(file, "b");
      const second = await store.capture(captureOptions(["f.txt"], "prune"));
      await writeFile(file, "a");
      const third = await store.capture(captureOptions(["f.txt"], "prune"));

      const objectsDir = join(dir, ".liquid", "checkpoints", "objects");
      expect(await readdir(objectsDir)).toHaveLength(2);

      const result = await store.prune({ keep: 1 });
      expect([...result.removed].sort()).toEqual([first.id, second.id].sort());
      expect(result.objectsRemoved).toBe(1);
      expect(result.bytesFreed).toBe(1);
      expect((await store.list()).map((checkpoint) => checkpoint.id)).toEqual([third.id]);
      expect(await readdir(objectsDir)).toEqual([third.files[0]?.beforeHash ?? ""]);

      const aged = await store.prune({ maxAgeMs: 0 });
      expect(aged.removed).toEqual([third.id]);
      expect(await store.list()).toEqual([]);
      expect(await readdir(objectsDir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("restore reports a missing object and leaves the target untouched", async () => {
    const dir = await makeWorkspace();
    try {
      const file = join(dir, "oops.txt");
      await writeFile(file, "before");
      const store = new CheckpointStore({ cwd: dir });
      const checkpoint = await store.capture(captureOptions(["oops.txt"], "missing object"));
      const hash = checkpoint.files[0]?.beforeHash;
      if (hash === undefined) throw new Error("expected a pre-image hash");

      await rm(join(dir, ".liquid", "checkpoints", "objects", hash));
      await writeFile(file, "after");
      await expect(store.restore(checkpoint.id)).rejects.toThrow("Checkpoint object is missing");
      expect(await readFile(file, "utf8")).toBe("after");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("errors carry typed codes", async () => {
    const dir = await makeWorkspace();
    try {
      const store = new CheckpointStore({ cwd: dir });
      const error = await store.get("missing").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(CheckpointError);
      expect((error as CheckpointError).code).toBe("manifest_missing");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
