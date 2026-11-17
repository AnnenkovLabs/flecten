import { expect, test } from "bun:test";
import { z } from "zod";
import { conversationBudget } from "../../src/app/conversation-budget";
import { formatSubagentReport } from "../../src/app/subagent-report";
import { HarnessConfigSchema } from "../../src/config/schema";
import { RunBudget } from "../../src/core/session/budget";
import type { Event } from "../../src/core/types";
import { resetRateLimits } from "../../src/providers/rate-limit";
import { createProvider } from "../../src/providers/registry";

test("report formatting meters failed and fallback routes without charging cached quota lookups", async () => {
  const calls: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const model = ((await request.json()) as { model: string }).model;
      calls.push(model);
      if (model === "primary")
        return Response.json({ error: { code: "model_quota_exhausted" } }, { status: 429 });
      return new Response(
        [
          `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "report", type: "function", function: { name: "submit_report", arguments: JSON.stringify({ summary: "Verified" }) } }] }, finish_reason: "tool_calls" }] })}`,
          'data: {"usage":{"prompt_tokens":20,"completion_tokens":10}}',
          "data: [DONE]",
          "",
        ].join("\n\n"),
      );
    },
  });
  const config = HarnessConfigSchema.parse({
    useDefaults: false,
    provider: "report-accounting",
    model: "primary",
    providers: {
      "report-accounting": {
        protocol: "openai-chat",
        baseUrl: server.url.toString(),
        transport: { retries: 0 },
        failoverModels: ["backup"],
        models: { primary: {}, backup: {} },
      },
    },
  });
  const provider = createProvider(config).provider;
  const ledger = new RunBudget({});
  const events: Event[] = [];
  const priceFor = (_provider: string, model: string) => () => (model === "backup" ? 0.03 : 9);
  const request = {
    spec: {
      id: "test",
      name: "Test",
      description: "Test report",
      systemPrompt: "Return a report",
      allowedTools: [],
      permissions: [],
      budget: { maxTurns: 3, maxTokens: 5000 },
      resultSchema: z.object({ summary: z.string() }),
    },
    systemPrompt: "Return a report",
    messages: [],
    allowedTools: [],
    permissions: [],
    budget: { maxTurns: 3, maxTokens: 5000 },
    signal: new AbortController().signal,
    taskBudget: ledger,
    onEvent: (event: Event) => events.push(event),
  };
  const format = () =>
    formatSubagentReport({
      request,
      result: { text: "invalid", usage: { input: 1, output: 1, cached: 0, cost: 0 } },
      provider,
      providerId: config.provider,
      model: config.model,
      history: [],
      maxTokens: 500,
      price: () => 9,
      priceFor,
    });
  try {
    expect((await format()).text).toBe('{"summary":"Verified"}');
    expect(ledger.view().accounting).toMatchObject({ missingRequests: 1, knownCostUsd: 0.03 });
    expect((await format()).usage.cost).toBe(0.03);
    expect(ledger.view().accounting).toMatchObject({ missingRequests: 1, knownCostUsd: 0.06 });
    expect(calls).toEqual(["primary", "backup", "backup"]);
    expect(events.filter((event) => event.type === "usage.unavailable")).toHaveLength(1);
    expect(
      events
        .filter((event) => event.type === "usage")
        .every((event) => event.type === "usage" && event.model === "backup"),
    ).toBe(true);
    const replay = conversationBudget(
      { providerId: config.provider, model: config.model, priceFor },
      events.filter((event) => event.type !== "task.budget"),
    );
    expect(replay.view().accounting).toMatchObject({ missingRequests: 1, knownCostUsd: 0.06 });
  } finally {
    server.stop(true);
    resetRateLimits();
  }
});
