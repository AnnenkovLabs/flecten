import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eventSchema } from "../../src/core/types/event-schema";
import {
  cleanupHooks,
  hook,
  hooksWith,
  httpHook,
  run,
  runner,
  serve,
  tempDir,
  waitFor,
} from "../helpers/hooks";
import { processAlive } from "../helpers/process-alive";

afterEach(cleanupHooks);

describe("hook diagnostics", () => {
  test("keeps configured identity and index after disabled and unmatched hooks", async () => {
    const cwd = await tempDir();
    const result = await run(
      hooksWith({
        preToolUse: [
          { ...hook("context"), enabled: false },
          hook("context", "write"),
          { ...hook("context"), id: "read-context", name: "Read context" },
        ],
      }),
      "preToolUse",
      { cwd, toolName: "read" },
    );
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({
      index: 2,
      id: "read-context",
      name: "Read context",
      exitCode: 0,
      blocked: false,
      timedOut: false,
      aborted: false,
    });
    expect(
      eventSchema.parse({ type: "hook.finished", sessionId: "s_test", hook: result.runs[0] }),
    ).toMatchObject({ hook: { id: "read-context", index: 2, blocked: false, exitCode: 0 } });
  });

  test("does not deliver decisions or context from a failed command", async () => {
    const cwd = await tempDir();
    const result = await run(hooksWith({ preToolUse: [hook("failed-context")] }), "preToolUse", {
      cwd,
      toolName: "read",
    });
    expect(result.blocked).toBe(false);
    expect(result.context).toEqual([]);
    expect(result.runs[0]).toMatchObject({ ok: false, exitCode: 1 });
    expect(result.runs[0]?.decision).toBeUndefined();
  });

  test("redacts configured values before output previews are truncated", async () => {
    const cwd = await tempDir();
    const secret = "configured-credential-that-is-not-a-known-token-format";
    const url = serve(() =>
      Response.json({ additionalContext: `${"x".repeat(3960)}${secret}${"y".repeat(100)}` }),
    );
    const result = await run(
      hooksWith({ preToolUse: [httpHook(url, { headers: { "x-custom-key": secret } })] }),
      "preToolUse",
      { cwd, toolName: "read" },
    );
    expect(result.context[0]).toContain("[redacted]");
    expect(result.runs[0]?.output).not.toContain(secret.slice(0, 8));
    expect(result.runs[0]?.outputTruncated).toBe(true);
  });
});

describe("hook conditions", () => {
  test("distinguishes exact commands from command prefixes", async () => {
    const cwd = await tempDir();
    const result = await run(
      hooksWith({
        preToolUse: [
          hook("context", { command: "git status" }),
          hook("context", { commandPrefix: "git status" }),
        ],
      }),
      "preToolUse",
      { cwd, toolName: "bash", toolArgs: { command: "git status --short" } },
    );
    expect(result.runs.map((entry) => entry.index)).toEqual([1]);
  });

  test("does not match a tool-specific hook when the event has no tool", async () => {
    const cwd = await tempDir();
    const result = await run(hooksWith({ sessionStart: [hook("deny", "bash")] }), "sessionStart", {
      cwd,
    });
    expect(result.runs).toEqual([]);
    expect(result.blocked).toBe(false);
  });

  test("matches permission commands through their typed shell action", async () => {
    const cwd = await tempDir();
    const result = await run(
      hooksWith({ permission: [hook("deny", { tool: "bash", commandPrefix: "git push" })] }),
      "permission",
      {
        cwd,
        permission: { action: "shell", policy: "ask", tool: "bash", target: "git push origin" },
      },
    );
    expect(result.blocked).toBe(true);
  });

  test("matches every condition against the same tool in a batch", async () => {
    const cwd = await tempDir();
    const result = await run(
      hooksWith({
        toolBatch: [
          hook("context", { tool: "read", path: "src/a.ts" }),
          hook("deny", { tool: "write", path: "src/a.ts" }),
        ],
      }),
      "toolBatch",
      {
        cwd,
        toolBatch: {
          tools: [
            { name: "read", args: { path: "src/a.ts" } },
            { name: "write", args: { path: "src/b.ts" } },
          ],
          parallel: true,
        },
      },
    );
    expect(result.blocked).toBe(false);
    expect(result.runs.map((entry) => entry.index)).toEqual([0]);
  });
});

