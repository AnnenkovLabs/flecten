import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { requestProjectTrust } from "../../src/app/project-trust";
import { executeCalls } from "../../src/core/loop/tools";
import { ApprovalWaiters } from "../../src/core/session/approvals";
import type { Event, ToolResult } from "../../src/core/types";
import { PermissionEngine } from "../../src/security/permissions";
import { ToolRegistry } from "../../src/tools/registry";
import { defineTool, type Tool, type ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 1000,
  readLimitLines: 2000,
};
const budget = 80;

function tool(name: string, execute: Tool["execute"], source: "module" | "mcp" = "module") {
  return defineTool({
    name,
    description: name,
    source,
    schema: z.object({}),
    mutating: true,
    timeoutMs: () => budget,
    execute,
  });
}
function gateway(name: string, child: Tool) {
  return tool(name, async (_args, context) => {
    if (!context.invokeTool) throw new Error("Missing guarded executor");
    return context.invokeTool(child, {}, context);
  });
}
async function fixture(
  entry: Tool,
  onApproval?: (
    event: Extract<Event, { type: "approval.requested" }>,
    waiters: ApprovalWaiters,
  ) => void,
) {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-approval-deadline-"));
  dirs.push(cwd);
  const engine = new PermissionEngine({ rules: [{ action: "mcp", policy: "ask" }] });
  const controller = new AbortController();
  const events: Event[] = [];
  const requested = Promise.withResolvers<void>();
  const waiters = new ApprovalWaiters({
    permissions: () => engine,
    timeoutMs: () => budget * 3,
    emit(event) {
      events.push(event);
      if (event.type === "approval.requested") {
        requested.resolve();
        onApproval?.(event, waiters);
      }
    },
  });
  const context: ToolContext = {
    cwd,
    logDir: join(cwd, "logs"),
    sessionId: "timeout-test",
    signal: controller.signal,
    limits,
    reads: new ReadTracker(),
    permissions: engine,
    approvals: waiters.gate("timeout-test"),
  };
  const results: ToolResult[] = [];
  const running = executeCalls(
    [{ id: "entry", name: entry.name, args: {} }],
    {
      tools: new ToolRegistry([entry], { limits }),
      toolContext: context,
      signal: controller.signal,
      parallelTools: false,
    },
    () => {},
    results,
  ).then(() => results[0]);
  return { running, events, controller, requested: requested.promise };
}

test("nested approval timeout retains the permission outcome beyond every enclosing execution budget", async () => {
  let executions = 0;
  const leaf = tool(
    "desktop_start",
    async () => {
      executions++;
      return { ok: true, output: "started" };
    },
    "mcp",
  );
  const f = await fixture(gateway("module", gateway("capability", leaf)));
  expect(await f.running).toMatchObject({
    ok: false,
    data: { kind: "permission", outcome: "timeout" },
  });
  expect(executions).toBe(0);
  expect(f.events).toContainEqual(
    expect.objectContaining({ type: "approval.resolved", by: "timeout" }),
  );
});

test("approval acceptance resumes the remaining execution budget instead of expiring immediately", async () => {
  const leaf = tool("desktop_start", async () => ({ ok: true, output: "started" }), "mcp");
  const f = await fixture(gateway("module", leaf), (event, waiters) => {
    setTimeout(() => {
      void waiters.respond(event.approval.id, "allow_once");
    }, budget * 2);
  });
  expect(await f.running).toMatchObject({ ok: true, output: "started" });
});

test("overlapping nested approval waits keep the enclosing execution clock paused until both settle", async () => {
  const leaf = tool("desktop_start", async () => ({ ok: true, output: "started" }), "mcp");
  const entry = tool("module", async (_args, context) => {
    if (!context.invokeTool) throw new Error("Missing guarded executor");
    const results = await Promise.all([
      context.invokeTool(leaf, {}, context),
      context.invokeTool(leaf, {}, context),
    ]);
    return {
      ok: results.every((result) => result.ok),
      output: results.map((result) => result.output).join(","),
    };
  });
  let requests = 0;
  const f = await fixture(entry, (event, waiters) => {
    const delay = requests++ === 0 ? budget / 2 : budget * 2;
    setTimeout(() => {
      void waiters.respond(event.approval.id, "allow_once");
    }, delay);
  });
  expect(await f.running).toMatchObject({ ok: true, output: "started,started" });
});

test("stopping while a nested permission is pending still cancels immediately", async () => {
  const leaf = tool("desktop_start", async () => ({ ok: true, output: "must not execute" }), "mcp");
  const f = await fixture(gateway("module", leaf));
  await f.requested;
  f.controller.abort();
  expect(await f.running).toMatchObject({ ok: false, data: { errorKind: "aborted" } });
  expect(f.events).toContainEqual(
    expect.objectContaining({ type: "approval.resolved", by: "aborted" }),
  );
});

test("genuine execution hang after approval still times out and aborts the nested operation", async () => {
  let signal: AbortSignal | undefined;
  const leaf = tool(
    "desktop_start",
    async (_args, context) => {
      signal = context.signal;
      await new Promise(() => {});
      return { ok: true, output: "unreachable" };
    },
    "mcp",
  );
  const f = await fixture(gateway("module", leaf), (event, waiters) => {
    setTimeout(() => {
      void waiters.respond(event.approval.id, "allow_once");
    }, budget * 2);
  });
  expect(await f.running).toMatchObject({ ok: false, data: { errorKind: "timeout" } });
  expect(signal?.aborted).toBe(true);
});

test("module activation project trust keeps its permission timeout instead of a tool timeout", async () => {
  let accepted = false;
  const entry = tool("module", async (_args, context) => {
    await requestProjectTrust(
      context,
      () => accepted,
      async () => {
        accepted = true;
      },
    );
    return { ok: true, output: "active" };
  });
  const f = await fixture(entry);
  expect(await f.running).toMatchObject({ ok: false, data: { errorKind: "permission" } });
  expect(accepted).toBe(false);
  expect(f.events).toContainEqual(
    expect.objectContaining({ type: "approval.resolved", by: "timeout" }),
  );
});
