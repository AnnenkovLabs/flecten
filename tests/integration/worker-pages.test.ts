import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conversationOptions } from "../../src/app/conversation-options";
import { HarnessConfigSchema } from "../../src/config/schema";
import { type CompactionRequest, compactContextIfNeeded } from "../../src/core/loop/context";
import { runLoop } from "../../src/core/loop/loop";
import type { LoopEvent, LoopOptions } from "../../src/core/loop/types";
import { PageRuntime } from "../../src/core/pages/runtime";
import { PageWriter } from "../../src/core/pages/writer";
import { createSession } from "../../src/core/session/session";
import type { Event, Message, ToolCall } from "../../src/core/types";
import type { ModelEvent, ModelProvider, ModelRequest } from "../../src/providers/types";
import { replayMessages } from "../../src/store/events/replay";
import { pageSink } from "../../src/store/pages";
import { sessionPaths } from "../../src/store/paths";
import { builtinTools } from "../../src/tools/builtin";
import { contextTool } from "../../src/tools/context/run";
import { ToolRegistry } from "../../src/tools/registry";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};
const fields = {
  progress: "Completed one logical block",
  locations: "auth.txt",
  instructions: "Preserve the requested API",
  nextSteps: "Continue the next requested block",
  risks: "none recorded",
};
const end = (text: string): ModelEvent[] => [
  { type: "text", delta: text },
  { type: "done", reason: "end" },
];
const call = (id: string, name: string, args: unknown): ModelEvent[] => [
  { type: "tool_call", id, name, args },
  { type: "done", reason: "tool_use" },
];
const begin = (title: string) => ({ op: "begin", title, objective: `Implement ${title} only.` });
const complete = {
  op: "complete",
  summary: "Verified",
  evidence: ["File saved"],
  next: "Next block",
};

async function fixture(scripts: ModelEvent[][]) {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-worker-pages-"));
  directories.push(cwd);
  const requests: ModelRequest[] = [];
  let index = 0;
  const provider: ModelProvider = {
    id: "pages-test",
    model: "pages-test",
    async *stream(request) {
      requests.push(structuredClone(request));
      const script =
        request.tools.length === 0
          ? end(JSON.stringify(fields))
          : (scripts[index++] ?? end("<summary>Finished.</summary>"));
      for (const event of script) yield event;
    },
  };
  const tools = new ToolRegistry([...builtinTools(), contextTool], { limits });
  const paths = sessionPaths(cwd, "s_worker");
  const options: LoopOptions = {
    role: "worker",
    provider,
    tools,
    system: "Worker page test",
    maxTurns: 20,
    maxTokens: 2000,
    contextWindow: 100_000,
    reserveTokens: 2000,
    continuations: 0,
    parallelTools: true,
    signal: new AbortController().signal,
    emit: () => {},
    toolContext: {
      cwd,
      logDir: paths.logs,
      sessionId: "s_worker",
      limits,
      reads: new ReadTracker(),
    },
    pageWriter: new PageWriter({
      provider,
      maxOutputTokens: 2000,
      contextWindow: 100_000,
      sink: pageSink(paths),
    }),
  };
  return { cwd, requests, provider, tools, paths, options };
}

