import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("Windows directory fsync EPERM is tolerated while open and IO errors remain visible", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flecten-dir-sync-"));
  const modules = ["src/util/durable.ts", "src/store/storage-migration/fs.ts"].map((path) =>
    resolve(path),
  );
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        "--eval",
        `
        import { mock } from "bun:test";
        const actual = { ...await import("node:fs/promises") };
        let failure;
        let opening = false;
        mock.module("node:fs/promises", () => ({ ...actual,
          open: async (...args) => {
            if (opening) throw Object.assign(new Error("open failed"), { code: failure });
            const handle = await actual.open(...args);
            return { sync: async () => {
              throw Object.assign(new Error("sync failed"), { code: failure });
            }, close: () => handle.close() };
          },
        }));
        const syncs = await Promise.all(${JSON.stringify(modules)}.map(async (path) =>
          (await import(path)).syncDirectory));
        const results = [];
        for (const [platform, code, open] of [
          ["win32", "EPERM", false], ["linux", "EPERM", false],
          ["win32", "EIO", false], ["win32", "EPERM", true],
        ]) {
          Object.defineProperty(process, "platform", { value: platform });
          failure = code;
          opening = open;
          for (const sync of syncs) {
            try { await sync(${JSON.stringify(directory)}); results.push("ok"); }
            catch (error) { results.push(error.code); }
          }
        }
        process.stdout.write(JSON.stringify(results));
        `,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual([
      "ok",
      "ok",
      "EPERM",
      "EPERM",
      "EIO",
      "EIO",
      "EPERM",
      "EPERM",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
