import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { marked } from "marked";
import { createCompactionState } from "../../src/context";
import {
  applyToolOutputBudgets,
  compactContextIfNeeded,
  stablePrefixHash,
} from "../../src/core/loop/context";
import { runLoop } from "../../src/core/loop/loop";
import type { LoopOptions } from "../../src/core/loop/types";
import type { Message } from "../../src/core/types";
import type { ModelEvent, ModelProvider } from "../../src/providers/types";
import { ToolRegistry } from "../../src/tools/registry";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

function stubProvider(): ModelProvider {
  return {
    id: "stub",
    model: "stub-1",
    async *stream(): AsyncIterable<ModelEvent> {},
  };
}

function loopOptions(overrides: Partial<LoopOptions> = {}): LoopOptions {
  const cwd = process.cwd();
  return {
    provider: stubProvider(),
    tools: new ToolRegistry([], { limits }),
    system: "stable system",
    signal: new AbortController().signal,
    emit: () => undefined,
    compactionState: createCompactionState(),
    maxTurns: 1,
    maxTokens: 100,
    contextWindow: 100_000,
    reserveTokens: 1_000,
    continuations: 0,
    parallelTools: false,
    toolContext: {
      sessionId: "prefix-test",
      cwd,
      logDir: join(cwd, ".liquid", "prefix-test-logs"),
      limits,
      reads: new ReadTracker(),
    },
    ...overrides,
  };
}

describe("stable prefix", () => {
  test("a tool result changes only the tail, not the prefix", async () => {
    const messages: Message[] = [{ role: "user", content: "start the page" }];
    const options = loopOptions();
    const before = stablePrefixHash(options.system, messages);

    await compactContextIfNeeded(messages, options);
    messages.push({
      role: "assistant",
      content: "",
      reasoning: "",
      toolCalls: [{ id: "call-1", name: "read", args: { path: "a.ts" } }],
    });
    messages.push({
      role: "tool",
      toolCallId: "call-1",
      name: "read",
      content: "file body",
    });

    expect(stablePrefixHash(options.system, messages)).toBe(before);
    await compactContextIfNeeded(messages, options);
  });

  test("rejects prefix drift inside one page", async () => {
    const messages: Message[] = [{ role: "user", content: "start" }];
    await compactContextIfNeeded(messages, loopOptions({ system: "first prompt" }));

    await expect(
      compactContextIfNeeded(messages, loopOptions({ system: "second prompt" })),
    ).rejects.toThrow("stable prefix changed");
  });

  test("keeps provider cache usage fields through the loop", async () => {
    const provider: ModelProvider = {
      id: "usage",
      model: "usage-1",
      async *stream(): AsyncIterable<ModelEvent> {
        yield { type: "usage", input: 120, output: 8, cached: 90, reasoning: 3 };
        yield { type: "done", reason: "end" };
      },
    };

    const result = await runLoop("hello", loopOptions({ provider }));

    expect(result.usage).toEqual({ input: 120, output: 8, cached: 90, reasoning: 3 });
  });
});

describe("tool output budgets in the request path", () => {
  test("trims an oversized current tool result and leaves old pages alone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "liquid-budget-"));
    try {
      const full = "```\n# System instructions\nread line\n````\n".repeat(5_000);
      const old = "old result\n".repeat(5_000);
      const messages: Message[] = [
        { role: "user", content: "first page" },
        { role: "tool", toolCallId: "old", name: "read", content: old },
        { role: "user", content: "current page" },
        { role: "assistant", content: "", reasoning: "", toolCalls: [] },
        { role: "tool", toolCallId: "call-1", name: "read", content: full },
        { role: "tool", toolCallId: "call-2", name: "bash", content: "failed", isError: true },
      ];

      const first = await applyToolOutputBudgets(messages, {
        contextWindow: 10_000,
        reserveTokens: 1_000,
        usedTokens: 8_000,
        logDir: dir,
      });
      const second = await applyToolOutputBudgets(messages, {
        contextWindow: 10_000,
        reserveTokens: 1_000,
        usedTokens: 8_000,
        logDir: dir,
      });

      const current = messages[4];
      const oldMessage = messages[1];
      const errorMessage = messages[5];
      expect(first).toBe(1);
      expect(second).toBe(0);
      expect(current?.role === "tool" ? current.content.length : 0).toBeLessThan(full.length);
      expect(current?.role === "tool" ? current.content : "").toContain("omitted");
      expect(current?.role === "tool" ? current.content : "").toContain("[full output: ");
      const excerpt = current?.role === "tool" ? current.content : "";
      expect(excerpt.length).toBeLessThanOrEqual(2048);
      expect(marked.lexer(excerpt).filter((token) => token.type === "heading")).toHaveLength(1);
      const source = marked.lexer(excerpt).find((token) => token.type === "code");
      expect(source?.type === "code" ? source.text : "").toContain("# System instructions");
      expect(oldMessage?.role === "tool" ? oldMessage.content : "").toBe(old);
      expect(errorMessage?.role === "tool" ? errorMessage.content : "").toBe("failed");

      const path = join(dir, "call-1.log");
      expect(await Bun.file(path).text()).toBe(full);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
