import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TerminalJob } from "../../src/terminal/jobs";
import { TerminalManager, type TerminalManagerEvent } from "../../src/terminal/manager";
import type { TerminalSettingsInput } from "../../src/terminal/settings";
import { processAlive } from "../helpers/process-alive";
import { bunCommand, childSource, idleSource } from "../helpers/terminal-fixtures";

const managers: TerminalManager[] = [];
const dirs: string[] = [];
const resourceWaitMs = process.platform === "win32" ? 15_000 : 5000;

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.closeAll();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createManager(settings: TerminalSettingsInput = {}): TerminalManager {
  const manager = new TerminalManager(settings);
  managers.push(manager);
  return manager;
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-terminal-jobs-"));
  dirs.push(dir);
  return dir;
}

async function waitForDead(pid: number, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return;
    await Bun.sleep(20);
  }
  throw new Error(`Process ${pid} is still alive`);
}

async function waitForLog(job: TerminalJob, text: string, timeoutMs = 3000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await job.wait(50);
    if (result.job.log.includes(text)) return result.job.log;
    if (result.job.status !== "running" && !result.job.log.includes(text)) {
      throw new Error(`Job ${job.id} finished without ${text}: ${result.job.log}`);
    }
  }
  throw new Error(`Timed out waiting for ${text} in job ${job.id}`);
}

function childPid(log: string): number {
  const match = /CHILD:(\d+)/.exec(log);
  if (match === null) throw new Error(`No child pid in ${log}`);
  return Number(match[1]);
}

