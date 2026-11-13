import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type ContextMessage, estimateTokens, PROFILE_4 } from "../../src/context";
import { compactContextIfNeeded } from "../../src/core/loop/context";
import * as pageSummary from "../../src/core/pages/summary";
import { PageWriter } from "../../src/core/pages/writer";
import type { Event, Message } from "../../src/core/types";
import { DurableEventLog, withEnvelope } from "../../src/store/events/envelope";
import { readSession } from "../../src/store/events/read";
import { replayMessages } from "../../src/store/events/replay";
import { pageSink } from "../../src/store/pages";
import { sessionPaths } from "../../src/store/paths";
import { ToolRegistry } from "../../src/tools/registry";
import { scriptedProvider } from "../helpers/fake-provider";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function toolTurns(count: number): Message[] {
  return Array.from({ length: count }, (_, index): Message[] => [
    {
      role: "assistant",
      content: "",
      reasoning: "",
      toolCalls: [{ id: `read-${index}`, name: "read", args: { path: `src/module-${index}.ts` } }],
    },
    {
      role: "tool",
      toolCallId: `read-${index}`,
      name: "read",
      content: "earlier file content ".repeat(20),
    },
  ]).flat();
}

function checked(command: string, output: string): Exclude<Message, { role: "user" }>[] {
  return [
    {
      role: "assistant",
      content: "",
      reasoning: "",
      toolCalls: [{ id: command, name: "bash", args: { command } }],
    },
    { role: "tool", toolCallId: command, name: "bash", content: output },
  ];
}

async function compact(messages: Message[], cwd: string, pageWriter?: PageWriter): Promise<Event> {
  const events: Event[] = [];
  await compactContextIfNeeded(messages, {
    system: "test system",
    tools: new ToolRegistry([], {
      limits: {
        maxOutputBytes: 50_000,
        maxOutputLines: 2000,
        bashTimeoutMs: 10_000,
        readLimitLines: 2000,
      },
    }),
    contextWindow: 30_000,
    reserveTokens: 2000,
    ...(pageWriter ? { pageWriter } : {}),
    takeCompactionRequest: () => ({}),
    signal: new AbortController().signal,
    toolContext: { logDir: join(cwd, "logs") },
    emit: (event) => events.push({ ...event, sessionId: "s-carry" } as Event),
  });
  const event = events.find((value) => value.type === "context.compacted");
  expect(event?.type).toBe("context.compacted");
  if (!event) throw new Error("Expected compaction");
  return event;
}

