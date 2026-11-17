import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessConfigSchema } from "../../src/config/schema";
import { RunBudget } from "../../src/core/session/budget";
import { createSession } from "../../src/core/session/session";
import type { Event } from "../../src/core/types";
import { resetRateLimits } from "../../src/providers/rate-limit";
import { createProvider } from "../../src/providers/registry";
import { ToolRegistry } from "../../src/tools/registry";

test("fallback accounting retains the failed route and does not charge a blocked quota lookup", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "provider-accounting-"));
  const calls: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { model } = (await req.json()) as { model: string };
      calls.push(model);
      if (model === "primary")
        return Response.json({ error: { code: "model_quota_exhausted" } }, { status: 429 });
      return new Response(
        [
          'data: {"choices":[{"delta":{"content":"<summary>Done.</summary>"},"finish_reason":"stop"}]}',
          'data: {"usage":{"prompt_tokens":20,"completion_tokens":10}}',
          "data: [DONE]",
          "",
        ].join("\n\n"),
      );
    },
  });
  const config = HarnessConfigSchema.parse({
    useDefaults: false,
    provider: "accounting",
    model: "primary",
    providers: {
      accounting: {
        protocol: "openai-chat",
        baseUrl: server.url.toString(),
        transport: { retries: 0 },
        failoverModels: ["backup"],
        models: { primary: {}, backup: {} },
      },
    },
  });
  const events: Event[] = [];
  const ledger = new RunBudget({});
  const limits = {
    maxOutputBytes: 5000,
    maxOutputLines: 100,
    bashTimeoutMs: 1000,
    readLimitLines: 100,
  };
  const session = createSession({
    cwd,
    provider: createProvider(config).provider,
    providerId: "accounting",
    model: "primary",
    tools: new ToolRegistry([], { limits }),
    limits,
    system: "test",
    maxOutputTokens: 200,
    context: { window: 10000, reserve: 500 },
    loop: { maxTurns: 2, continuations: 0, parallelTools: false },
    logDir: (id) => join(cwd, id),
    taskBudget: ledger,
    priceFor: (_provider, model) => () => (model === "backup" ? 0.03 : 9),
  });
  session.subscribe((event) => events.push(event));
  try {
    await session.send({ type: "run", prompt: "first" });
    expect(ledger.view().accounting).toMatchObject({ missingRequests: 1, knownCostUsd: 0.03 });
    await session.send({ type: "run", prompt: "continue" });
    expect(ledger.view().accounting).toMatchObject({ missingRequests: 1, knownCostUsd: 0.06 });
    expect(calls).toEqual(["primary", "backup", "backup"]);
    expect(
      events
        .filter((event) => event.type === "usage")
        .every((event) => event.type === "usage" && event.model === "backup"),
    ).toBe(true);
    expect(events.filter((event) => event.type === "provider.response")).toHaveLength(4);
    expect(events.filter((event) => event.type === "usage.unavailable")).toHaveLength(1);
  } finally {
    await session.dispose();
    server.stop(true);
    resetRateLimits();
    await rm(cwd, { recursive: true, force: true });
  }
});
