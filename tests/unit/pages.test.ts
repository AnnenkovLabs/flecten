import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ContextMessage, PROFILE_4 } from "../../src/context";
import { deepCutIndex } from "../../src/core/loop/context";
import { PAGE_HEADER, parsePageSummary } from "../../src/core/pages/summary";
import { PageWriter } from "../../src/core/pages/writer";
import { createSession } from "../../src/core/session/session";
import type { Event, Message } from "../../src/core/types";
import type { ModelEvent } from "../../src/providers/types";
import { replayMessages } from "../../src/store/events/replay";
import { pageSink } from "../../src/store/pages";
import { sessionPaths } from "../../src/store/paths";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { scriptedProvider } from "../helpers/fake-provider";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-pages-"));
  dirs.push(dir);
  return dir;
}

const SUMMARY = {
  progress: "edited src/a.ts",
  locations: "src/a.ts:12",
  instructions: "keep the API",
  nextSteps: "run tests",
  risks: "none",
};
const FIELDS = JSON.stringify(SUMMARY);

function answer(text: string): ModelEvent[] {
  return [
    { type: "text", delta: text },
    { type: "done", reason: "end" },
  ];
}

const transcript: ContextMessage[] = [
  { role: "user", content: "Rename the helper and keep the public API" },
  {
    role: "assistant",
    content: "Editing",
    toolCalls: [{ id: "c1", name: "edit", args: { path: "src/a.ts" } }],
  },
  { role: "tool", toolCallId: "c1", name: "edit", content: "ok" },
];

describe("page summaries", () => {
  test("a page is valid only when all five fields have content", () => {
    expect(parsePageSummary(FIELDS)).toMatchObject({
      changed: "edited src/a.ts",
      next: "run tests",
    });
    const { risks: _risks, ...missing } = SUMMARY;
    expect(parsePageSummary(JSON.stringify(missing))).toBeUndefined();
    expect(parsePageSummary(FIELDS.replace("none", "  "))).toBeUndefined();
    expect(parsePageSummary(`Summary:\n${FIELDS}`)).toBeUndefined();
  });

  test("the worker model writes the page, it lands on disk and the context points to it", async () => {
    const cwd = await workspace();
    const provider = scriptedProvider([answer(FIELDS)]);
    const paths = sessionPaths(cwd, "s_page");
    const writer = new PageWriter({
      provider,
      maxOutputTokens: 2000,
      contextWindow: 50_000,
      sink: pageSink(paths),
    });

    const context = await writer.write(transcript, { profile: PROFILE_4, targetTokens: 4000 });

    expect(writer.last?.source).toBe("model");
    expect(writer.last?.page).toBe(1);
    expect(provider.requests[0]?.tools).toEqual([]);
    expect(provider.requests[0]?.system).toContain('"nextSteps"');
    expect(provider.requests[0]?.messages[0]?.content).toContain(
      "## Conversation to summarize\n\n- Trust: `untrusted`",
    );
    expect(provider.requests[0]?.messages[0]?.content).toContain("## Conversation context");
    expect(provider.requests[0]?.messages[0]?.content).toContain("- Tool call identifier: `c1`");
    const file = join(paths.pages, "1.md");
    const markdown = await readFile(file, "utf8");
    expect(markdown).toContain("# Page 1");
    expect(markdown).toContain("## Rules to keep\nkeep the API");
    expect(markdown).toContain(
      "## Original request (verbatim)\nRename the helper and keep the public API",
    );
    expect(context.startsWith(PAGE_HEADER)).toBe(true);
    expect(context).toContain(`Full page on disk: ${await realpath(file)}`);
    expect(await pageSink(paths).count?.()).toBe(1);
  });

  test("bad model output falls back to a deterministic page and the breaker stops asking", async () => {
    const provider = scriptedProvider([answer("no tags"), answer("still no tags"), answer("nope")]);
    const writer = new PageWriter({ provider, maxOutputTokens: 2000, contextWindow: 50_000 });
    const context = { profile: PROFILE_4, targetTokens: 4000 };

    for (let index = 0; index < 4; index += 1) await writer.write(transcript, context);

    expect(writer.last?.source).toBe("deterministic");
    expect(writer.last?.markdown).toContain("edit src/a.ts");
    expect(writer.pages).toBe(4);
    expect(provider.requests).toHaveLength(3);
  });

  test("numbering continues after a restart", async () => {
    const cwd = await workspace();
    const paths = sessionPaths(cwd, "s_restart");
    const sink = pageSink(paths);
    await sink.write(1, "# Page 1");
    await sink.write(2, "# Page 2 token=sk-secretsecretsecret");
    expect(await sink.count?.()).toBe(2);
    expect(await readFile(join(paths.pages, "2.md"), "utf8")).not.toContain(
      "sk-secretsecretsecret",
    );
  });
});

