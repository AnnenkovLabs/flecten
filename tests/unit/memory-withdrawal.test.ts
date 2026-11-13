import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryRuntime } from "../../src/core/memory/runtime";
import { memoryDigest } from "../../src/core/memory/sources";
import { createSession } from "../../src/core/session/session";
import type { Event, SessionId } from "../../src/core/types";
import { replayMessages } from "../../src/store/events/replay";
import { MemoryStore } from "../../src/store/memory";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { scriptedProvider } from "../helpers/fake-provider";

test("mass withdrawal removes every stale body before a request even with no discovery room, and survives replay", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "memory-withdrawal-"));
  const store = new MemoryStore({ cwd });
  const limits = {
    maxOutputBytes: 50000,
    maxOutputLines: 2000,
    bashTimeoutMs: 10000,
    readLimitLines: 2000,
  };
  const quote = "The original delivery convention was explicitly approved for earlier test data.";
  try {
    const records = [];
    for (let index = 0; index < 24; index += 1)
      records.push(
        await store.put({
          key: `delivery/${index}`,
          kind: "context",
          summary: `Delivery convention ${index}`,
          content: `WITHDRAWN_BODY_${index}: use this old convention.`,
          reason: "Earlier agreement.",
          cues: [],
          priority: "normal",
          topics: ["Delivery"],
          sources: [
            {
              role: "user",
              quote,
              reference: "user:0",
              sessionId: "prior",
              digest: memoryDigest(quote),
            },
          ],
        }),
      );
    const provider = scriptedProvider([
      [
        ...records.map((record, index) => ({
          type: "tool_call" as const,
          id: `read-${index}`,
          name: "memory",
          args: { operation: "read", id: record.id },
        })),
        { type: "done", reason: "tool_use" },
      ],
      [
        { type: "text", delta: "Reviewed" },
        { type: "done", reason: "end" },
      ],
    ]);
    const options = {
      cwd,
      memory: store,
      provider,
      providerId: "test",
      model: "test",
      system: "Project instructions",
      responseFormat: "conversation" as const,
      tools: new ToolRegistry(builtinTools(), { limits }),
      limits,
      maxOutputTokens: 2000,
      context: { window: 100000, reserve: 2000 },
      loop: { maxTurns: 4, continuations: 0, parallelTools: false },
      logDir: (id: string) => join(cwd, ".liquid", "sessions", id, "logs"),
    };
    const first = createSession(options);
    const events: Event[] = [];
    first.subscribe((event) => events.push(event));
    await first.send({ type: "run", prompt: "Review the conventions" });
    await first.dispose();
    for (let offset = 0; offset < records.length; offset += 8)
      await store.reconcile({
        save: [],
        forget: records
          .slice(offset, offset + 8)
          .map((record) => ({ id: record.id, expectedRevision: record.revision })),
      });
    const envelopes = events.map((event, index) => ({ seq: index + 1, event }));
    const history = replayMessages(envelopes).messages;
    expect(history.filter((message) => message.content.includes("WITHDRAWN_BODY_"))).toHaveLength(
      24,
    );
    const runtime = new MemoryRuntime({
      port: store,
      sessionId: "restored",
      system: options.system,
      messages: () => history,
    });
    const notice = await runtime.refresh(0);
    expect(notice?.references).toHaveLength(24);
    expect(history.some((message) => message.content.includes("WITHDRAWN_BODY_"))).toBe(false);
    expect(notice?.text).toContain("withdrawn");
    if (!notice) throw new Error("Missing withdrawal event");
    const event: Event = { type: "memory.context", sessionId: "restored" as SessionId, ...notice };
    const restored = replayMessages([...envelopes, { seq: envelopes.length + 1, event }]).messages;
    expect(restored.some((message) => message.content.includes("WITHDRAWN_BODY_"))).toBe(false);
    const nextProvider = scriptedProvider([
      [
        { type: "text", delta: "Use current rules" },
        { type: "done", reason: "end" },
      ],
    ]);
    const next = createSession({
      ...options,
      provider: nextProvider,
      sessionId: "restored",
      loadHistory: async () => restored,
    });
    await next.send({ type: "run", sessionId: "restored", prompt: "Continue" });
    expect(
      nextProvider.requests[0]?.messages.some((message) =>
        message.content.includes("WITHDRAWN_BODY_"),
      ),
    ).toBe(false);
    await next.dispose();
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
