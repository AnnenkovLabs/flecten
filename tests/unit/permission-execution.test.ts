import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { HookRunner } from "../../src/core/hooks/runner";
import { emptyHookOutcome } from "../../src/core/hooks/types";
import { ToolCalls } from "../../src/core/loop/calls";
import { executeCalls, type ToolExecutionOptions } from "../../src/core/loop/tools";
import type { LoopEvent } from "../../src/core/loop/types";
import { ApprovalWaiters } from "../../src/core/session/approvals";
import type { Event, ToolCall, ToolResult } from "../../src/core/types";
import { PermissionEngine } from "../../src/security/permissions";
import { SandboxPolicy } from "../../src/security/sandbox";
import type { PermissionRule } from "../../src/security/types";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { defineTool, type Tool, type ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const dirs: string[] = [];
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 1000,
  readLimitLines: 2000,
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(rules: PermissionRule[], tools = builtinTools()) {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-permission-execution-"));
  dirs.push(cwd);
  const engine = new PermissionEngine({ rules });
  const calls = new ToolCalls();
  const events: (Event | LoopEvent)[] = [];
  let onEvent: (event: Event | LoopEvent) => void = () => {};
  const emit = (event: Event | LoopEvent) => {
    events.push(event);
    onEvent(event);
  };
  const waiters = new ApprovalWaiters({ emit, permissions: () => engine, timeoutMs: () => 200 });
  const context: ToolContext = {
    sessionId: "test-session",
    cwd,
    logDir: join(cwd, ".liquid/logs"),
    signal: new AbortController().signal,
    limits,
    reads: new ReadTracker(),
    permissions: engine,
    approvals: waiters.gate("test-session"),
  };
  const options: ToolExecutionOptions = {
    tools: new ToolRegistry(tools, { limits }),
    toolContext: context,
    signal: context.signal,
    parallelTools: true,
    calls,
  };
  return {
    cwd,
    engine,
    context,
    options,
    calls,
    events,
    waiters,
    listen: (listener: typeof onEvent) => {
      onEvent = listener;
    },
    run: async (input: ToolCall[]) => {
      const results: ToolResult[] = [];
      await executeCalls(input, options, emit, results);
      return results;
    },
  };
}

function builtin(name: string): Tool {
  const tool = builtinTools().find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing builtin ${name}`);
  return tool;
}

describe("guarded tool execution", () => {
  test("an execution boundary changed while approval was open is enforced before the write", async () => {
    const f = await fixture([{ action: "write", policy: "ask" }]);
    let sandbox: SandboxPolicy | undefined;
    f.context.security = () => ({ sandbox, osSandbox: undefined });
    f.listen((event) => {
      if (event.type !== "approval.requested") return;
      sandbox = new SandboxPolicy({ workspaceRoot: f.cwd, writeDenyPrefixes: ["new.txt"] });
      void f.waiters.respond(event.approval.id, "allow_once");
    });
    const result = await f.run([
      { id: "boundary", name: "write", args: { path: "new.txt", content: "must not write" } },
    ]);
    expect(result[0]?.ok).toBe(false);
    expect(result[0]?.data).toMatchObject({ kind: "sandbox" });
    expect(await Bun.file(join(f.cwd, "new.txt")).exists()).toBe(false);
  });
  test("repairs shell aliases before computing risks and never executes a denied command", async () => {
    let executed = false;
    const f = await fixture(
      [{ action: "shell", policy: "allow" }],
      [
        {
          ...builtin("bash"),
          execute: async () => {
            executed = true;
            return { ok: true, output: "should not run" };
          },
        },
      ],
    );
    f.listen((event) => {
      if (event.type === "approval.requested") void f.waiters.respond(event.approval.id, "deny");
    });
    const results = await f.run([
      { id: "alias", name: "run_command", args: { cmd: "git push --force origin main" } },
    ]);
    const approval = f.events.find((event) => event.type === "approval.requested");
    expect(approval?.type === "approval.requested" && approval.approval.target).toBe(
      "git push --force origin main",
    );
    expect(
      approval?.type === "approval.requested" && approval.approval.risks?.map((risk) => risk.id),
    ).toContain("git-push-force");
    expect(results[0]?.ok).toBe(false);
    expect(executed).toBe(false);
  });

  test("repairs path aliases before matching a deny rule", async () => {
    const f = await fixture([
      { action: "read", policy: "allow" },
      { action: "read", pathPrefix: "private", policy: "deny" },
    ]);
    const results = await f.run([
      { id: "path-alias", name: "read_file", args: { filePath: "private/secret" } },
    ]);
    expect(results[0]?.data).toMatchObject({ kind: "permission" });
    expect(f.engine.pending()).toEqual([]);
  });

  test("checks both move endpoints and every patch section before changing any file", async () => {
    const f = await fixture([
      { action: "write", policy: "allow" },
      { action: "write", pathPrefix: "private", policy: "deny" },
    ]);
    await writeFile(join(f.cwd, "source.txt"), "source");
    const result = await f.run([
      { id: "move", name: "move", args: { from: "source.txt", to: "private/moved.txt" } },
      {
        id: "patch",
        name: "apply_patch",
        args: {
          patch:
            "*** Begin Patch\n*** Add File: public.txt\n+public\n*** Add File: private/secret.txt\n+secret\n*** End Patch",
        },
      },
    ]);
    expect(result.map((entry) => entry.ok)).toEqual([false, false]);
    expect(result.every((entry) => (entry.data as { kind: string }).kind === "permission")).toBe(
      true,
    );
    expect(await readFile(join(f.cwd, "source.txt"), "utf8")).toBe("source");
    expect(await Bun.file(join(f.cwd, "public.txt")).exists()).toBe(false);
  });

  test("a permitted parallel call finishes while another call waits for approval", async () => {
    const f = await fixture([
      { action: "read", policy: "allow" },
      { action: "shell", policy: "ask" },
    ]);
    await writeFile(join(f.cwd, "file.txt"), "ready-read");
    f.listen((event) => {
      if (event.type === "tool.finished" && event.call.id === "read") {
        for (const approval of f.waiters.pending()) void f.waiters.respond(approval.id, "deny");
      }
    });
    const results = await f.run([
      { id: "waiting", name: "bash", args: { command: "echo waiting" } },
      { id: "read", name: "read", args: { path: "file.txt" } },
    ]);
    const readFinished = f.events.findIndex(
      (event) => event.type === "tool.finished" && event.call.id === "read",
    );
    const approvalFinished = f.events.findIndex((event) => event.type === "approval.resolved");
    expect(readFinished).toBeLessThan(approvalFinished);
    expect(results.map((entry) => entry.ok)).toEqual([false, true]);
    expect(results[1]?.output).toContain("ready-read");
  });

  test("tool.cancel cancels the approval wait and clears all pending state", async () => {
    const f = await fixture([{ action: "shell", policy: "ask" }]);
    let cancelled = false;
    f.listen((event) => {
      if (event.type === "approval.requested") cancelled = f.calls.cancel("cancel-me");
    });
    const results = await f.run([
      { id: "cancel-me", name: "bash", args: { command: "echo never" } },
    ]);
    expect(cancelled).toBe(true);
    expect(results[0]?.data).toMatchObject({ cancelled: true, errorKind: "aborted" });
    expect(f.engine.pending()).toEqual([]);
    expect(f.waiters.pending()).toEqual([]);
    expect(f.calls.running()).toEqual([]);
  });

  test("a permission hook sees normalized arguments and cannot leave orphaned approvals", async () => {
    const f = await fixture([{ action: "shell", policy: "ask" }]);
    let argumentsSeen: unknown;
    const hooks: HookRunner = {
      run: async (event, input) => {
        if (event !== "permission") return emptyHookOutcome();
        argumentsSeen = input.toolArgs;
        return { ...emptyHookOutcome(), blocked: true, reason: "policy hook refused" };
      },
    };
    f.options.hooks = hooks;
    const results = await f.run([{ id: "hook", name: "bash", args: { cmd: "echo normalized" } }]);
    expect(argumentsSeen).toEqual({ command: "echo normalized" });
    expect(results[0]?.error).toBe("policy hook refused");
    expect(f.engine.pending()).toEqual([]);
  });

  test("revoking a permission while approval is open prevents the approved call from executing", async () => {
    let executed = false;
    const f = await fixture(
      [{ action: "shell", policy: "ask" }],
      [
        {
          ...builtin("bash"),
          execute: async () => {
            executed = true;
            return { ok: true, output: "never" };
          },
        },
      ],
    );
    f.listen((event) => {
      if (event.type !== "approval.requested") return;
      f.engine.replaceRules({ rules: [{ action: "shell", policy: "deny" }] });
      void f.waiters.respond(event.approval.id, "allow_once");
    });
    const results = await f.run([{ id: "revoked", name: "bash", args: { command: "echo never" } }]);
    expect(executed).toBe(false);
    expect(results[0]?.data).toMatchObject({ kind: "permission" });
    expect(f.engine.pending()).toEqual([]);
  });

  test("an ask without an approval gate refuses without accumulating pending requests", async () => {
    const f = await fixture([{ action: "shell", policy: "ask" }]);
    delete f.context.approvals;
    const results = await f.run([{ id: "no-gate", name: "bash", args: { command: "echo never" } }]);
    expect(results[0]?.ok).toBe(false);
    expect(f.engine.pending()).toEqual([]);
  });

  test("arbitrary executable LSP overrides cannot inherit automatic read permission", async () => {
    const f = await fixture([
      { action: "read", policy: "allow" },
      { action: "shell", policy: "ask" },
    ]);
    f.listen((event) => {
      if (event.type === "approval.requested") void f.waiters.respond(event.approval.id, "deny");
    });
    const results = await f.run([
      {
        id: "lsp",
        name: "lsp",
        args: { operation: "diagnostics", path: "file.ts", command: "unexpected-executable" },
      },
    ]);
    expect(results[0]?.data).toMatchObject({ kind: "permission" });
    expect(f.events.some((event) => event.type === "approval.requested")).toBe(true);
  });

  test("executes exactly the frozen schema output that hooks and approvals observed", async () => {
    let executed: unknown;
    const custom = defineTool({
      name: "custom",
      description: "Verify normalized tool input",
      schema: z.object({ value: z.number().default(7) }),
      execute: async (args) => {
        executed = args;
        return { ok: true, output: String(args.value) };
      },
    });
    const f = await fixture([{ action: "read", policy: "allow" }], [custom]);
    let inspected: unknown;
    f.options.hooks = {
      run: async (event, input) => {
        if (event === "preToolUse") inspected = input.toolArgs;
        return emptyHookOutcome();
      },
    };
    const results = await f.run([{ id: "frozen", name: "custom", args: {} }]);
    expect(results[0]?.output).toBe("7");
    expect(executed).toBe(inspected);
    expect(Object.isFrozen(executed)).toBe(true);
  });

  test("a protected path inside a patch is checked by the same sandbox before prompting", async () => {
    const f = await fixture([{ action: "write", policy: "ask" }]);
    f.context.sandbox = new SandboxPolicy({ workspaceRoot: f.cwd });
    const results = await f.run([
      {
        id: "protected",
        name: "apply_patch",
        args: { patch: "*** Begin Patch\n*** Add File: .env\n+SECRET=x\n*** End Patch" },
      },
    ]);
    expect(results[0]?.data).toMatchObject({ kind: "sandbox" });
    expect(f.engine.pending()).toEqual([]);
    expect(f.events.some((event) => event.type === "approval.requested")).toBe(false);
  });
});