describe("compaction ladder", () => {
  test("a deep cut keeps a tail that starts at an assistant turn", () => {
    const big = "x".repeat(4000);
    const messages: ContextMessage[] = [
      { role: "user", content: big },
      { role: "assistant", content: big, toolCalls: [{ id: "a", name: "read", args: {} }] },
      { role: "tool", toolCallId: "a", name: "read", content: big },
      { role: "assistant", content: big, toolCalls: [{ id: "b", name: "read", args: {} }] },
      { role: "tool", toolCallId: "b", name: "read", content: "short" },
    ];
    const index = deepCutIndex(messages, 1500);
    expect(messages[index]?.role).toBe("assistant");
    expect(index).toBe(3);
  });

  test("replay applies a compaction: the page replaces old turns and orphan tool results go", () => {
    const events: Event[] = [
      {
        type: "session.started",
        sessionId: "s",
        provider: "p",
        model: "m",
        prompt: "/fix",
        input: "Fix the bug",
      },
      {
        type: "message.finished",
        sessionId: "s",
        text: "",
        reasoning: "",
        toolCalls: [{ id: "c1", name: "read", args: {} }],
      },
      {
        type: "tool.finished",
        sessionId: "s",
        call: { id: "c1", name: "read", args: {} },
        result: { ok: true, output: "file" },
      },
      { type: "message.finished", sessionId: "s", text: "Found it", reasoning: "", toolCalls: [] },
      {
        type: "context.compacted",
        sessionId: "s",
        summary: `${PAGE_HEADER}: page 1`,
        pruned: 0,
        kept: 2,
      },
    ];
    const { messages } = replayMessages(events.map((event, index) => ({ seq: index + 1, event })));
    expect(messages.map((message: Message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[0]?.content).toBe(`${PAGE_HEADER}: page 1`);
    expect(messages[1]?.content).toBe("Found it");
  });

  test("replay restores the exact model input of a slash command", () => {
    const { messages } = replayMessages([
      {
        seq: 1,
        event: {
          type: "session.started",
          sessionId: "s",
          provider: "p",
          model: "m",
          prompt: "/fix",
          input: "Fix the bug",
        },
      },
    ]);
    expect(messages[0]?.content).toBe("Fix the bug");
  });
});

describe("manual compaction", () => {
  const limits = {
    maxOutputBytes: 50_000,
    maxOutputLines: 2000,
    bashTimeoutMs: 10_000,
    readLimitLines: 2000,
  };

  test("/compact on an idle session writes a page, replaces history and reports the new size", async () => {
    const cwd = await workspace();
    const long = "The repository has many modules and this answer explains them in detail. ".repeat(
      80,
    );
    const provider = scriptedProvider([answer(long), answer(long), answer(FIELDS)]);
    const session = createSession({
      cwd,
      provider,
      providerId: "scripted",
      model: "scripted-1",
      tools: new ToolRegistry(builtinTools(), { limits }),
      system: "test system",
      limits,
      maxOutputTokens: 1000,
      context: { window: 100_000, reserve: 1000 },
      loop: { maxTurns: 4, continuations: 0, parallelTools: true },
      pages: (sessionId) => pageSink(sessionPaths(cwd, sessionId)),
      logDir: (sessionId) => sessionPaths(cwd, sessionId).logs,
    });
    const events: Event[] = [];
    session.subscribe((event) => events.push(event));

    const first = (await session.send({ type: "run", prompt: "Explain the repo" })) as {
      sessionId: string;
    };
    await session.send({ type: "run", prompt: "And the tests?", sessionId: first.sessionId });
    const reply = (await session.send({ type: "context.compact", focus: "tests" })) as {
      compacted: boolean;
      context?: { used: number };
    };

    expect(reply.compacted).toBe(true);
    const compacted = events.find((event) => event.type === "context.compacted");
    expect(compacted).toMatchObject({
      type: "context.compacted",
      page: 1,
      source: "model",
      focus: "tests",
    });
    const history = session.getHistory();
    expect(String(history[0]?.content).startsWith(PAGE_HEADER)).toBe(true);
    expect(provider.requests[2]?.system).toContain("focus the summary on: tests");
    const page = await readFile(join(sessionPaths(cwd, first.sessionId).pages, "1.md"), "utf8");
    expect(page).toContain("## Next step\nrun tests");
    const status = (await session.send({ type: "status" })) as { context?: { used: number } };
    expect(status.context?.used).toBe(reply.context?.used);
    await session.dispose();
  });

  test("an empty session has nothing to compact", async () => {
    const cwd = await workspace();
    const session = createSession({
      cwd,
      provider: scriptedProvider([]),
      providerId: "scripted",
      model: "scripted-1",
      tools: new ToolRegistry(builtinTools(), { limits }),
      system: "test system",
      limits,
      maxOutputTokens: 1000,
      context: { window: 100_000, reserve: 1000 },
      loop: { maxTurns: 4, continuations: 0, parallelTools: true },
      logDir: (sessionId) => sessionPaths(cwd, sessionId).logs,
    });
    expect(await session.send({ type: "context.compact" })).toEqual({ compacted: false });
  });

  test("a context too small to shrink reports that instead of pretending", async () => {
    const cwd = await workspace();
    const provider = scriptedProvider([answer("short"), answer(FIELDS)]);
    const session = createSession({
      cwd,
      provider,
      providerId: "scripted",
      model: "scripted-1",
      tools: new ToolRegistry(builtinTools(), { limits }),
      system: "test system",
      limits,
      maxOutputTokens: 1000,
      context: { window: 100_000, reserve: 1000 },
      loop: { maxTurns: 4, continuations: 0, parallelTools: true },
      logDir: (sessionId) => sessionPaths(cwd, sessionId).logs,
    });
    const run = (await session.send({ type: "run", prompt: "hi" })) as { sessionId: string };
    await session.send({ type: "run", prompt: "again", sessionId: run.sessionId });
    const reply = (await session.send({ type: "context.compact" })) as {
      compacted: boolean;
      reason?: string;
    };
    expect(reply.compacted).toBe(false);
    expect(reply.reason).toBe("no_reduction");
  });
});