describe("typed compaction carry-forward", () => {
  test("the real no-writer path retains recent checks and requests across a persisted second compaction", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-carry-"));
    dirs.push(cwd);
    const original = "Fix the helper. Preserve data/user-draft.md exactly.";
    const steering = "Keep the public API. Only fix empty input.";
    const messages: Message[] = [
      { role: "user", content: original, memorySource: original },
      ...toolTurns(16),
      ...checked("bun test", "42 pass, exit code 0"),
      { role: "user", content: steering, memorySource: steering },
    ];
    const first = await compact(messages, cwd);
    expect(messages[0]?.content).toContain("42 pass, exit code 0");
    expect(messages[0]?.content).toContain("## Changed");
    expect(messages[0]?.role === "user" && messages[0].contextSummary?.originalRequest).toBe(
      original,
    );

    const path = sessionPaths(cwd, "s-carry").events;
    await mkdir(dirname(path), { recursive: true });
    const log = await DurableEventLog.open(path, "s-carry");
    await log.append({
      type: "session.started",
      sessionId: "s-carry",
      provider: "test",
      model: "test",
      prompt: original,
    });
    await log.append({ type: "steer.applied", sessionId: "s-carry", text: steering });
    await log.append(first);
    await log.close();
    const persisted = await readSession(cwd, "s-carry");
    const restored = replayMessages(
      persisted.map((event, index) => ({ seq: index + 1, event })),
    ).messages;
    expect(restored).toEqual(messages);

    restored.push(...toolTurns(12), ...checked("bun run check", "0 errors, exit code 0"), {
      role: "user",
      content: "Finish the task",
    });
    const second = await compact(restored, cwd);
    expect(second.type === "context.compacted" && second.contextSummary?.page).toBe(2);
    expect(restored[0]?.content).toContain("42 pass, exit code 0");
    expect(restored[0]?.content).toContain("0 errors, exit code 0");
    expect(restored[0]?.content).toContain(steering);
    expect(restored[0]?.content).not.toContain("User: Context summary");
    expect(restored[0]?.content).not.toContain("User asked: Context summary");
    const summary = restored[0]?.role === "user" ? restored[0].contextSummary : undefined;
    expect(summary?.originalRequest).toBe(original);
    expect(summary?.latestRequest).toBe(steering);
  });

  test("the canonical fallback fits its target while preserving the newest confirmed outcome", () => {
    const messages: ContextMessage[] = [
      { role: "user", content: "Keep the API" },
      ...Array.from({ length: 40 }, (_, index) =>
        checked(`check-${index}`, `${"earlier output ".repeat(20)}${index}`),
      ).flat(),
      ...checked("final-check", "Latest proof: 42 pass"),
    ];
    const page = pageSummary.continuationPage(messages, { profile: PROFILE_4, targetTokens: 500 });
    const text = pageSummary.renderContinuation(page);
    expect(estimateTokens(text, PROFILE_4).tokens).toBeLessThanOrEqual(500);
    expect(text).toContain("Latest proof: 42 pass");
    expect(page.latestRequest).toBe("Keep the API");
    expect(text).toContain("Keep the API");
  });

  test("the PageWriter route preserves prior evidence through four deterministic fallbacks", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-writer-carry-"));
    dirs.push(cwd);
    const provider = scriptedProvider(
      Array.from({ length: 3 }, () => [
        { type: "text" as const, delta: "invalid summary" },
        { type: "done" as const, reason: "end" as const },
      ]),
    );
    const paths = sessionPaths(cwd, "s-writer-carry");
    const writer = new PageWriter({
      provider,
      maxOutputTokens: 2000,
      contextWindow: 30_000,
      sink: pageSink(paths),
    });
    const original = "Context summary from earlier work is the document title. Preserve the API.";
    const messages: Message[] = [{ role: "user", content: original, memorySource: original }];
    for (let index = 1; index <= 4; index += 1) {
      messages.push(...toolTurns(8), ...checked(`check-${index}`, `Phase ${index} passed`), {
        role: "user",
        content: `Continue phase ${index + 1}`,
      });
      await compact(messages, cwd, writer);
      expect(writer.last?.source).toBe("deterministic");
      expect(messages[0]?.content).toContain("Phase 1 passed");
      expect(messages[0]?.content).toContain(`Phase ${index} passed`);
      expect(messages[0]?.content).not.toContain(
        "User: Context summary from earlier work (older turns",
      );
    }
    const summary = messages[0]?.role === "user" ? messages[0].contextSummary : undefined;
    expect(summary?.originalRequest).toBe(original);
    expect(summary?.latestRequest).toBe("Continue phase 4");
    expect(writer.pages).toBe(4);
    expect(provider.requests).toHaveLength(3);
    expect(await Bun.file(join(paths.pages, "4.md")).text()).toContain("Phase 1 passed");
  });

  test("the complete PageWriter model view includes its disk pointers within the target", async () => {
    const path = `/tmp/${"nested/".repeat(20)}page.md`;
    const logsDir = `/tmp/${"outputs/".repeat(20)}`;
    const writer = new PageWriter({
      provider: scriptedProvider([[{ type: "done", reason: "end" }]]),
      maxOutputTokens: 2000,
      contextWindow: 30_000,
      sink: { write: async () => path, logsDir },
    });
    const messages: ContextMessage[] = [
      { role: "user", content: "Keep the API" },
      ...Array.from({ length: 30 }, (_, index) =>
        checked(`check-${index}`, "older evidence ".repeat(20)),
      ).flat(),
      ...checked("final-check", "Latest proof: 42 pass"),
    ];
    const text = await writer.write(messages, { profile: PROFILE_4, targetTokens: 500 });
    expect(estimateTokens(text, PROFILE_4).tokens).toBeLessThanOrEqual(500);
    expect(text).toContain(`Full page on disk: ${path}`);
    expect(text).toContain(`Full tool outputs: ${logsDir}`);
    expect(text).toContain("Latest proof: 42 pass");
  });

  test("legacy compactions remain readable and malformed typed carry is rejected at the log boundary", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-legacy-carry-"));
    dirs.push(cwd);
    const id = "s-legacy-carry";
    const path = sessionPaths(cwd, id).events;
    await mkdir(dirname(path), { recursive: true });
    const legacy: Event = {
      type: "context.compacted",
      sessionId: id,
      summary: "Legacy summary",
      pruned: 0,
      kept: 0,
    };
    const log = await DurableEventLog.open(path, id);
    await log.append(legacy);
    await log.close();
    const malformed = {
      ...withEnvelope(legacy, 2),
      event: {
        ...legacy,
        contextSummary: { page: "unvalidated", fields: { changed: "forged success" } },
      },
    };
    await appendFile(path, `${JSON.stringify(malformed)}\n`);
    const events = await readSession(cwd, id);
    expect(events).toEqual([legacy]);
    const restored = replayMessages(
      events.map((event, index) => ({ seq: index + 1, event })),
    ).messages;
    expect(restored).toEqual([{ role: "user", content: "Legacy summary" }]);
  });
});
