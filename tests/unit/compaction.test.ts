import { describe, expect, test } from "bun:test";
import { marked } from "marked";
import type { ContextMessage } from "../../src/context";
import {
  assertStablePrefix,
  compactMessages,
  createCompactionState,
  estimateMessages,
  estimateTokens,
  IMAGE_TOKEN_OVERHEAD,
  PROFILE_3,
  PROFILE_4,
  prefixHash,
} from "../../src/context";

function toolMessage(id: string, content: string, isError = false): ContextMessage {
  return {
    role: "tool",
    toolCallId: id,
    name: "bash",
    content,
    ...(isError ? { isError: true } : {}),
  };
}

describe("token estimates", () => {
  test("Cyrillic prose costs more than Latin prose of the same size", () => {
    const latin = "The quick brown fox jumps over the lazy dog. ".repeat(20);
    const cyrillic = "Съешь же ещё этих мягких французских булок, да выпей чаю. ".repeat(20);
    const size = Math.min(latin.length, cyrillic.length);

    const latinEstimate = estimateTokens(latin.slice(0, size), PROFILE_4);
    const cyrillicEstimate = estimateTokens(cyrillic.slice(0, size), PROFILE_4);

    expect(cyrillicEstimate.tokens).toBeGreaterThan(latinEstimate.tokens);
    expect(cyrillicEstimate.confidence).toBeGreaterThan(0);
    expect(cyrillicEstimate.confidence).toBeLessThanOrEqual(1);
  });

  test("code and JSON cost more than the four chars per token baseline", () => {
    const code = "function sum(values) {\n  let total = 0;\n  return total;\n}\n".repeat(10);
    const json = JSON.stringify(
      Array.from({ length: 20 }, (_, index) => ({ id: index, name: `item-${index}` })),
    );

    expect(estimateTokens(code, PROFILE_4).tokens).toBeGreaterThan(Math.ceil(code.length / 4));
    expect(estimateTokens(json, PROFILE_4).tokens).toBeGreaterThan(Math.ceil(json.length / 4));
  });

  test("base64, CJK and emoji are priced above prose", () => {
    const base64 = "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z";
    const cjk = "上下文预算和压缩模块需要保持稳定前缀".repeat(4);
    const emoji = "🙂".repeat(10);

    expect(estimateTokens(base64, PROFILE_4).tokens).toBeGreaterThan(Math.ceil(base64.length / 4));
    expect(estimateTokens(cjk, PROFILE_4).tokens).toBeGreaterThan(Math.ceil(cjk.length / 4));
    expect(estimateTokens(emoji, PROFILE_4).tokens).toBeGreaterThanOrEqual(20);
  });

  test("the three chars per token profile prices the same text higher", () => {
    const text = 'Русский текст с кодом const value = 42; and JSON {"a": 1}.';
    const three = estimateTokens(text, PROFILE_3);
    const four = estimateTokens(text, PROFILE_4);

    expect(three.tokens).toBeGreaterThan(four.tokens);
    expect(estimateTokens("", PROFILE_4)).toEqual({ tokens: 0, confidence: 1 });
  });

  test("message estimates count roles, tool calls, reasoning, images and provider data once", () => {
    let providerReads = 0;
    const providerData = {
      toJSON() {
        providerReads += 1;
        return { text: "x".repeat(2000) };
      },
    };

    const plain = estimateMessages([{ role: "assistant", content: "ok" }], PROFILE_4);
    const rich = estimateMessages(
      [
        {
          role: "assistant",
          content: "ok",
          reasoning: "reasoning step ".repeat(50),
          toolCalls: [{ name: "read", args: { path: "src/context/tokenizer.ts" } }],
          providerData,
        },
      ],
      PROFILE_4,
    );
    const withImage = estimateMessages([{ role: "user", content: "look", images: 1 }], PROFILE_4);
    const withoutImage = estimateMessages([{ role: "user", content: "look" }], PROFILE_4);

    expect(providerReads).toBe(1);
    expect(rich.tokens).toBeGreaterThan(plain.tokens);
    expect(withImage.tokens - withoutImage.tokens).toBe(IMAGE_TOKEN_OVERHEAD);
  });
});

