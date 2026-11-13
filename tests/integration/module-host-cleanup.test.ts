import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("module host awaits async cleanup once on stdin closure and shutdown signals", async () => {
  const root = await mkdtemp(join(tmpdir(), "flecten-host-cleanup-"));
  try {
    const entry = join(root, "runtime.mjs");
    await Bun.write(
      entry,
      `export default () => {
      process.stdout.write("ready\\n");
      let calls = 0;
      return async () => {
        calls++;
        await Bun.sleep(50);
        await Bun.write(process.env.FLECTEN_WORKSPACE + "/cleaned", String(calls));
      };
    };`,
    );
    for (const operation of process.platform === "win32"
      ? ["stdin"]
      : ["stdin", "SIGTERM", "SIGINT"]) {
      const child = Bun.spawn(
        [
          process.execPath,
          join(import.meta.dir, "../../src/app/server.ts"),
          "--module-host",
          entry,
        ],
        {
          env: {
            ...process.env,
            FLECTEN_MODULE_NAME: "cleanup",
            FLECTEN_MODULE_VERSION: "1.0.0",
            FLECTEN_WORKSPACE: root,
            FLECTEN_MODULE_ROOT: root,
          },
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      try {
        const reader = child.stdout.getReader();
        expect(new TextDecoder().decode((await reader.read()).value)).toContain("ready");
        reader.releaseLock();
        if (operation === "stdin") child.stdin.end();
        else child.kill(operation as NodeJS.Signals);
        expect(await child.exited).toBe(0);
        expect(await readFile(join(root, "cleaned"), "utf8")).toBe("1");
        await rm(join(root, "cleaned"));
      } finally {
        child.kill();
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
