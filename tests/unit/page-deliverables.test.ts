import { expect, test } from "bun:test";
import { type ContextMessage, PROFILE_4 } from "../../src/context";
import { PageRuntime } from "../../src/core/pages/runtime";
import { pageTranscript } from "../../src/core/pages/transcript";
import { PageWriter } from "../../src/core/pages/writer";
import { RunBudget } from "../../src/core/session/budget";
import type { Message } from "../../src/core/types";
import { type ProviderResponse, ProviderResponseError } from "../../src/providers/response";
import type { ModelProvider } from "../../src/providers/types";
import { scriptedProvider } from "../helpers/fake-provider";

function completed(result: string): ContextMessage[] {
  return [
    { role: "user", content: "Explain the PR authors' positions with exact quotations" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "close",
          name: "context",
          args: {
            op: "complete",
            summary: "Two positions verified",
            findings: ["Author A: exact quotation", "Author B: opposite quotation"],
            result,
            evidence: ["comment#17", "comment#24"],
            openRisks: [],
            next: "Deliver this explanation",
            finalResult: result,
          },
        },
      ],
    },
    { role: "tool", toolCallId: "close", name: "context", content: "Saved" },
  ];
}

test("completed report needs no summarizer request and its exact revision survives bounded continuation", async () => {
  const provider = scriptedProvider([]);
  const result = "PR answer paragraph. ".repeat(600).trim();
  let page = "";
  const writer = new PageWriter({
    provider,
    maxOutputTokens: 2000,
    contextWindow: 10_000_000,
    sink: {
      async write(_number, markdown) {
        page = markdown;
        return "/pages/1.md";
      },
    },
  });
  await writer.write(completed(result), { profile: PROFILE_4, targetTokens: 900 });
  expect(provider.requests).toHaveLength(0);
  expect(page).toContain(result);
  expect(writer.last?.contextSummary.checkpoint).toMatchObject({
    result,
    finalResult: result,
    findings: ["Author A: exact quotation", "Author B: opposite quotation"],
    openRisks: [],
  });
  expect(writer.last?.markdown).toContain("comment#24");
  expect(writer.last?.contextSummary.fields.risks).not.toContain("failed");
});

test("restored checkpoints permit direct inspection and further work without opening a fake objective", () => {
  const messages: Message[] = [
    {
      role: "user",
      content: "Checkpoint",
      contextSummary: {
        page: 1,
        fields: {
          changed: "Positions collected",
          where: "comment#17",
          rules: "Answer question",
          next: "Deliver",
          risks: "none",
        },
      },
    },
  ];
  const pages = new PageRuntime(messages, undefined, new Set(["read", "grep"]));
  expect(
    pages.guard([{ id: "read", name: "read", args: { path: "evidence.txt" } }]),
  ).toBeUndefined();
  expect(pages.guard([{ id: "write", name: "write", args: { path: "new.txt" } }])).toBeUndefined();
  expect(pages.canFinish()).toBe(true);
});

test("summarizer transcript preserves a long single record when input budget allows it", () => {
  const content = `${"source line\n".repeat(1000)}EXACT_QUOTE_AFTER_6000`;
  const transcript = pageTranscript(
    [{ role: "tool", name: "read", toolCallId: "source", content }],
    20_000,
  );
  expect(transcript).toContain(content);
  expect(transcript).toContain("EXACT_QUOTE_AFTER_6000");
});

test("no durable page means an oversized substantive checkpoint cannot silently replace history", async () => {
  const writer = new PageWriter({
    provider: scriptedProvider([]),
    maxOutputTokens: 2000,
    contextWindow: 50_000,
  });
  await expect(
    writer.write(completed("Exact result. ".repeat(1000)), {
      profile: PROFILE_4,
      targetTokens: 200,
    }),
  ).rejects.toThrow("no durable page reference");
});

test("summary schema failures identify missing fields without logging source contents", async () => {
  const provider = scriptedProvider([
    [
      { type: "text", delta: JSON.stringify({ progress: "Private source quotation" }) },
      { type: "done", reason: "end" },
    ],
  ]);
  const writer = new PageWriter({ provider, maxOutputTokens: 2000, contextWindow: 50_000 });
  const events: import("../../src/core/loop/types").LoopEvent[] = [];
  writer.onEvent = (event) => events.push(event);
  await writer.write([{ role: "user", content: "Keep working" }], {
    profile: PROFILE_4,
    targetTokens: 1000,
  });
  const failure = events.find((event) => event.type === "context.summary.failed");
  expect(failure).toMatchObject({ stage: "schema" });
  expect(failure?.type === "context.summary.failed" && failure.reason).toContain(
    "locations:invalid_type",
  );
  expect(JSON.stringify(events)).not.toContain("Private source quotation");
});

test("failed summary receipts mark cost unavailable and emit provider diagnostics once", async () => {
  const response: ProviderResponse = {
    protocol: "openai-chat",
    status: "failed",
    outcome: "incomplete",
    frames: 1,
    invalidFrames: 0,
    unsupportedFrames: 0,
    textBytes: 0,
    reasoningBytes: 0,
    toolCalls: 0,
    usage: "missing",
    terminal: false,
    durationMs: 1,
  };
  const provider: ModelProvider = {
    id: "summary-test",
    model: "summary-test",
    async *stream() {
      yield { type: "response", response };
      throw new ProviderResponseError(response);
    },
  };
  const writer = new PageWriter({ provider, maxOutputTokens: 2000, contextWindow: 50_000 });
  const budget = new RunBudget({}, () => 0);
  const events: import("../../src/core/loop/types").LoopEvent[] = [];
  writer.onEvent = (event) => {
    events.push(event);
    if (event.type === "usage.unavailable") budget.unavailable();
    if (event.type === "usage") budget.add(event.usage);
  };
  await writer.write([{ role: "user", content: "Continue the unfinished work" }], {
    profile: PROFILE_4,
    targetTokens: 1000,
  });
  expect(events.filter((event) => event.type === "provider.response")).toHaveLength(1);
  expect(events.filter((event) => event.type === "usage.unavailable")).toEqual([
    { type: "usage.unavailable", purpose: "compaction", model: "summary-test" },
  ]);
  expect(budget.view()).toMatchObject({
    accounting: { status: "unavailable", missingRequests: 1 },
  });
  expect(budget.view().spent.costUsd).toBeUndefined();
});
