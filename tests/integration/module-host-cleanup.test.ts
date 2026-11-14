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
        // A setup callback can return before the host installs its shutdown handlers.
        // The protocol response confirms the actual host is ready to accept shutdown.
        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "cleanup-test", version: "1.0.0" },
            },
          })}\n`,
        );
        await child.stdin.flush();
        const reader = child.stdout.getReader();
        let response = "";
        while (!response.includes("\n")) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error("Module host exited before initialization");
          response += new TextDecoder().decode(chunk.value);
        }
        expect(JSON.parse(response.split("\n")[0] ?? "").id).toBe(1);
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
