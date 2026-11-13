import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createSession } from "../../src/core/session/session";
import type { Event, RunResult } from "../../src/core/types";
import type { ModelProvider, ModelRequest } from "../../src/providers/types";
import { PermissionEngine } from "../../src/security/permissions";
import { replayMessages } from "../../src/store/events/replay";
import { ToolRegistry } from "../../src/tools/registry";
import { defineTool, type Tool } from "../../src/tools/types";
import { scriptedProvider } from "../helpers/fake-provider";

const limits = {
  maxOutputBytes: 50000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10000,
  readLimitLines: 2000,
};
async function fixture(
  provider: ModelProvider,
  tools: Tool[] = [],
  permissions?: PermissionEngine,
) {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-stop-"));
  const events: Event[] = [];
  const session = createSession({
    cwd,
    provider,
    providerId: provider.id,
    model: provider.model,
    system: "test",
    limits,
    tools: new ToolRegistry(tools, { limits }),
    maxOutputTokens: 1000,
    context: { window: 100000, reserve: 1000 },
    loop: { maxTurns: 4, continuations: 0, parallelTools: false },
    logDir: () => join(cwd, "logs"),
    ...(permissions ? { permissions } : {}),
  });
  session.subscribe((event) => events.push(event));
  return {
    session,
    events,
    async close() {
      await session.dispose();
      await rm(cwd, { recursive: true, force: true });
    },
  };
}

function eventGate(session: ReturnType<typeof createSession>, type: Event["type"]) {
  const gate = Promise.withResolvers<void>();
  const off = session.subscribe((event) => {
    if (event.type === type) {
      off();
      gate.resolve();
    }
  });
  return gate.promise;
}

test("graceful stop finishes reasoning, preserves provider data, closes unstarted calls and holds the queue", async () => {
  const release = Promise.withResolvers<void>();
  const requests: ModelRequest[] = [];
  let signal: AbortSignal | undefined;
  const provider: ModelProvider = {
    id: "test",
    model: "test",
    async *stream(request, nextSignal) {
      requests.push(structuredClone(request));
      signal = nextSignal;
      if (requests.length === 1) {
        yield { type: "reasoning", delta: "first " };
        await release.promise;
        yield { type: "reasoning", delta: "complete" };
        yield { type: "provider_data", data: { signature: "complete-signature" } };
        yield { type: "tool_call", id: "c1", name: "work", args: {} };
        yield { type: "done", reason: "tool_use" };
      } else {
        yield { type: "text", delta: "resumed" };
        yield { type: "done", reason: "end" };
      }
    },
  };
  let calls = 0;
  const tool = defineTool({
    name: "work",
    description: "test",
    schema: z.object({}),
    async execute() {
      calls += 1;
      return { ok: true, output: "ran" };
    },
  });
  const h = await fixture(provider, [tool]);
  try {
    const thinking = eventGate(h.session, "reasoning.delta");
    const running = h.session.send({ type: "run", prompt: "first" });
    await thinking;
    await h.session.send({ type: "queue.add", id: "q1", text: "queued" });
    await h.session.send({ type: "stop", mode: "graceful" });
    expect(signal?.aborted).toBe(false);
    expect(h.session.peek().state).toMatchObject({ running: true, stopRequested: true });
    release.resolve();
    const result = (await running) as RunResult;
    expect(result).toMatchObject({ stopReason: "stopped" });
    expect(
      replayMessages(h.events.map((event, index) => ({ event, seq: index + 1 }))).messages,
    ).toEqual([...h.session.getHistory()]);
    expect(calls).toBe(0);
    expect(requests).toHaveLength(1);
    expect(h.session.peek().state?.queue.map((item) => item.text)).toEqual(["queued"]);
    await h.session.send({ type: "queue.remove", id: "q1" });
    await h.session.send({ type: "run", prompt: "  next\nraw  ", sessionId: result.sessionId });
    expect(requests[1]?.messages).toEqual([
      { role: "user", content: "first", memorySource: "first" },
      {
        role: "assistant",
        content: "",
        reasoning: "first complete",
        toolCalls: [{ id: "c1", name: "work", args: {} }],
        providerData: { signature: "complete-signature" },
      },
      expect.objectContaining({ role: "tool", toolCallId: "c1", isError: true }),
      { role: "user", content: "  next\nraw  ", memorySource: "  next\nraw  " },
    ]);
    expect(h.session.peek().state).toMatchObject({ running: false, stopRequested: false });
  } finally {
    release.resolve();
    await h.close();
  }
});

