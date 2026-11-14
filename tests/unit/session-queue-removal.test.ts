import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { QueueItem } from "../../src/core/queue/types";
import { createSession } from "../../src/core/session/session";
import { ToolRegistry } from "../../src/tools/registry";
import { scriptedProvider } from "../helpers/fake-provider";

test("removing a queue item already taken for preparation fails without claiming cancellation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-queue-remove-"));
  const gate = Promise.withResolvers<string>();
  const preparing = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  const provider = scriptedProvider([
    [{ type: "done", reason: "end" }],
    [{ type: "done", reason: "end" }],
  ]);
  const limits = {
    maxOutputBytes: 50000,
    maxOutputLines: 2000,
    bashTimeoutMs: 1000,
    readLimitLines: 2000,
  };
  const session = createSession({
    cwd,
    sessionId: "s_queue",
    provider,
    providerId: provider.id,
    model: provider.model,
    tools: new ToolRegistry([], { limits }),
    system: "test",
    limits,
    maxOutputTokens: 1000,
    responseFormat: "conversation",
    context: { window: 100000, reserve: 1000 },
    loop: { maxTurns: 1, continuations: 0, parallelTools: false },
    logDir: () => join(cwd, "logs"),
    async expandPrompt(prompt) {
      if (prompt !== "queued") return prompt;
      preparing.resolve();
      return gate.promise;
    },
  });
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "session.finished" && provider.requests.length === 2) finished.resolve();
  });
  try {
    const { item } = (await session.send({ type: "queue.add", text: "queued" })) as {
      item: QueueItem;
    };
    const { item: pending } = (await session.send({ type: "queue.add", text: "pending" })) as {
      item: QueueItem;
    };
    await session.send({ type: "queue.remove", id: pending.id });
    await session.send({ type: "run", prompt: "first" });
    await preparing.promise;
    await expect(session.send({ type: "queue.remove", id: item.id })).rejects.toThrow(
      "state sending",
    );
    gate.resolve("queued");
    await finished.promise;
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.messages.at(-1)).toMatchObject({
      role: "user",
      content: "queued",
    });
    await expect(session.send({ type: "queue.remove", id: item.id })).rejects.toThrow("state sent");
  } finally {
    gate.resolve("queued");
    unsubscribe();
    await session.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});
