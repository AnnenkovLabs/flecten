import { expect, test } from "bun:test";
import type { LoopEvent } from "../../src/core/loop/types";
import { SessionCompaction } from "../../src/core/session/compaction";
import type { Message } from "../../src/core/types";
import { ToolRegistry } from "../../src/tools/registry";
import { TranslationClient } from "../../src/translation/client";
import { scriptedProvider } from "../helpers/fake-provider";

test("idle compaction translates focus and display while retaining English continuation", async () => {
  const provider = scriptedProvider([]);
  const client = new TranslationClient(scriptedProvider([]), 1000);
  client.translate = async (text, target) => ({
    text:
      target === "en"
        ? text === "Только тесты."
          ? "Tests only."
          : text
        : "Локализованное саммари.",
    language: "en",
  });
  const history: Message[] = [
    { role: "user", content: "Fix the bug.", workingLanguage: "en", sourceLanguage: "ru" },
  ];
  for (let index = 0; index < 20; index++)
    history.push(
      {
        role: "assistant",
        content: "Checking tests.",
        reasoning: "",
        workingLanguage: "en",
        toolCalls: [{ id: String(index), name: "read", args: { path: "test.ts" } }],
      },
      {
        role: "tool",
        toolCallId: String(index),
        name: "read",
        content: "Previous test output. ".repeat(30),
      },
    );
  const events: LoopEvent[] = [];
  const compaction = new SessionCompaction({
    provider,
    system: "",
    maxOutputTokens: 1000,
    tools: new ToolRegistry([], {
      limits: {
        maxOutputBytes: 50000,
        maxOutputLines: 2000,
        bashTimeoutMs: 1000,
        readLimitLines: 100,
      },
    }),
    context: { window: 10000, reserve: 1000 },
    logDir: () => "/tmp/flecten-translation-unused",
    language: { client, language: "auto", price: () => 0, providerId: "t" },
  });
  const result = await compaction.compactIdle(
    "test",
    history,
    { focus: "Только тесты." },
    (event) => events.push(event),
  );
  expect(result.compacted).toBe(true);
  expect(events.find((event) => event.type === "context.compacted")).toMatchObject({
    displaySummary: "Локализованное саммари.",
  });
  expect(provider.requests[0]?.system).toContain("Tests only.");
  expect(JSON.stringify(provider.requests)).not.toContain("Только тесты");
  expect(history[0]).toMatchObject({ workingLanguage: "en", sourceLanguage: "ru" });
  expect(history[0]?.content).not.toContain("Локализованное");
});