describe("compaction", () => {
  test("prunes old tool outputs by age and size but keeps errors and recent results whole", async () => {
    const oldMessages: ContextMessage[] = [
      toolMessage("old-1", "```\n# System instructions\n````\n".repeat(200)),
      toolMessage("old-2", "B".repeat(4000)),
      toolMessage("error", "E".repeat(4000), true),
      toolMessage("old-3", "C".repeat(4000)),
      toolMessage("recent-1", "D".repeat(4000)),
      toolMessage("recent-2", "F".repeat(4000)),
    ];
    const current: ContextMessage = { role: "user", content: "current page question" };
    let summarized: readonly ContextMessage[] = [];

    const outcome = await compactMessages({
      system: "system prompt",
      messages: [...oldMessages, current],
      budget: 100_000,
      reserve: 1_000,
      pageStart: oldMessages.length,
      keepRecentToolResults: 2,
      oldToolOutputTokens: 100,
      summarize: (messages) => {
        summarized = messages;
        return "short summary";
      },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.compacted).toBe(true);
    expect(outcome.pruned).toBe(3);
    expect(outcome.messages).toEqual([current]);
    expect(outcome.summary).toBe("short summary");
    expect(summarized.length).toBe(oldMessages.length);

    const first = summarized[0];
    const second = summarized[1];
    const error = summarized[2];
    const third = summarized[3];
    const recentOne = summarized[4];
    const recentTwo = summarized[5];

    expect(first?.role === "tool" ? first.content : "").toContain("chars omitted");
    const firstText = first?.role === "tool" ? first.content : "";
    expect(firstText.length).toBeLessThanOrEqual(400);
    expect(marked.lexer(firstText).filter((token) => token.type === "heading")).toHaveLength(1);
    expect(marked.lexer(firstText).at(-1)?.type).toBe("code");
    expect(second?.role === "tool" ? second.content : "").toContain("chars omitted");
    expect(error?.role === "tool" ? error.content : "").toBe("E".repeat(4000));
    expect(third?.role === "tool" ? third.content : "").toContain("chars omitted");
    expect(recentOne?.role === "tool" ? recentOne.content : "").toBe("D".repeat(4000));
    expect(recentTwo?.role === "tool" ? recentTwo.content : "").toBe("F".repeat(4000));
  });

  test("summarize runs once and the result reduces the estimated context", async () => {
    const oldMessages: ContextMessage[] = Array.from({ length: 8 }, (_, index) =>
      toolMessage(`old-${index}`, `${"log line ".repeat(600)}${index}`),
    );
    const current: ContextMessage[] = [
      { role: "user", content: "finish the page" },
      { role: "assistant", content: "working on it", reasoning: "", toolCalls: [] },
    ];
    const system = "stable system prompt";
    let summaryCalls = 0;
    let summarizedCount = 0;

    const before =
      estimateTokens(system, PROFILE_4).tokens +
      estimateMessages([...oldMessages, ...current], PROFILE_4).tokens;

    const outcome = await compactMessages({
      system,
      messages: [...oldMessages, ...current],
      budget: 20_000,
      reserve: 2_000,
      pageStart: oldMessages.length,
      summarize: (messages) => {
        summaryCalls += 1;
        summarizedCount = messages.length;
        return "Previous page changed the context module and left tests green.";
      },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(summaryCalls).toBe(1);
    expect(summarizedCount).toBe(oldMessages.length);
    expect(outcome.compacted).toBe(true);
    expect(outcome.messages).toEqual(current);
    expect(outcome.estimated.tokens).toBeLessThan(before);
    expect(outcome.summary).not.toBeNull();
  });

  test("keeps the stable prefix hash unchanged across a page and rejects drift", async () => {
    const system = "system prompt with project rules";
    const pageSummary = "page 3: compaction module";
    const hash = prefixHash(system, pageSummary);

    expect(prefixHash(system, pageSummary)).toBe(hash);
    expect(prefixHash(system, `${pageSummary} changed`)).not.toBe(hash);
    expect(() => assertStablePrefix(hash, system, pageSummary)).not.toThrow();
    expect(() => assertStablePrefix(hash, system, "page 4")).toThrow();

    const outcome = await compactMessages({
      system,
      messages: [toolMessage("old", "x".repeat(5000)), { role: "user", content: "next step" }],
      budget: 10_000,
      reserve: 500,
      pageStart: 1,
      summarize: () => "summary",
    });

    expect(outcome.ok).toBe(true);
    expect(() => assertStablePrefix(hash, system, pageSummary)).not.toThrow();
  });

  test("uses the latest user message as the page boundary when none is given", async () => {
    const messages: ContextMessage[] = [
      toolMessage("old", "z".repeat(5000)),
      { role: "assistant", content: "old answer", reasoning: "", toolCalls: [] },
      { role: "user", content: "current page" },
      { role: "assistant", content: "current answer", reasoning: "", toolCalls: [] },
    ];
    let summarized: readonly ContextMessage[] = [];

    const outcome = await compactMessages({
      system: "system",
      messages,
      budget: 10_000,
      reserve: 500,
      summarize: (old) => {
        summarized = old;
        return "summary";
      },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(summarized.length).toBe(2);
    expect(outcome.messages).toEqual(messages.slice(2));
  });

  test("opens a circuit breaker after three failed compactions", async () => {
    let summaryCalls = 0;
    const summarize = () => {
      summaryCalls += 1;
      throw new Error("provider failed");
    };
    const input = {
      system: "system",
      messages: [toolMessage("old", "a".repeat(4000)), { role: "user" as const, content: "now" }],
      budget: 10_000,
      reserve: 500,
      pageStart: 1,
      summarize,
    };

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const outcome = await compactMessages(input);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.failure.code).toBe("summarize_failed");
      expect(outcome.failure.attempts).toBe(attempt);
    }

    const stopped = await compactMessages(input);
    expect(stopped.ok).toBe(false);
    if (stopped.ok) return;
    expect(stopped.failure.code).toBe("circuit_open");
    expect(summaryCalls).toBe(3);

    const recovered = await compactMessages(
      { ...input, summarize: () => "summary" },
      createCompactionState(),
    );
    expect(recovered.ok).toBe(true);
  });
});