test("graceful stop lets a running command finish and skips the next command", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const signals: AbortSignal[] = [];
  const tool = defineTool({
    name: "work",
    description: "test",
    schema: z.object({}),
    async execute(_args, context) {
      signals.push(context.signal);
      started.resolve();
      await release.promise;
      return { ok: true, output: "complete output" };
    },
  });
  const provider = scriptedProvider([
    [
      { type: "tool_call", id: "c1", name: "work", args: {} },
      { type: "tool_call", id: "c2", name: "work", args: {} },
      { type: "done", reason: "tool_use" },
    ],
  ]);
  const h = await fixture(provider, [tool]);
  try {
    const running = h.session.send({ type: "run", prompt: "work" });
    await started.promise;
    await h.session.send({ type: "stop", mode: "graceful" });
    expect(signals[0]?.aborted).toBe(false);
    release.resolve();
    expect(await running).toMatchObject({ stopReason: "stopped" });
    expect(signals).toHaveLength(1);
    expect(h.session.getHistory().filter((item) => item.role === "tool")).toEqual([
      expect.objectContaining({
        toolCallId: "c1",
        content: expect.stringContaining("complete output"),
      }),
      expect.objectContaining({ toolCallId: "c2", isError: true }),
    ]);
    expect(provider.requests).toHaveLength(1);
  } finally {
    release.resolve();
    await h.close();
  }
});

test("a second force stop aborts an in-flight provider request", async () => {
  let signal: AbortSignal | undefined;
  const provider: ModelProvider = {
    id: "test",
    model: "test",
    async *stream(_request, nextSignal) {
      signal = nextSignal;
      yield { type: "reasoning", delta: "thinking" };
      await new Promise<void>((_resolve, reject) => {
        const abort = () => reject(new Error("aborted"));
        nextSignal.addEventListener("abort", abort, { once: true });
        if (nextSignal.aborted) abort();
      });
    },
  };
  const h = await fixture(provider);
  try {
    const thinking = eventGate(h.session, "reasoning.delta");
    const running = h.session.send({ type: "run", prompt: "work" });
    await thinking;
    await h.session.send({ type: "stop", mode: "graceful" });
    expect(signal?.aborted).toBe(false);
    await h.session.send({ type: "stop", mode: "force" });
    expect(signal?.aborted).toBe(true);
    expect(((await running) as RunResult).stopReason).toBe("stopped");
  } finally {
    await h.close();
  }
});

test("graceful stop resolves a pending approval without executing its command", async () => {
  let calls = 0;
  const tool = defineTool({
    name: "bash",
    description: "test",
    schema: z.object({ command: z.string() }),
    async execute() {
      calls += 1;
      return { ok: true, output: "ran" };
    },
  });
  const provider = scriptedProvider([
    [
      { type: "tool_call", id: "c1", name: "bash", args: { command: "echo test" } },
      { type: "done", reason: "tool_use" },
    ],
  ]);
  const h = await fixture(
    provider,
    [tool],
    new PermissionEngine({ rules: [{ action: "shell", tool: "bash", policy: "ask" }] }),
  );
  try {
    const approval = eventGate(h.session, "approval.requested");
    const running = h.session.send({ type: "run", prompt: "work" });
    await approval;
    await h.session.send({ type: "stop", mode: "graceful" });
    expect(await running).toMatchObject({ stopReason: "stopped" });
    expect(calls).toBe(0);
    expect(h.session.peek().state?.approvals).toEqual([]);
    expect(h.session.getHistory().at(-1)).toMatchObject({
      role: "tool",
      toolCallId: "c1",
      isError: true,
    });
  } finally {
    await h.close();
  }
});