test("Worker checkpoints small logical pages before the next request and retrieves earlier details after replay", async () => {
  const detail = "ORBIT_DETAIL_61927";
  const f = await fixture([
    call("premature", "write", { path: "forbidden.txt", content: "must not execute" }),
    call("begin-auth", "context", begin("Login and Registration")),
    call("auth", "write", { path: "auth.txt", content: detail }),
    end("<summary>Premature task completion.</summary>"),
    call("complete-auth", "context", complete),
    call("find-auth", "context", { op: "search", query: detail }),
    call("read-auth", "context", { op: "read", page: 1, kind: "transcript", limit: 100 }),
    call("begin-shell", "context", begin("Dashboard shell")),
    call("shell", "write", { path: "shell.txt", content: "Dashboard shell without sections" }),
    call("complete-shell", "context", complete),
    end("<summary>Both requested blocks verified.</summary>"),
  ]);
  const events: Event[] = [];
  const session = createSession({
    cwd: f.cwd,
    role: "worker",
    provider: f.provider,
    providerId: "pages-test",
    model: "pages-test",
    tools: f.tools,
    system: f.options.system,
    limits,
    maxOutputTokens: 2000,
    context: { window: 100_000, reserve: 2000 },
    loop: { maxTurns: 20, continuations: 0, parallelTools: true },
    pages: () => pageSink(f.paths),
    logDir: () => f.paths.logs,
  });
  session.subscribe((event) => events.push(event));
  try {
    const result = await session.send({
      type: "run",
      sessionId: "s_worker",
      prompt: "Build authentication and a dashboard shell. Preserve the API.",
    });
    expect(result).toMatchObject({ stopReason: "done" });
    expect(await Bun.file(join(f.cwd, "forbidden.txt")).exists()).toBe(false);
    expect(await readFile(join(f.cwd, "auth.txt"), "utf8")).toBe(detail);
    const checkpoints = events.filter((event) => event.type === "context.compacted");
    expect(checkpoints).toHaveLength(2);
    expect(
      checkpoints.every((event) => event.type === "context.compacted" && event.kept === 0),
    ).toBe(true);
    expect(
      checkpoints[0]?.type === "context.compacted" && (checkpoints[0].before ?? Infinity) < 20_000,
    ).toBe(true);
    expect(
      events.some((event) => event.type === "turn.finished" && event.reason === "page_incomplete"),
    ).toBe(true);
    const search = events.find(
      (event) => event.type === "tool.finished" && event.call.id === "find-auth",
    );
    expect(search?.type === "tool.finished" && search.result.output).toContain(detail);
    const main = f.requests.filter((request) => request.tools.length > 0);
    expect(main[5]?.messages).toHaveLength(1);
    expect(main[5]?.messages[0]?.content).not.toContain(detail);
    const replayed = replayMessages(
      events.map((event, index) => ({ seq: index + 1, event })),
    ).messages;
    expect(new PageRuntime(replayed).pending()).toBe(false);
    expect(new PageRuntime(replayed).active()).toBeUndefined();
    expect(new PageRuntime(replayed).canFinish()).toBe(false);
    const restarted = new PageWriter(
      {
        provider: f.provider,
        maxOutputTokens: 2000,
        contextWindow: 100_000,
        sink: pageSink(f.paths),
      },
      await pageSink(f.paths).count?.(),
    );
    const recovered = new PageRuntime(replayed, restarted.archive);
    expect((await recovered.execute({ op: "list" })).output).toContain("Page 2");
    expect((await recovered.execute({ op: "search", query: detail })).output).toContain(detail);
    expect(
      (await recovered.execute({ op: "read", page: 1, kind: "transcript", offset: 1, limit: 100 }))
        .output,
    ).toContain(detail);
  } finally {
    await session.dispose();
  }
});

test("archive failure preserves pending history, and a resumed Worker checkpoints before requesting the model", async () => {
  const f = await fixture([
    call("begin", "context", begin("Authentication")),
    call("complete", "context", complete),
  ]);
  const messages: Message[] = [];
  await expect(
    runLoop("Implement authentication", {
      ...f.options,
      messages,
      pageWriter: new PageWriter({
        provider: f.provider,
        maxOutputTokens: 2000,
        contextWindow: 100_000,
        sink: {
          write: async () => {
            throw new Error("disk failed");
          },
        },
      }),
    }),
  ).rejects.toThrow("Logical page checkpoint failed");
  expect(new PageRuntime(messages).pending()).toBe(true);
  expect(
    messages.some((message) => message.role === "tool" && message.toolCallId === "complete"),
  ).toBe(true);
  const prior = f.requests.length;
  await runLoop("Resume", { ...f.options, messages });
  expect(f.requests[prior]?.tools).toEqual([]);
  expect(new PageRuntime(messages).pending()).toBe(false);
  expect(new PageRuntime(messages).active()).toBeUndefined();
});

test("text-only Worker tasks need a fresh logical-page checkpoint on every run", async () => {
  const f = await fixture([
    end("<summary>Bypass without a page.</summary>"),
    call("first-begin", "context", begin("Explain authentication")),
    call("first-complete", "context", complete),
    end("<summary>First explanation verified.</summary>"),
    end("<summary>Reuse the old checkpoint.</summary>"),
    call("second-begin", "context", begin("Explain dashboard")),
    call("second-complete", "context", complete),
    end("<summary>Second explanation verified.</summary>"),
  ]);
  const events: LoopEvent[] = [];
  const messages: Message[] = [];
  const options = { ...f.options, messages, emit: (event: LoopEvent) => events.push(event) };
  expect(await runLoop("Explain authentication from the available context", options)).toMatchObject(
    {
      stopReason: "done",
      summary: "First explanation verified.",
    },
  );
  expect(await runLoop("Now explain the dashboard", options)).toMatchObject({
    stopReason: "done",
    summary: "Second explanation verified.",
  });
  expect(events.filter((event) => event.type === "context.compacted")).toHaveLength(2);
  expect(
    events.filter((event) => event.type === "turn.finished" && event.reason === "page_incomplete"),
  ).toHaveLength(2);
  expect(
    events.filter((event) => event.type === "message.finished" && event.complete),
  ).toHaveLength(2);
});

