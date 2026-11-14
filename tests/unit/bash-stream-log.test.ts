import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runSandboxed } from "../../src/security/os-sandbox";
import { runBash } from "../../src/tools/bash/run";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { ReadTracker } from "../../src/tools/util/read-tracker";
import { bunFileCommand } from "../helpers/shell-command";
import { bunCommand } from "../helpers/terminal-fixtures";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const limits = {
  bashTimeoutMs: 10_000,
  maxOutputBytes: 2000,
  maxOutputLines: 2000,
  readLimitLines: 100,
};
const source = resolve(import.meta.dir, "../helpers/shell-output.ts");
const command = bunFileCommand(source);

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-stream-log-"));
  dirs.push(cwd);
  return {
    cwd,
    signal: new AbortController().signal,
    limits,
    logDir: join(cwd, "logs"),
    sessionId: "s",
    reads: new ReadTracker(),
    secrets: ["opaque credential across words"],
  };
}

async function fullLog(result: Awaited<ReturnType<typeof runBash>>) {
  expect(result.ok).toBe(true);
  expect(result.fullOutputPath).toBeDefined();
  const log = await readFile(result.fullOutputPath ?? "", "utf8");
  expect(log.length).toBeGreaterThan(4_000_000);
  expect(log).toEndWith("TAIL-привіт\n");
  expect(log).toContain("[redacted");
  expect(log).not.toContain("arbitrary-secret-value");
  expect(log).not.toContain("opaque credential across words");
  expect(result.output.length).toBeLessThanOrEqual(2 * 1024 * 1024);
}

describe("streaming bash logs", () => {
  test("keeps credential state per pipe when stderr interrupts a split stdout assignment", async () => {
    const ctx = await workspace();
    const result = await runBash(
      {
        command: await bunCommand(
          ctx.cwd,
          'process.stdout.write("TOKEN="); await Bun.sleep(20); process.stderr.write("innocent\\n"); await Bun.sleep(20); process.stdout.write("private-fragment\\n");',
        ),
      },
      ctx,
    );
    const log = await readFile(result.fullOutputPath ?? "", "utf8");
    expect(log).toContain("innocent");
    expect(log).not.toContain("private-fragment");
  });

  test("keeps all foreground output on disk while bounding the result and registry excerpt", async () => {
    const ctx = await workspace();
    const registry = new ToolRegistry(builtinTools(), { limits });
    const result = await registry.run({ id: "large", name: "bash", args: { command } }, ctx);
    await fullLog(result);
    expect(result.output.length).toBeLessThan(3000);
    expect(result.trailer).toContain(`[full output: ${result.fullOutputPath}]`);
  });

  test("streams sandbox output through the same redacted log", async () => {
    const ctx = await workspace();
    await mkdir(ctx.logDir, { recursive: true });
    const launcher = join(
      ctx.cwd,
      process.platform === "win32" ? "fake-sandbox.exe" : "fake-sandbox",
    );
    await Bun.build({ entrypoints: [source], compile: { outfile: launcher } });
    const result = await runBash(
      { command: "ignored" },
      {
        ...ctx,
        osSandbox: {
          enabled: true,
          workspaceRoot: ctx.cwd,
          allowNetwork: false,
          envAllowlist: ["PATH"],
        },
      },
      {
        detect: () => ({ kind: "bubblewrap", command: launcher, reason: "test" }),
        run: runSandboxed,
      },
    );
    await fullLog(result);
  });
});
