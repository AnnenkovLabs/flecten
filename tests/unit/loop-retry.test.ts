import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../../src/core/session/session";
import type { Event, RunResult } from "../../src/core/types";
import { StreamError } from "../../src/providers/sse";
import type { ModelEvent, ModelProvider } from "../../src/providers/types";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";

const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

describe("loop retry", () => {
  test("restarts an interrupted answer and clears the partial one", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      id: "retry-test",
      model: "retry-model",
      async *stream(): AsyncIterable<ModelEvent> {
        calls += 1;
        if (calls === 1) {
          yield { type: "text", delta: "partial" };
          throw new StreamError("stream ended before [DONE]", "network");
        }
        yield { type: "text", delta: "complete answer" };
        yield { type: "done", reason: "end" };
      },
    };
    const cwd = await mkdtemp(join(tmpdir(), "liquid-retry-"));
    try {
      const events: Event[] = [];
      const session = createSession({
        cwd,
        provider,
        providerId: "retry-test",
        model: "retry-model",
        tools: new ToolRegistry(builtinTools(), { limits }),
        system: "test",
        limits,
        maxOutputTokens: 1000,
        context: { window: 100_000, reserve: 1000 },
        loop: { maxTurns: 4, continuations: 0, parallelTools: false },
        logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
      });
      session.subscribe((event) => events.push(event));

      const result = (await session.send({ type: "run", prompt: "hello" })) as RunResult;

      expect(result.stopReason).toBe("end");
      expect(calls).toBe(2);
      expect(events.some((event) => event.type === "message.reset")).toBe(true);
      expect(
        session.getHistory().some((message) => message.content.includes("complete answer")),
      ).toBe(true);
      expect(session.getHistory().some((message) => message.content.includes("partial"))).toBe(
        false,
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 20_000);
});
