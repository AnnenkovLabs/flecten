import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../src/core/session/session";
import type { Event } from "../src/core/types";
import { builtinTools } from "../src/tools/builtin";
import { ToolRegistry } from "../src/tools/registry";
import { scriptedProvider } from "./helpers/fake-provider";

const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

function build(provider: ReturnType<typeof scriptedProvider>, cwd: string) {
  return createSession({
    cwd,
    provider,
    providerId: "scripted",
    model: "scripted-1",
    tools: new ToolRegistry(builtinTools(), { limits }),
    system: "test system",
    limits,
    maxOutputTokens: 1000,
    context: { window: 100_000, reserve: 1000 },
    loop: { maxTurns: 8, continuations: 0, parallelTools: true },
    logDir: (sessionId) => join(cwd, ".liquid/sessions", sessionId, "logs"),
  });
}

describe("agent session", () => {
  test("streams text and finishes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-session-"));
    try {
      const provider = scriptedProvider([
        [
          { type: "text", delta: "Hello" },
          { type: "text", delta: " world" },
          { type: "usage", input: 5, output: 2, cached: 0 },
          { type: "done", reason: "end" },
        ],
      ]);
      const session = build(provider, cwd);
      const events: Event[] = [];
      session.subscribe((event) => events.push(event));

      const result = (await session.send({ type: "run", prompt: "hi" })) as {
        pass: boolean;
        stopReason: string;
        summary: string;
      };

      expect(result).toMatchObject({ pass: false, stopReason: "end", summary: "Hello world" });
      expect(events.map((event) => event.type)).toContain("message.delta");
      expect(events.map((event) => event.type)).toContain("session.finished");
      const started = events.find((event) => event.type === "session.started");
      expect(started?.type).toBe("session.started");
      if (started?.type === "session.started") expect(started.prompt).toBe("hi");
      const deltas = events.filter((event) => event.type === "message.delta");
      expect(
        deltas.map((event) => (event.type === "message.delta" ? event.text : "")).join(""),
      ).toBe("Hello world");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("repairs a tool call and terminates on done", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-session-"));
    try {
      await writeFile(join(cwd, "a.ts"), "export const value = 1;\n");
      const provider = scriptedProvider([
        [
          {
            type: "tool_call",
            id: "call-1",
            name: "read_file",
            args: { file_path: "a.ts" },
          },
          { type: "done", reason: "tool_use" },
        ],
        [
          {
            type: "tool_call",
            id: "call-2",
            name: "done",
            args: { summary: "read the file", evidence: ["a.ts was read"] },
          },
          { type: "done", reason: "tool_use" },
        ],
      ]);
      const session = build(provider, cwd);
      const events: Event[] = [];
      session.subscribe((event) => events.push(event));

      const result = (await session.send({ type: "run", prompt: "read a.ts" })) as {
        pass: boolean;
        stopReason: string;
      };

      expect(result).toMatchObject({ pass: true, stopReason: "done" });
      const toolEvents = events.filter((event) => event.type === "tool.finished");
      expect(toolEvents).toHaveLength(2);
      const first = toolEvents[0];
      expect(first?.type).toBe("tool.finished");
      if (first?.type === "tool.finished") {
        expect(first.result.ok).toBe(true);
        expect(first.result.notice).toContain("Input repair:");
        expect(first.result.output).toContain("value");
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("passes a per-run reasoning effort to the provider", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-session-"));
    try {
      const provider = scriptedProvider([
        [
          { type: "text", delta: "ok" },
          { type: "done", reason: "end" },
        ],
      ]);
      const session = build(provider, cwd);
      await session.send({ type: "run", prompt: "hi", reasoning: "high" });
      expect(provider.requests[0]?.reasoning).toBe("high");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("stops a running session", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-session-"));
    try {
      const provider = {
        id: "slow",
        model: "slow",
        async *stream(_request: unknown, signal: AbortSignal) {
          yield { type: "text" as const, delta: "partial" };
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
          yield { type: "done" as const, reason: "end" as const };
        },
      };
      const session = build(provider as never, cwd);
      const running = session.send({ type: "run", prompt: "slow" });
      await Bun.sleep(10);
      const stopped = (await session.send({ type: "stop" })) as { stopped: boolean };
      expect(stopped.stopped).toBe(true);
      const result = (await running) as { stopReason: string };
      expect(result.stopReason).toBe("stopped");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("rejects a second run while one is active", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-session-"));
    try {
      const provider = scriptedProvider([
        [
          { type: "text", delta: "first" },
          { type: "done", reason: "end" },
        ],
      ]);
      const session = build(provider, cwd);
      const first = session.send({ type: "run", prompt: "first" });
      await expect(session.send({ type: "run", prompt: "second" })).rejects.toThrow(
        "already active",
      );
      await first;
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
