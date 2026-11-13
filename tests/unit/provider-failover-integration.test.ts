import { afterEach, describe, expect, test } from "bun:test";
import {
  type HarnessConfig,
  HarnessConfigSchema,
  type ProviderConfig,
} from "../../src/config/schema";
import { type FailoverModelProvider, ProviderFailure } from "../../src/providers/failover";
import { createProvider } from "../../src/providers/registry";
import { TransportError } from "../../src/providers/transport";
import type { ModelEvent, ModelRequest } from "../../src/providers/types";

const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

function serve(handler: (request: Request) => Response | Promise<Response>): string {
  const server = Bun.serve({ port: 0, fetch: handler });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

function sse(...events: string[]): string {
  return `${events.map((event) => `data: ${event}`).join("\n\n")}\n\n`;
}

function textResponse(text: string): Response {
  return new Response(sse(JSON.stringify({ choices: [{ delta: { content: text } }] }), "[DONE]"), {
    headers: { "content-type": "text/event-stream" },
  });
}

function toolResponse(): Response {
  const chunk = {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call-1",
              function: { name: "read", arguments: '{"path":"a.ts"}' },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
  return new Response(sse(JSON.stringify(chunk), "[DONE]"), {
    headers: { "content-type": "text/event-stream" },
  });
}

function errorResponse(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    ...(status === 429 ? { headers: { "retry-after": "0" } } : {}),
  });
}

async function collect(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const output: ModelEvent[] = [];
  for await (const event of events) output.push(event);
  return output;
}

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    model: "p-model",
    system: "system",
    messages: [{ role: "user", content: "hi" }],
    tools: [
      {
        name: "read",
        description: "read a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ],
    maxTokens: 100,
    ...overrides,
  };
}

interface ConfigOptions {
  primaryUrl: string;
  backupUrl: string;
  failover?: Record<string, unknown>;
  primaryModels?: Record<string, unknown>;
  primaryFailoverModels?: string[];
}

function makeConfig(options: ConfigOptions): HarnessConfig {
  return HarnessConfigSchema.parse({
    provider: "primary",
    model: "p-model",
    providers: {
      primary: {
        protocol: "openai-chat",
        baseUrl: options.primaryUrl,
        transport: { retries: 0 },
        models: options.primaryModels ?? {},
        ...(options.primaryFailoverModels === undefined
          ? {}
          : { failoverModels: options.primaryFailoverModels }),
      },
      backup: {
        protocol: "openai-chat",
        baseUrl: options.backupUrl,
        transport: { retries: 0 },
      },
    },
    ...(options.failover === undefined ? {} : { failover: options.failover }),
  });
}

function providerOf(config: HarnessConfig, id: string): ProviderConfig {
  const provider = config.providers[id];
  if (!provider) throw new Error(`missing provider ${id}`);
  return provider;
}

function streamFailure(error: unknown): ProviderFailure {
  if (error instanceof ProviderFailure) return error;
  throw error;
}

async function captureFailure(run: () => Promise<unknown>): Promise<ProviderFailure> {
  try {
    await run();
  } catch (error) {
    return streamFailure(error);
  }
  throw new Error("expected the stream to fail");
}