describe("hook execution limits", () => {
  test("fails closed for oversized HTTP and command responses, even with a valid JSON prefix", async () => {
    const cwd = await tempDir();
    const url = serve(() => new Response(`{"decision":"allow"}${" ".repeat(70_000)}`));
    for (const definition of [httpHook(url), hook("overflow")]) {
      const result = await run(hooksWith({ preToolUse: [definition] }, true), "preToolUse", {
        cwd,
        toolName: "read",
      });
      expect(result.blocked).toBe(true);
      expect(result.context).toEqual([]);
      expect(result.runs[0]).toMatchObject({ ok: false, outputTruncated: true });
      expect(result.runs[0]?.error).toContain("output exceeds");
    }
  });

  test("cancels a running command and records its cancellation", async () => {
    const cwd = await tempDir();
    const mark = join(cwd, "started");
    process.env.FLECTEN_HOOK_MARK = mark;
    const controller = new AbortController();
    const work = runner(hooksWith({ preToolUse: [hook("mark-timeout")] })).run(
      "preToolUse",
      { sessionId: "s_test", cwd, toolName: "read" },
      controller.signal,
    );
    await waitFor(() => Bun.file(mark).exists());
    controller.abort();
    const result = await work;
    expect(result.runs[0]).toMatchObject({ ok: false, aborted: true, error: "hook aborted" });
  });

  test.skipIf(process.platform !== "linux" || !Bun.which("setsid"))(
    "reaps detached descendants when a hook exits before them",
    async () => {
      const cwd = await tempDir();
      const mark = join(cwd, "child.pid");
      process.env.FLECTEN_HOOK_MARK = mark;
      const result = await run(
        hooksWith({ preToolUse: [hook("orphan", "*", 500)] }),
        "preToolUse",
        {
          cwd,
          toolName: "read",
        },
      );
      const childPid = Number(await readFile(mark, "utf8"));
      try {
        expect(result.runs[0]).toMatchObject({ ok: true, timedOut: false });
        await waitFor(() => !processAlive(childPid));
      } finally {
        if (processAlive(childPid)) process.kill(childPid, "SIGKILL");
      }
    },
  );
});

test("subagent completion is an observer and cannot report a completed action as blocked", async () => {
  const cwd = await tempDir();
  const url = serve(() => Response.json({ decision: "deny", reason: "Too late to deny" }));
  const outcome = await run(hooksWith({ subagent: [httpHook(url)] }), "subagent", {
    cwd,
    subagent: { agent: "scout", phase: "stop", ok: true, output: "Finished" },
  });
  expect(outcome).toMatchObject({
    blocked: false,
    runs: [{ ok: true, blocked: false, decision: "deny" }],
  });
});

test("cancelling a queued dispatch stops waiting for the event mutex", async () => {
  const cwd = await tempDir();
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = false;
  let requests = 0;
  const url = serve(async () => {
    requests++;
    entered = true;
    await held;
    return Response.json({});
  });
  const hooks = runner(hooksWith({ preToolUse: [httpHook(url)] }));
  const input = { sessionId: "s_cancel", cwd, toolName: "read" };
  const first = hooks.run("preToolUse", input, new AbortController().signal);
  await waitFor(() => entered);
  try {
    expect(await hooks.run("preToolUse", input, AbortSignal.timeout(25))).toMatchObject({
      runs: [{ ok: false, aborted: true }],
    });
  } finally {
    release();
    await first;
  }
  expect(requests).toBe(1);
});