describe("TerminalJob with the native platform shell", () => {
  test("runs, waits and notifies on completion", async () => {
    const cwd = await tempDir();
    const manager = createManager({
      timeouts: { jobWaitMs: 5000 },
      background: { maxLogBytes: 4096 },
    });
    const events: TerminalManagerEvent[] = [];
    manager.onEvent((event) => events.push(event));

    const job = manager.startJob(
      await bunCommand(cwd, 'console.log("ONE"); await Bun.sleep(50); console.log("TWO");'),
      { cwd },
    );
    expect(manager.getJob(job.id)).toBe(job);
    const result = await job.wait();
    expect(result.timedOut).toBe(false);
    expect(result.job.status).toBe("exited");
    expect(result.job.exitCode).toBe(0);
    expect(result.job.log).toContain("ONE");
    expect(result.job.log).toContain("TWO");

    const failed = manager.startJob(
      await bunCommand(cwd, 'console.error("BAD"); process.exit(7);'),
      { cwd },
    );
    const failure = await failed.wait();
    expect(failure.job.status).toBe("failed");
    expect(failure.job.exitCode).toBe(7);
    expect(failure.job.error).toContain("code 7");
    expect(failure.job.log).toContain("BAD");

    expect(manager.listJobs().map((entry) => entry.id)).toEqual([job.id, failed.id]);
    await manager.settledJob(failed.id);
    const completed = events.filter((event) => event.type === "job.completed");
    expect(completed.map((event) => event.job.id)).toEqual([job.id, failed.id]);
    expect(events.filter((event) => event.type === "job.started")).toHaveLength(2);
    expect(completed[0]?.notify).toBe(true);
  });

  test("wait times out without stopping the job, stop kills the tree", async () => {
    const manager = createManager({ timeouts: { jobWaitMs: 5000 } });
    const cwd = await tempDir();
    const job = manager.startJob(await bunCommand(cwd, childSource()), { cwd });
    const log = await waitForLog(job, "CHILD:");
    const child = childPid(log);
    const root = job.snapshot().pid;
    expect(root).not.toBeNull();
    expect(processAlive(child)).toBe(true);

    const short = await job.wait(100);
    expect(short.timedOut).toBe(true);
    expect(short.job.status).toBe("running");

    const stopped = await job.stop();
    expect(stopped.status).toBe("stopped");
    await waitForDead(child);
    if (root !== null) await waitForDead(root);
  });

  test("rejects a job above the process limit", async () => {
    const manager = createManager({
      limits: { maxProcesses: 6, maxMemoryBytes: 1024 * 1024 * 1024, ports: null },
    });
    const cwd = await tempDir();
    const command = await bunCommand(
      cwd,
      `for (let index = 0; index < 10; index += 1) {
        Bun.spawn([process.execPath, "-e", ${JSON.stringify(idleSource)}], {
          stdin: "ignore", stdout: "ignore", stderr: "ignore",
        });
        await Bun.sleep(100);
      }
      ${idleSource}`,
    );
    const job = manager.startJob(command, { cwd });
    const result = await job.wait(resourceWaitMs);
    expect(result.job.status).toBe("failed");
    expect(result.job.error).toContain("process count");
  }, 20_000);

  test("rejects a job above the memory limit", async () => {
    const manager = createManager({
      limits: { maxProcesses: 64, maxMemoryBytes: 64 * 1024 * 1024, ports: null },
    });
    const cwd = await tempDir();
    const command = await bunCommand(
      cwd,
      "const chunks = []; for (let i = 0; i < 400; i += 1) { chunks.push(Buffer.alloc(1 << 20, 1)); await Bun.sleep(5); } await Bun.sleep(10000);",
    );
    const job = manager.startJob(command, { cwd });
    const result = await job.wait(resourceWaitMs);
    expect(result.job.status).toBe("failed");
    expect(result.job.error).toContain("memory");
  }, 20_000);

  test("rejects a job listening outside the allowed ports", async () => {
    const probe = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const port = probe.port;
    probe.stop(true);
    expect(port).toBeGreaterThan(2000);

    const manager = createManager({
      limits: {
        maxProcesses: 128,
        maxMemoryBytes: 2 * 1024 * 1024 * 1024,
        ports: { min: 1024, max: 2000 },
      },
    });
    const cwd = await tempDir();
    const command = await bunCommand(
      cwd,
      `Bun.serve({ port: ${port}, fetch() { return new Response("ok"); } }); ${idleSource}`,
    );
    const job = manager.startJob(command, { cwd });
    const result = await job.wait(resourceWaitMs);
    expect(result.job.status).toBe("failed");
    expect(result.job.error).toContain(`port ${port}`);
  }, 20_000);

  test("cleans ANSI and keeps only the bounded log tail", async () => {
    const manager = createManager({
      ansi: false,
      background: { maxLogBytes: 256 },
    });
    const cwd = await tempDir();
    const job = manager.startJob(
      await bunCommand(cwd, 'console.log("x".repeat(600) + "\\nTAIL\\n\\u001b[31mRED\\u001b[0m");'),
      { cwd },
    );
    const result = await job.wait(5000);
    expect(result.job.status).toBe("exited");
    expect(result.job.log).toContain("RED");
    expect(result.job.log).not.toContain("\u001b[");
    expect(result.job.log).toContain("TAIL");
    expect(result.job.logBytes).toBeLessThanOrEqual(256);
    expect(result.job.droppedBytes).toBeGreaterThan(0);
    expect(result.job.truncated).toBe(true);
  });

  test("keeps persistent jobs after session end and stops the rest", async () => {
    const cwd = await tempDir();
    const manager = createManager({ notifications: false });
    const command = await bunCommand(cwd, idleSource);
    const persistent = manager.startJob(command, { cwd, persistent: true });
    const ephemeral = manager.startJob(command, { cwd });
    const persistentPid = persistent.snapshot().pid;
    const ephemeralPid = ephemeral.snapshot().pid;
    expect(persistentPid).not.toBeNull();
    expect(ephemeralPid).not.toBeNull();

    await manager.closeAll();
    expect(ephemeral.snapshot().status).toBe("stopped");
    if (ephemeralPid !== null) await waitForDead(ephemeralPid);
    await Bun.sleep(50);
    expect(persistent.snapshot().status).toBe("running");
    if (persistentPid !== null) {
      expect(processAlive(persistentPid)).toBe(true);
      await persistent.stop();
      await waitForDead(persistentPid);
    }
  });
});