describe("provider failover integration", () => {
  test("switches to the configured fallback after a retryable 429", async () => {
    let primaryCalls = 0;
    let backupModel = "";
    const primaryUrl = serve(() => {
      primaryCalls += 1;
      return errorResponse(429, { error: { message: "rate limited" } });
    });
    const backupUrl = serve(async (httpRequest) => {
      backupModel = ((await httpRequest.json()) as { model: string }).model;
      return textResponse("fallback ok");
    });
    const config = makeConfig({
      primaryUrl,
      backupUrl,
      failover: {
        retryBudget: 0,
        providers: [{ provider: "backup", model: "b-model" }],
      },
    });

    const active = createProvider(config);
    const events = await collect(active.provider.stream(request(), new AbortController().signal));

    expect(events).toContainEqual({ type: "text", delta: "fallback ok" });
    expect(events.at(-1)).toEqual({ type: "done", reason: "end" });
    // The window learns which model answered, and why, before the fallback's first token.
    expect(events[0]).toEqual({
      type: "route",
      provider: "backup",
      model: "b-model",
      reason: "rate_limit",
    });
    expect(primaryCalls).toBe(1);
    expect(backupModel).toBe("b-model");
    expect((active.provider as FailoverModelProvider).lastUsed).toEqual({
      provider: "backup",
      model: "b-model",
    });
  });

  test("announces nothing when the configured model answers", async () => {
    const primaryUrl = serve(() => textResponse("primary ok"));
    const backupUrl = serve(() => textResponse("should not happen"));
    const config = makeConfig({
      primaryUrl,
      backupUrl,
      failover: { retryBudget: 0, providers: [{ provider: "backup", model: "b-model" }] },
    });

    const active = createProvider(config);
    const events = await collect(active.provider.stream(request(), new AbortController().signal));

    expect(events).toContainEqual({ type: "text", delta: "primary ok" });
    expect(events.some((event) => event.type === "route")).toBe(false);
  });

  test("does not fall back on auth failures", async () => {
    let backupCalls = 0;
    const primaryUrl = serve(() => errorResponse(401, { error: { message: "bad key" } }));
    const backupUrl = serve(() => {
      backupCalls += 1;
      return textResponse("should not happen");
    });
    const config = makeConfig({
      primaryUrl,
      backupUrl,
      failover: { retryBudget: 0, providers: [{ provider: "backup", model: "b-model" }] },
    });

    const active = createProvider(config);
    const failure = await captureFailure(() =>
      collect(active.provider.stream(request(), new AbortController().signal)),
    );

    expect(failure.kind).toBe("auth");
    expect(backupCalls).toBe(0);
  });

  test("does not fall back on context overflow", async () => {
    let backupCalls = 0;
    const primaryUrl = serve(() =>
      errorResponse(400, { error: { code: "context_length_exceeded", message: "too long" } }),
    );
    const backupUrl = serve(() => {
      backupCalls += 1;
      return textResponse("should not happen");
    });
    const config = makeConfig({
      primaryUrl,
      backupUrl,
      failover: { retryBudget: 0, providers: [{ provider: "backup", model: "b-model" }] },
    });

    const active = createProvider(config);
    const failure = await captureFailure(() =>
      collect(active.provider.stream(request(), new AbortController().signal)),
    );

    expect(failure.kind).toBe("context");
    expect(failure.code).toBe("context_overflow");
    expect(backupCalls).toBe(0);
  });

  test("throws the last error when every target fails", async () => {
    const primaryUrl = serve(() => errorResponse(500, { error: { message: "primary down" } }));
    const backupUrl = serve(() => errorResponse(502, { error: { message: "backup down" } }));
    const config = makeConfig({
      primaryUrl,
      backupUrl,
      failover: { retryBudget: 0, providers: [{ provider: "backup", model: "b-model" }] },
    });

    const active = createProvider(config);
    const failure = await captureFailure(() =>
      collect(active.provider.stream(request(), new AbortController().signal)),
    );

    expect(failure.kind).toBe("server");
    expect(failure.status).toBe(502);
  });

  test("keeps the original provider when no fallback is configured", async () => {
    let backupCalls = 0;
    const primaryUrl = serve(() => errorResponse(500, { error: { message: "primary down" } }));
    const backupUrl = serve(() => {
      backupCalls += 1;
      return textResponse("should not happen");
    });
    const config = makeConfig({ primaryUrl, backupUrl });

    const active = createProvider(config);
    expect("lastUsed" in active.provider).toBe(false);
    let failure: unknown;
    try {
      await collect(active.provider.stream(request(), new AbortController().signal));
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(TransportError);
    expect((failure as TransportError).status).toBe(500);
    expect(backupCalls).toBe(0);
  });

  test("preserves tools, reasoning and tool calls across the fallback", async () => {
    let backupBody: Record<string, unknown> = {};
    const primaryUrl = serve(() => errorResponse(429, { error: { message: "rate limited" } }));
    const backupUrl = serve(async (httpRequest) => {
      backupBody = (await httpRequest.json()) as Record<string, unknown>;
      return toolResponse();
    });
    const config = makeConfig({
      primaryUrl,
      backupUrl,
      failover: { retryBudget: 0, providers: [{ provider: "backup", model: "b-model" }] },
    });

    const active = createProvider(config);
    const events = await collect(
      active.provider.stream(request({ reasoning: "high" }), new AbortController().signal),
    );

    expect(events).toContainEqual({
      type: "tool_call",
      id: "call-1",
      name: "read",
      args: { path: "a.ts" },
    });
    expect(events.at(-1)).toEqual({ type: "done", reason: "tool_use" });
    expect(backupBody.model).toBe("b-model");
    expect(backupBody.reasoning_effort).toBe("high");
    expect(Array.isArray(backupBody.tools)).toBe(true);
    expect((backupBody.tools as unknown[]).length).toBe(1);
  });

  test("reads a model-level fallback list defensively", async () => {
    let backupModel = "";
    const primaryUrl = serve(async (httpRequest) => {
      const body = (await httpRequest.json()) as { model: string };
      if (body.model === "p-model") {
        return errorResponse(429, { error: { message: "rate limited" } });
      }
      backupModel = body.model;
      return textResponse("same provider fallback");
    });
    const backupUrl = serve(() => textResponse("unused"));
    const config = makeConfig({
      primaryUrl,
      backupUrl,
      primaryModels: { "p-model": {}, "alt-model": {} },
    });
    const model = providerOf(config, "primary").models["p-model"];
    if (!model) throw new Error("missing model");
    (model as unknown as Record<string, unknown>).failoverModels = ["alt-model"];

    const active = createProvider(config);
    const events = await collect(active.provider.stream(request(), new AbortController().signal));

    expect(events).toContainEqual({ type: "text", delta: "same provider fallback" });
    expect(backupModel).toBe("alt-model");
    expect((active.provider as FailoverModelProvider).lastUsed).toEqual({
      provider: "primary",
      model: "alt-model",
    });
  });

  test("shares the circuit breaker across calls", async () => {
    let primaryCalls = 0;
    const primaryUrl = serve(() => {
      primaryCalls += 1;
      return errorResponse(500, { error: { message: "primary down" } });
    });
    const backupUrl = serve(() => textResponse("fallback ok"));
    const config = makeConfig({
      primaryUrl,
      backupUrl,
      failover: {
        retryBudget: 0,
        failureThreshold: 1,
        providers: [{ provider: "backup", model: "b-model" }],
      },
    });

    const active = createProvider(config);
    await collect(active.provider.stream(request(), new AbortController().signal));
    expect(primaryCalls).toBe(1);
    await collect(active.provider.stream(request(), new AbortController().signal));

    expect(primaryCalls).toBe(1);
    expect((active.provider as FailoverModelProvider).lastUsed).toEqual({
      provider: "backup",
      model: "b-model",
    });
  });

  test("shares the retry budget across calls", async () => {
    let primaryCalls = 0;
    const primaryUrl = serve(() => {
      primaryCalls += 1;
      return errorResponse(429, { error: { message: "rate limited" } });
    });
    const backupUrl = serve(() => textResponse("fallback ok"));
    const config = makeConfig({
      primaryUrl,
      backupUrl,
      failover: {
        retryBudget: 1,
        failureThreshold: 10,
        providers: [{ provider: "backup", model: "b-model" }],
      },
    });

    const active = createProvider(config);
    await collect(active.provider.stream(request(), new AbortController().signal));
    expect(primaryCalls).toBe(2);
    await collect(active.provider.stream(request(), new AbortController().signal));

    expect(primaryCalls).toBe(3);
  });
});
