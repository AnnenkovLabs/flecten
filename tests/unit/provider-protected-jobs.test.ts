import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderProtection } from "../../src/security/provider-protection";
import { SecretVault } from "../../src/security/provider-secrets/vault";
import { TerminalManager, type TerminalManagerEvent } from "../../src/terminal/manager";
import { startBackgroundBash } from "../../src/tools/bash/background";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";
import { bunCommand } from "../helpers/terminal-fixtures";

const managers: TerminalManager[] = [];
const dirs: string[] = [];
const vaults: SecretVault[] = [];

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.closeAll();
  for (const vault of vaults.splice(0)) vault.dispose();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(maxLogBytes = 4096) {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-protected-jobs-"));
  dirs.push(cwd);
  const manager = new TerminalManager({
    timeouts: { jobWaitMs: 5000 },
    background: { maxLogBytes },
  });
  managers.push(manager);
  const vault = new SecretVault();
  vaults.push(vault);
  return { cwd, manager, vault, protectOutput: (text: string) => vault.protect(text) };
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await Bun.file(path).exists()) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for ${path}`);
}

describe("protected background jobs", () => {
  test("buffers split npm and Slack tokens, protects events and restores complete output", async () => {
    const { cwd, manager, vault, protectOutput } = await setup();
    const tokens = ["npm_abcdefghijklmnopqrstuvwx", "xoxb-1234567890123456-abcdefghijk"];
    const commandSecret = "backgroundCommandCredential42";
    vault.seed([commandSecret]);
    const command = await bunCommand(
      cwd,
      `const tokens = ${JSON.stringify(tokens)};
       for (let index = 0; index < tokens.length; index += 1) {
         const token = tokens[index];
         process.stdout.write(token.slice(0, 10));
         await Bun.sleep(20);
         process.stderr.write("diagnostic\\n");
         await Bun.sleep(20);
         await Bun.write(${JSON.stringify(cwd)} + "/ready-" + index, "ready");
         while (!(await Bun.file(${JSON.stringify(cwd)} + "/release-" + index).exists())) {
           await Bun.sleep(10);
         }
         process.stdout.write(token.slice(10) + "\\n");
       }`,
    );
    const events: TerminalManagerEvent[] = [];
    manager.onEvent((event) => events.push(event));
    const job = manager.startJob(`${command} ${commandSecret}`, { cwd, protectOutput });
    for (const [index, token] of tokens.entries()) {
      await waitForFile(join(cwd, `ready-${index}`));
      const running = job.snapshot();
      expect(running.status).toBe("running");
      expect(running.log).toContain("available when the job finishes");
      expect(running.log).not.toContain(token.slice(0, 10));
      expect(running.command).not.toContain(commandSecret);
      expect(JSON.stringify(events)).not.toContain(commandSecret);
      await Bun.write(join(cwd, `release-${index}`), "release");
    }
    const { job: completed } = await job.wait();
    await manager.settledJob(job.id);
    expect(completed.status).toBe("exited");
    expect(completed.log).toContain("[[secret_");
    expect(vault.restore(completed.log)).toBe(`${tokens.join("\n")}\ndiagnostic\ndiagnostic\n`);
    expect(vault.restore(completed.command)).toBe(`${command} ${commandSecret}`);
    for (const token of tokens) expect(JSON.stringify(events)).not.toContain(token);
    expect(events.map((event) => event.type)).toEqual(["job.started", "job.completed"]);
    const last = events.at(-1);
    expect(last?.type).toBe("job.completed");
    if (last?.type === "job.completed") expect(last.job.log).toBe(completed.log);
  });

  test("withholds a truncated token tail", async () => {
    const { cwd, manager, protectOutput } = await setup(8);
    const token = "npm_abcdefghijklmnopqrstuvwx";
    const job = manager.startJob(
      await bunCommand(cwd, `process.stdout.write(${JSON.stringify(token)});`),
      { cwd, protectOutput },
    );
    const { job: completed } = await job.wait();
    expect(completed.droppedBytes).toBeGreaterThan(0);
    expect(completed.log).toContain("withheld because the log was truncated");
    expect(completed.log).not.toContain(token.slice(-8));
  });

  test("protects startup errors without changing the ordinary output boundary", async () => {
    const { cwd, manager, vault } = await setup();
    const secret = "npm_abcdefghijklmnopqrstuvwx";
    manager.configure({ shell: secret });
    const failed = manager.startJob("echo ok", {
      cwd,
      protectOutput: (text) => vault.protect(text),
    });
    const failure = await failed.wait();
    expect(failure.job.status).toBe("failed");
    expect(failure.job.error).not.toContain(secret);
    expect(vault.restore(failure.job.error)).toContain(secret);

    manager.configure({});
    const ordinary = manager.startJob(
      await bunCommand(cwd, `console.log(${JSON.stringify(secret)});`),
      { cwd },
    );
    expect((await ordinary.wait()).job.log).toBe(`${secret}\n`);
  });

  test("background bash attaches its provider vault to manager events", async () => {
    const { cwd, manager } = await setup();
    const protection = new ProviderProtection({});
    vaults.push(protection.vault);
    const secret = "xoxb-1234567890123456-abcdefghijk";
    const events: TerminalManagerEvent[] = [];
    manager.onEvent((event) => events.push(event));
    const context: ToolContext = {
      cwd,
      sessionId: "protected-job-test",
      signal: new AbortController().signal,
      logDir: cwd,
      reads: new ReadTracker(),
      terminals: manager,
      providerProtection: protection,
      limits: {
        maxOutputBytes: 4096,
        maxOutputLines: 100,
        bashTimeoutMs: 5000,
        readLimitLines: 100,
      },
    };
    const result = await startBackgroundBash(
      { command: await bunCommand(cwd, `console.log(${JSON.stringify(secret)});`) },
      context,
      cwd,
    );
    expect(result.ok).toBe(true);
    const job = manager.listJobs()[0];
    if (!job) throw new Error("Background bash did not start a job");
    await job.wait();
    await manager.settledJob(job.id);
    const completed = events.find((event) => event.type === "job.completed");
    expect(completed?.job.log).toContain("[[secret_");
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(protection.vault.restore(completed?.job.log)).toBe(`${secret}\n`);
  });
});
