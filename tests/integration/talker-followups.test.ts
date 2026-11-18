import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextReference } from "../../src/core/context-reference";
import { createSession } from "../../src/core/session/session";
import type { Event, RunResult } from "../../src/core/types";
import type { ModelProvider, ModelRequest } from "../../src/providers/types";
import { loadQueue, saveQueue } from "../../src/store/queue";
import { ToolRegistry } from "../../src/tools/registry";
import { abortable } from "../../src/util/abort";

const cases = [
  { label: "next model boundary", maxTurns: 0 },
  { label: "turn limit", maxTurns: 1 },
  { label: "automatic summary wake", maxTurns: 0, summaryWake: true as const },
];

for (const { label, maxTurns, summaryWake } of cases) {
  test(`Talker answers a durable follow-up at the ${label}`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-talker-followups-"));
    const sessionId = "s_talker";
    const hold = Promise.withResolvers<void>();
    const streaming = Promise.withResolvers<AbortSignal>();
    const answered = Promise.withResolvers<void>();
    const requests: ModelRequest[] = [];
    const events: Event[] = [];
    const replies = ["First answer finished.", "Follow-up answered."];
    const original = "  Отдельный вопрос.\n";
    const contexts: ContextReference[] = [
      { kind: "selection", source: "example.md", label: "Selection", text: "selected context" },
    ];
    const provider: ModelProvider = {
      id: "test",
      model: "test",
      async *stream(request, signal) {
        requests.push(structuredClone(request));
        if (requests.length === 1) {
          yield { type: "text", delta: "First answer " };
          streaming.resolve(signal);
          await abortable(hold.promise, signal);
          yield { type: "text", delta: "finished." };
        } else yield { type: "text", delta: replies[1] ?? "" };
        yield { type: "done", reason: "end" };
      },
    };
    const limits = {
      maxOutputBytes: 50_000,
      maxOutputLines: 2000,
      bashTimeoutMs: 1000,
      readLimitLines: 2000,
    };
    const session = createSession({
      cwd,
      sessionId,
      role: "talker",
      provider,
      providerId: provider.id,
      model: provider.model,
      tools: new ToolRegistry([], { limits }),
      limits,
      system: "test",
      maxOutputTokens: 1000,
      context: { window: 100_000, reserve: 1000 },
      responseFormat: "conversation",
      loop: { maxTurns, continuations: 0, parallelTools: false },
      logDir: () => join(cwd, "logs"),
      saveQueue: (id, queue) => saveQueue(cwd, id, queue),
    });
    session.subscribe((event) => {
      events.push(event);
      if (event.type === "session.finished" && requests.length === 2) answered.resolve();
    });
    const first = session.send({
      type: "run",
      sessionId,
      prompt: summaryWake ? "Background summary interaction" : "First request",
      ...(summaryWake ? { internal: true, summaryWake } : {}),
    }) as Promise<RunResult>;
    try {
      const signal = await streaming.promise;
      const message = {
        type: "queue.add" as const,
        id: "q_follow",
        text: original,
        mode: "steer" as const,
        contexts,
      };
      await session.send(message);
      await session.send(message);
      expect(await loadQueue(cwd, sessionId)).toMatchObject({
        items: [{ id: message.id, text: original, contexts, state: "pending" }],
      });
      expect(signal.aborted).toBe(false);
      expect(requests).toHaveLength(1);
      hold.resolve();
      await Promise.all([first, answered.promise]);
      await session.flush();

      expect(
        events.filter((event) => event.type === "message.finished").map((event) => event.text),
      ).toEqual(replies);
      expect(requests[1]?.messages.at(-1)).toMatchObject({
        role: "user",
        content: expect.stringContaining("selected context"),
      });
      const delivered = events.filter(
        (event) =>
          (event.type === "steer.applied" || event.type === "session.started") &&
          event.queueId === message.id,
      );
      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toMatchObject(
        maxTurns > 0 || summaryWake
          ? { type: "session.started", prompt: original }
          : { type: "steer.applied", text: original },
      );
      expect(await loadQueue(cwd, sessionId)).toBeUndefined();
    } finally {
      hold.resolve();
      await session.send({ type: "stop" });
      await session.dispose();
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
