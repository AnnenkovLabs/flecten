import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalManager } from "../../src/terminal/manager";
import { runBash } from "../../src/tools/bash/run";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("foreground bash resources", () => {
  test.skipIf(process.platform === "win32")("runs commands in the configured shell", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-configured-shell-"));
    dirs.push(cwd);
    const terminals = new TerminalManager({ shell: "/bin/sh" });
    const result = await runBash(
      { command: "printf '%s' \"$0\"" },
      { cwd, signal: new AbortController().signal, limits: { bashTimeoutMs: 5000 }, terminals },
    );
    expect(result.ok).toBe(true);
    expect(result.output).toBe("/bin/sh");
  });

  test.skipIf(process.platform === "win32")(
    "applies zero-loss carriage-return resolution and collapses passing suites on failure",
    async () => {
      const cwd = await mkdtemp(join(tmpdir(), "flecten-bash-zeroloss-"));
      dirs.push(cwd);
      const result = await runBash(
        {
          command:
            "printf 'Step 10%%\\rStep 100%%\\n(pass) t1\\n(pass) t2\\n(pass) t3\\n(pass) t4\\n(pass) t5\\n(pass) t6\\n(fail) t7\\nError: boom\\n'; exit 1",
        },
        { cwd, signal: new AbortController().signal, limits: { bashTimeoutMs: 5000 } },
      );
      expect(result.ok).toBe(false);
      expect(result.output).toContain("Step 100%");
      expect(result.output).not.toContain("Step 10%");
      expect(result.output).toContain("... [6 passing test lines omitted] ...");
      expect(result.output).toContain("(fail) t7");
      expect(result.output).toContain("Error: boom");
    },
  );

  test.skipIf(process.platform !== "linux")("enforces the configured UDP port range", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-bash-ports-"));
    dirs.push(cwd);
    const terminals = new TerminalManager({ limits: { ports: { min: 1, max: 1 } } });
    const result = await runBash(
      {
        command: `'${process.execPath.replaceAll("'", "'\\''")}' -e 'import { createSocket } from "node:dgram"; createSocket("udp4").bind(0, "127.0.0.1");'`,
      },
      { cwd, signal: new AbortController().signal, limits: { bashTimeoutMs: 5000 }, terminals },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("port");
    expect(result.error).toContain("outside 1-1");
  });

  test.skipIf(process.platform !== "linux")(
    "enforces the configured process tree budget",
    async () => {
      const cwd = await mkdtemp(join(tmpdir(), "flecten-bash-resources-"));
      dirs.push(cwd);
      const terminals = new TerminalManager({ limits: { maxProcesses: 2 } });
      const result = await runBash(
        { command: "sleep 30 & sleep 30 & wait" },
        { cwd, signal: new AbortController().signal, limits: { bashTimeoutMs: 5000 }, terminals },
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain("process count");
      expect(result.data).toMatchObject({ timedOut: false, resourceError: result.error });
    },
  );
});
