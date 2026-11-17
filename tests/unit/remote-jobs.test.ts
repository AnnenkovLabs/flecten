import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalManager } from "../../src/terminal/manager";
import { runBash } from "../../src/tools/bash/run";
import { runJobs as productionRunJobs } from "../../src/tools/jobs/run";
import { jobsSpec } from "../../src/tools/jobs/schema";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const runJobs = (args: Parameters<typeof productionRunJobs>[0], context: ToolContext) =>
  productionRunJobs(args, context, async (_target, current) => ({
    ok: true,
    context: current,
    arguments: [],
  }));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test.skipIf(process.platform !== "linux" || !Bun.which("python3"))(
  "remote submit detaches pipes, preserves a handle after response loss and does not start twice",
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-remote-jobs-"));
    dirs.push(cwd);
    const fake = join(cwd, "ssh");
    await Bun.write(
      fake,
      "#!/usr/bin/env python3\nimport os,sys\nos.environ.pop('FLECTEN_PROCESS_SCOPE',None)\nos.execv('/bin/bash',['bash','-c',sys.argv[-1]])\n",
    );
    await Bun.$`chmod 700 ${fake}`.quiet();
    const signal = new AbortController().signal;
    const terminals = new TerminalManager();
    const context: ToolContext = {
      cwd,
      signal,
      sessionId: "s_fixture",
      logDir: join(cwd, "logs"),
      reads: new ReadTracker(),
      terminals,
      limits: {
        maxOutputBytes: 100000,
        maxOutputLines: 2000,
        bashTimeoutMs: 5000,
        readLimitLines: 100,
      },
      invokeTool: async (_tool, value) => {
        const command = (value as { command: string }).command;
        return runBash(
          { command, timeoutMs: 5000 },
          {
            cwd,
            signal,
            limits: { bashTimeoutMs: 5000 },
            env: { PATH: `${cwd}:${process.env.PATH}` },
          },
        );
      },
    };
    const id = `remote-${crypto.randomUUID()}`;
    const args = jobsSpec.schema.parse({
      op: "submit",
      id,
      remote: { host: "fixture", cwd },
      argv: [
        "python3",
        "-c",
        "import time,pathlib; p=pathlib.Path('count'); p.write_text(p.read_text()+'x' if p.exists() else 'x'); print('ready',flush=True); time.sleep(.2)",
      ],
    });
    const started = performance.now();
    const submit = await runJobs(args, {
      ...context,
      invokeTool: async (tool, value) => {
        const result = await context.invokeTool?.(tool, value);
        expect(result?.ok).toBe(true);
        return { ok: false, output: "", error: "connection lost after submit" };
      },
    });
    expect(submit.ok).toBe(false);
    expect(submit.output).toContain(id);
    expect(performance.now() - started).toBeLessThan(2000);
    const reconnect = { ...context };
    const duplicate = await runJobs(args, reconnect);
    expect(duplicate.ok).toBe(true);
    const done = await runJobs({ op: "wait", id, timeoutMs: 3000 }, reconnect);
    expect(done.ok).toBe(true);
    expect(done.output).toContain("exited, exit 0");
    expect(await Bun.file(join(cwd, "count")).text()).toBe("x");
    const output = await runJobs({ op: "output", id }, reconnect);
    expect(output.output).toContain("ready");
    expect((await runJobs({ op: "list" }, reconnect)).output).toContain(id);
    const denied = await runJobs(
      { op: "status", id },
      {
        ...context,
        invokeTool: async () => ({ ok: false, output: "", error: "permission denied" }),
      },
    );
    expect(denied.ok).toBe(false);
    expect(denied.output).toContain("Reconcile");
    const failure = await runJobs(
      jobsSpec.schema.parse({
        op: "submit",
        remote: { host: "fixture", cwd },
        argv: ["python3", "-c", "import sys; sys.exit(7)"],
      }),
      context,
    );
    const failedId = (failure.data as { job: { id: string } }).job.id;
    const failed = await runJobs({ op: "wait", id: failedId, timeoutMs: 3000 }, context);
    expect(failed.ok).toBe(false);
    expect(failed.output).toContain("failed, exit 7");
    await terminals.closeAll();
  },
);
