import { expect, test } from "bun:test";
import { conversationBudget } from "../../src/app/conversation-budget";
import { ConversationTwin } from "../../src/app/conversation-twin";
import { accountTwinUsage } from "../../src/app/twin-accounting";
import { visionOptions } from "../../src/app/vision";
import { HarnessConfigSchema } from "../../src/config/schema";
import { RunBudget } from "../../src/core/session/budget";
import type { SessionOptions } from "../../src/core/session/options";
import type { Event } from "../../src/core/types";
import { resetRateLimits } from "../../src/providers/rate-limit";
import { createProvider } from "../../src/providers/registry";
import { ToolRegistry } from "../../src/tools/registry";
import { TranslationClient } from "../../src/translation/client";
import { delegate } from "../../src/twin/inference";
import { TWIN_LIMITS } from "../../src/twin/sources";
import { idleTraining } from "../../src/twin/state";

test("auxiliary clients charge a real failed request once and ignore locally cached quota rejection", async () => {
  const calls: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const model = ((await request.json()) as { model: string }).model;
      calls.push(model);
      if (model === "backup")
        return new Response(
          [
            `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ verdict: "pass", voice: "Verified", instructions: "", entryIds: [], emotion: "calm" }) }, finish_reason: "stop" }] })}`,
            'data: {"usage":{"prompt_tokens":20,"completion_tokens":10}}',
            "data: [DONE]",
            "",
          ].join("\n\n"),
        );
      return Response.json({ error: { code: "model_quota_exhausted" } }, { status: 429 });
    },
  });
  const config = HarnessConfigSchema.parse({
    useDefaults: false,
    provider: "aux-accounting",
    model: "twin",
    providers: {
      "aux-accounting": {
        protocol: "openai-chat",
        baseUrl: server.url.toString(),
        transport: { retries: 0 },
        models: {
          translation: {},
          vision: { vision: true, cost: { input: 1, output: 1 } },
          twin: {},
          fallback: {},
          backup: {},
        },
      },
    },
    vision: { provider: "aux-accounting", model: "vision" },
  });
  const signal = new AbortController().signal;
  try {
    const translationLedger = new RunBudget({});
    const translation = new TranslationClient(
      createProvider({ ...config, model: "translation" }).provider,
      1000,
    );
    const translate = () =>
      translation.translate("Привіт", "en", signal, ({ reported }) => {
        if (reported === false) translationLedger.unavailable();
      });
    await expect(translate()).rejects.toThrow();
    await expect(translate()).rejects.toThrow();
    expect(translationLedger.view().accounting?.missingRequests).toBe(1);

    const visionLedger = new RunBudget({});
    const vision = visionOptions(config);
    const describe = () =>
      vision.describe(
        { mediaType: "image/png", data: "AA==" },
        undefined,
        signal,
        ({ reported }) => {
          if (reported === false) visionLedger.unavailable();
        },
      );
    await expect(describe()).rejects.toThrow();
    await expect(describe()).rejects.toThrow();
    expect(visionLedger.view().accounting?.missingRequests).toBe(1);

    const provider = createProvider(config).provider;
    const limits = {
      maxOutputBytes: 5000,
      maxOutputLines: 100,
      bashTimeoutMs: 1000,
      readLimitLines: 100,
    };
    const options: SessionOptions = {
      cwd: process.cwd(),
      sessionId: "aux-accounting",
      logDir: (id) => `/tmp/flecten-aux-accounting/${id}`,
      provider,
      providerId: config.provider,
      model: config.model,
      system: "test",
      maxOutputTokens: 200,
      tools: new ToolRegistry([], { limits }),
      limits,
      context: { window: 10000, reserve: 500 },
      loop: { maxTurns: 2, continuations: 0, parallelTools: false },
      taskBudget: new RunBudget({}),
    };
    const events: Event[] = [];
    const twin = new ConversationTwin(
      {
        async get() {
          return {
            enabled: true,
            sources: [],
            candidates: [],
            entries: [],
            training: idleTraining(),
            limits: TWIN_LIMITS,
          };
        },
        delegate: (input, abort) =>
          delegate(
            { provider, providerId: config.provider, model: config.model, price: () => 0 },
            input,
            [],
            abort,
          ),
      },
      options,
      (event) => events.push(event),
    );
    twin.begin("Inspect the artifact");
    await expect(twin.decide("prepare")).rejects.toThrow();
    await expect(twin.decide("prepare")).rejects.toThrow();
    expect(options.taskBudget?.view().accounting?.missingRequests).toBe(1);
    expect(conversationBudget(options, events).view().accounting?.missingRequests).toBe(1);
    expect(calls).toEqual(["translation", "vision", "twin"]);
    const definition = config.providers[config.provider];
    if (!definition) throw new Error("Missing test provider");
    definition.failoverModels = ["backup"];
    const fallback = createProvider({ ...config, model: "fallback" }).provider;
    const infer = () =>
      delegate(
        {
          provider: fallback,
          providerId: config.provider,
          model: "fallback",
          price: () => 9,
          priceFor: (_provider, model) => () => (model === "backup" ? 0.03 : 9),
        },
        { phase: "prepare", userMessages: [], task: "Inspect", directive: "", evidence: [] },
        [],
        signal,
      );
    const result = await infer();
    expect(result.usage).toMatchObject({ input: 20, output: 10 });
    expect(result.usage.costUsd).toBeUndefined();
    expect(result.usage.missingRequests).toBe(1);
    const ledger = new RunBudget({});
    accountTwinUsage(ledger, result.usage);
    expect(ledger.view().accounting).toMatchObject({ missingRequests: 1, knownCostUsd: 0.03 });
    const next = await infer();
    accountTwinUsage(ledger, next.usage);
    expect(next.usage.costUsd).toBe(0.03);
    expect(next.usage.missingRequests).toBe(0);
    expect(ledger.view().accounting).toMatchObject({ missingRequests: 1, knownCostUsd: 0.06 });
    const replay = conversationBudget(options, [
      {
        type: "twin.activity",
        sessionId: "aux-accounting",
        activity: {
          phase: "prepare",
          state: "pass",
          emotion: "calm",
          voice: "Verified",
          instructions: "",
          entryIds: [],
          corrections: 0,
          provider: config.provider,
          model: "fallback",
          usage: result.usage,
        },
      },
    ]);
    expect(replay.view().accounting).toMatchObject({ missingRequests: 1, knownCostUsd: 0.03 });
    expect(calls.slice(-3)).toEqual(["fallback", "backup", "backup"]);
  } finally {
    server.stop(true);
    resetRateLimits();
  }
});
