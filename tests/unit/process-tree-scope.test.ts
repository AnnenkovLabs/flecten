import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeProcessUsage, parseLsofPorts } from "../../src/terminal/native-processes";
import { runBash } from "../../src/tools/bash/run";

test.skipIf(process.platform !== "linux" || !Bun.which("setsid"))(
  "production bash kills an orphan that starts a separate session",
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-process-scope-"));
    let pid: number | undefined;
    try {
      const result = await runBash(
        { command: "setsid sleep 30 </dev/null >/dev/null 2>&1 & echo $! > escaped.pid; exit 0" },
        { cwd, signal: new AbortController().signal, limits: { bashTimeoutMs: 3000 } },
      );
      expect(result.ok).toBe(true);
      pid = Number(await readFile(join(cwd, "escaped.pid"), "utf8"));
      expect(pid).toBeGreaterThan(0);
      await Bun.sleep(30);
      const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
      const state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0];
      expect(state === "" || state === "Z").toBe(true);
    } finally {
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")("native process metrics return actual RSS", () => {
  const usage = nativeProcessUsage([process.pid]);
  expect(usage.count).toBe(1);
  expect(usage.memoryBytes).toBeGreaterThan(0);
  expect(parseLsofPorts("p12\nn[::1]:4000\nn127.0.0.1:5000->127.0.0.1:90\n")).toEqual([4000, 5000]);
});
