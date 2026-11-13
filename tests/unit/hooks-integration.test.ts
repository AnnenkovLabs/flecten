import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { HookRun } from "../../src/core/hooks/types";
import type { Event } from "../../src/core/types";
import type { Tool } from "../../src/tools/types";
import { scriptedProvider } from "../helpers/fake-provider";
import {
  buildSession,
  cleanupHooks,
  endpoint,
  hook,
  hooksWith,
  httpHook,
  loggedEvents,
  run,
  serve,
  tempDir,
  waitFor,
} from "../helpers/hooks";

afterEach(cleanupHooks);

describe("HTTP hooks", () => {
  test("posts typed input and accepts a valid response", async () => {
    const cwd = await tempDir();
    const requests: Array<Record<string, unknown>> = [];
    const base = serve(async (request) => {
      requests.push((await request.json()) as Record<string, unknown>);
      return Response.json({ decision: "allow", additionalContext: "http context" });
    });
    const result = await run(
      hooksWith({ permission: [httpHook(endpoint(base, "hook"))] }),
      "permission",
      { cwd, permission: { action: "write", policy: "ask", target: "a.txt" } },
    );

    expect(result.context).toEqual(["http context"]);
    expect(result.runs[0]).toMatchObject({ event: "permission", ok: true, decision: "allow" });
    expect(requests[0]).toMatchObject({
      event: "permission",
      permission: { action: "write", policy: "ask" },
    });
  });

  test("treats HTTP failure and bad schema as visible failures", async () => {
    const cwd = await tempDir();
    const failed = serve(() => new Response("boom", { status: 503 }));
    const bad = serve(() => Response.json({ decision: "maybe" }));

    const lenient = await run(
      hooksWith({ preToolUse: [httpHook(endpoint(failed, "hook"))] }),
      "preToolUse",
      { cwd, toolName: "bash" },
    );
    expect(lenient.runs[0]?.error).toBe("hook HTTP 503");

    const strict = await run(
      hooksWith({ preToolUse: [httpHook(endpoint(failed, "hook"))] }, true),
      "preToolUse",
      { cwd, toolName: "bash" },
    );
    expect(strict.blocked).toBe(true);
    expect(strict.reason).toContain("failed closed");

    const schema = await run(
      hooksWith({ preToolUse: [httpHook(endpoint(bad, "hook"))] }),
      "preToolUse",
      { cwd, toolName: "read" },
    );
    expect(schema.runs[0]?.error).toContain("invalid hook response");
  });

  test("enforces the timeout on HTTP hooks", async () => {
    const cwd = await tempDir();
    const base = serve(async () => {
      await Bun.sleep(500);
      return Response.json({ decision: "allow" });
    });
    const result = await run(
      hooksWith({ preToolUse: [httpHook(endpoint(base, "hook"), { timeoutMs: 100 })] }),
      "preToolUse",
      { cwd, toolName: "read" },
    );
    expect(result.blocked).toBe(false);
    expect(result.runs[0]?.error).toBe("hook timed out");
  });

  test("rejects a request over the size limit before sending it", async () => {
    const cwd = await tempDir();
    let calls = 0;
    const base = serve(() => {
      calls += 1;
      return Response.json({ decision: "allow" });
    });
    const result = await run(
      hooksWith({ preToolUse: [httpHook(endpoint(base, "hook"))] }, true),
      "preToolUse",
      { cwd, toolName: "bash", toolOutput: "x".repeat(70_000) },
    );
    expect(result.blocked).toBe(true);
    expect(result.runs[0]?.error).toContain("request exceeds");
    expect(calls).toBe(0);
  });
});

describe("async hooks", () => {
  test("fires and forgets a non-blocking hook", async () => {
    const cwd = await tempDir();
    const mark = join(cwd, "markers.txt");
    process.env.FLECTEN_HOOK_MARK = mark;
    const seen: HookRun[] = [];
    const started = performance.now();
    const result = await run(
      hooksWith({ postToolUse: [{ ...hook("slow-mark"), async: true }] }),
      "postToolUse",
      { cwd, toolName: "read", toolOk: true },
      { onRun: (completed) => seen.push(completed) },
    );
    expect(result.runs).toHaveLength(0);
    expect(performance.now() - started).toBeLessThan(300);
    await waitFor(async () => {
      const text = await readFile(mark, "utf8").catch(() => "");
      return text.includes("hook:postToolUse:read");
    });
    await waitFor(() => seen.length === 1);
    expect(seen[0]).toMatchObject({ event: "postToolUse", ok: true, async: true });
  });

  test("does not fire and forget a blocking event", async () => {
    const cwd = await tempDir();
    const result = await run(
      hooksWith({ preToolUse: [{ ...hook("deny"), async: true }] }),
      "preToolUse",
      { cwd, toolName: "bash" },
    );
    expect(result.blocked).toBe(true);
    expect(result.runs).toHaveLength(1);
  });
});

function markerTool(name: string, path: string): Tool {
  return {
    name,
    description: `${name} marker`,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    schema: z.object({}).strict(),
    mutating: true,
    async execute() {
      await appendFile(path, `tool:${name}\n`);
      await Bun.sleep(10);
      return { ok: true, output: name };
    },
  };
}