test("a blocked page reports the blocker after checkpoint and resumes its unfinished objective", async () => {
  const blocked = {
    op: "block",
    summary: "Required authentication fixture is missing.",
    evidence: ["read reported that missing-fixture.txt does not exist"],
    next: "Provide missing-fixture.txt, then verify authentication.",
  };
  const f = await fixture([
    call("begin", "context", begin("Authentication")),
    call("missing", "read", { path: "missing-fixture.txt" }),
    call("blocked", "context", blocked),
    call("resume", "write", { path: "auth.txt", content: "Recovered fixture" }),
    call("complete", "context", complete),
    end("<summary>Authentication verified after resume.</summary>"),
  ]);
  const events: LoopEvent[] = [];
  const messages: Message[] = [];
  const options = { ...f.options, messages, emit: (event: LoopEvent) => events.push(event) };
  const result = await runLoop("Implement authentication", options);
  expect(result).toMatchObject({ stopReason: "end", turns: 3 });
  expect(result.done).toBeUndefined();
  expect(result.summary).toContain(blocked.summary);
  expect(result.summary).toContain(blocked.next);
  expect(f.requests.filter((request) => request.tools.length > 0)).toHaveLength(3);
  const recovered = new PageRuntime(structuredClone(messages), f.options.pageWriter?.archive);
  expect(recovered.active()?.title).toBe("Authentication");
  expect(recovered.pending()).toBe(false);
  expect(recovered.canFinish()).toBe(false);
  expect((await recovered.execute({ op: "search", query: blocked.summary })).output).toContain(
    blocked.summary,
  );
  expect(
    await runLoop("The fixture is now available. Resume the current page.", options),
  ).toMatchObject({
    stopReason: "done",
    summary: "Authentication verified after resume.",
  });
  expect(await readFile(join(f.cwd, "auth.txt"), "utf8")).toBe("Recovered fixture");
  expect(events.filter((event) => event.type === "context.compacted")).toHaveLength(2);
});

test("emergency compaction carries the active page, while Talker never receives logical-page control", async () => {
  const f = await fixture([]);
  const tools: ToolCall[] = [{ id: "begin", name: "context", args: begin("Dashboard shell") }];
  const messages: Message[] = [
    { role: "user", content: "Build dashboard" },
    { role: "assistant", content: "", reasoning: "", toolCalls: tools },
    { role: "tool", name: "context", toolCallId: "begin", content: "Page opened" },
    {
      role: "assistant",
      content: "Large in-progress analysis ".repeat(200),
      reasoning: "",
      toolCalls: [],
    },
    { role: "user", content: "Preserve the API" },
  ];
  let request: CompactionRequest | undefined = {};
  await compactContextIfNeeded(messages, {
    ...f.options,
    takeCompactionRequest: () => {
      const next = request;
      request = undefined;
      return next;
    },
  });
  expect(new PageRuntime(messages).active()?.title).toBe("Dashboard shell");
  expect(messages[0]?.content).toContain("## Active logical page");
  const roles = await conversationOptions(
    {
      cwd: f.cwd,
      provider: f.provider,
      providerId: "pages-test",
      model: "pages-test",
      tools: f.tools,
      system: "",
      limits,
      maxOutputTokens: 2000,
      context: { window: 100_000, reserve: 2000 },
      loop: { maxTurns: 20, continuations: 0, parallelTools: true },
      pages: () => pageSink(f.paths),
      logDir: () => f.paths.logs,
    },
    HarnessConfigSchema.parse({ useDefaults: false }),
    [],
    async () => ({}),
  );
  expect(roles.talker.tools.get("context")).toBeUndefined();
  expect(roles.talker.system).not.toContain("# Logical pages and context compression");
  expect(roles.worker.tools.get("context")).toBeDefined();
  expect(roles.worker.system).toContain(
    "Never postpone this checkpoint until a context percentage",
  );
});