describe("session hooks", () => {
  test("runs every preToolUse hook before its corresponding parallel tool", async () => {
    const cwd = await tempDir();
    const mark = join(cwd, "markers.txt");
    process.env.FLECTEN_HOOK_MARK = mark;
    process.env.FLECTEN_HOOK_LOG = join(cwd, "hooks.jsonl");
    const provider = scriptedProvider([
      [
        { type: "tool_call", id: "call-a", name: "alpha", args: {} },
        { type: "tool_call", id: "call-b", name: "beta", args: {} },
        { type: "done", reason: "tool_use" },
      ],
      [
        { type: "text", delta: "done" },
        { type: "done", reason: "end" },
      ],
    ]);
    const session = buildSession(
      provider,
      cwd,
      hooksWith({ preToolUse: [hook("mark"), hook("mark")] }),
      [markerTool("alpha", mark), markerTool("beta", mark)],
    );

    await session.send({ type: "run", prompt: "run both" });
    const lines = (await readFile(mark, "utf8")).trim().split("\n");
    for (const name of ["alpha", "beta"]) {
      const toolIndex = lines.indexOf(`tool:${name}`);
      expect(toolIndex).toBeGreaterThanOrEqual(2);
      expect(
        lines.slice(0, toolIndex).filter((line) => line === `hook:preToolUse:${name}`),
      ).toHaveLength(2);
    }
    expect(lines.filter((line) => line.startsWith("tool:")).sort()).toEqual([
      "tool:alpha",
      "tool:beta",
    ]);
  }, 20_000);

  test("adds context, blocks a tool and runs stop and sessionEnd", async () => {
    const cwd = await tempDir();
    const log = join(cwd, "hooks.jsonl");
    process.env.FLECTEN_HOOK_LOG = log;
    const marker = join(cwd, "should-not-exist");
    const provider = scriptedProvider([
      [
        { type: "tool_call", id: "call-1", name: "bash", args: { command: `touch ${marker}` } },
        { type: "done", reason: "tool_use" },
      ],
      [
        { type: "text", delta: "stopped" },
        { type: "done", reason: "end" },
      ],
    ]);
    const hooks = hooksWith({
      sessionStart: [hook(), hook("context")],
      userPromptSubmit: [hook()],
      preToolUse: [hook(), hook("deny", "bash")],
      stop: [hook()],
      sessionEnd: [hook()],
    });
    const session = buildSession(provider, cwd, hooks);
    const events: Event[] = [];
    session.subscribe((event) => events.push(event));

    const result = (await session.send({ type: "run", prompt: "block the write" })) as {
      stopReason: string;
    };
    expect(result.stopReason).toBe("end");
    expect(await Bun.file(marker).exists()).toBe(false);
    expect(provider.requests[0]?.messages[0]?.content).toContain("context from sessionStart");
    expect(provider.requests[0]?.messages[0]?.content).toContain(
      "## Hook context\n\n- Source: `configured hook`",
    );
    const toolMessage = provider.requests[1]?.messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("Blocked by hook");
    expect(events.filter((event) => event.type === "hook.finished").length).toBeGreaterThan(4);
    expect(await loggedEvents(log)).toEqual([
      "sessionStart",
      "sessionStart",
      "userPromptSubmit",
      "preToolUse",
      "preToolUse",
      "stop",
      "sessionEnd",
    ]);
  }, 20_000);

  test("appends postToolUse context to the tool result", async () => {
    const cwd = await tempDir();
    process.env.FLECTEN_HOOK_LOG = join(cwd, "hooks.jsonl");
    await writeFile(join(cwd, "a.txt"), "hello\n");
    const provider = scriptedProvider([
      [
        { type: "tool_call", id: "call-1", name: "read", args: { path: "a.txt" } },
        { type: "done", reason: "tool_use" },
      ],
      [
        { type: "text", delta: "read" },
        { type: "done", reason: "end" },
      ],
    ]);
    const session = buildSession(provider, cwd, hooksWith({ postToolUse: [hook("context")] }));

    await session.send({ type: "run", prompt: "read a.txt" });
    const toolMessage = provider.requests[1]?.messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("hello");
    expect(toolMessage?.content).toContain("context from postToolUse");
    expect(toolMessage?.content).toContain("## Hook context");
  });

  test("blocks a prompt before the provider is called and still ends the session", async () => {
    const cwd = await tempDir();
    const log = join(cwd, "hooks.jsonl");
    process.env.FLECTEN_HOOK_LOG = log;
    const provider = scriptedProvider([]);
    const session = buildSession(
      provider,
      cwd,
      hooksWith({ userPromptSubmit: [hook("deny")], sessionEnd: [hook()] }),
    );
    const events: Event[] = [];
    session.subscribe((event) => events.push(event));

    const result = (await session.send({ type: "run", prompt: "nope" })) as {
      stopReason: string;
      summary: string;
    };
    expect(result.stopReason).toBe("error");
    expect(result.summary).toContain("Prompt blocked by hook");
    expect(provider.requests).toHaveLength(0);
    expect(events.some((event) => event.type === "error")).toBe(true);
    expect(await loggedEvents(log)).toEqual(["userPromptSubmit", "sessionEnd"]);
  });
});
