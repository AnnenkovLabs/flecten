import { afterEach, describe, expect, test } from "bun:test";
import { createProvider } from "../../src/providers/registry";
import type { ModelRequest } from "../../src/providers/types";
import { collect, request, servers, stopServers } from "../helpers/provider-adapters";

afterEach(stopServers);

describe("model depth", () => {
  test("applies per-model protocol, apiId, variant, headers and extra body", async () => {
    let body: Record<string, unknown> = {};
    let headers: Headers | undefined;
    let path = "";
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        headers = req.headers;
        path = new URL(req.url).pathname;
        body = (await req.json()) as Record<string, unknown>;
        return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    servers.push(server);
    const provider = createProvider(
      {
        useDefaults: false,
        provider: "depth",
        model: "test-model",
        mcp: { servers: {} },
        hooks: {
          sessionStart: [],
          userPromptSubmit: [],
          preToolUse: [],
          postToolUse: [],
          stop: [],
          sessionEnd: [],
          permission: [],
          compact: [],
          notification: [],
          subagent: [],
          toolBatch: [],
        },
        providers: {
          depth: {
            protocol: "openai-chat",
            baseUrl: `http://127.0.0.1:${server.port}/v1`,
            headers: {},
            models: {
              "test-model": {
                name: "Test",
                apiId: "api-id-1",
                headers: { "x-model": "yes" },
                extraBody: { service_tier: "priority" },
                variants: {
                  fast: {
                    body: { service_tier: "flex" },
                    headers: { "x-variant": "yes" },
                    temperature: 0.2,
                    reasoning: "low",
                  },
                },
              },
            },
            reasoningReplay: "auto",
            reasoningDetails: "auto",
            thinking: "auto",
            thinkingParam: "auto",
            thinkingKeep: "auto",
            clearThinking: "auto",
            preserveThinking: "auto",
            promptCaching: true,
            streamUsage: true,
            strictTools: false,
          },
        },
        maxOutputTokens: 1024,
        catalog: { autoRefresh: false, ttlMs: 43_200_000 },
        context: { window: 128_000, reserve: 1_000 },
        loop: { maxTurns: 1, continuations: 0, parallelTools: false },
        tools: {
          maxOutputBytes: 10_000,
          maxOutputLines: 100,
          bashTimeoutMs: 5_000,
          readLimitLines: 100,
        },
      },
      "depth",
    );
    await collect(
      provider.provider.stream(
        { ...request(), model: "test-model", variant: "fast", reasoning: "high" },
        new AbortController().signal,
      ),
    );
    expect(path).toBe("/v1/chat/completions");
    expect(body.model).toBe("api-id-1");
    expect(body.service_tier).toBe("flex");
    expect(body.temperature).toBe(0.2);
    expect(headers?.get("x-model")).toBe("yes");
    expect(headers?.get("x-variant")).toBe("yes");
    expect(body.reasoning_effort).toBe("low");
  });

  test("routes an individual model to another protocol", async () => {
    let body: Record<string, unknown> = {};
    let path = "";
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        path = new URL(req.url).pathname;
        body = (await req.json()) as Record<string, unknown>;
        return new Response(
          'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    servers.push(server);
    const provider = createProvider(
      {
        useDefaults: false,
        provider: "deep",
        model: "test-model",
        mcp: { servers: {} },
        hooks: {
          sessionStart: [],
          userPromptSubmit: [],
          preToolUse: [],
          postToolUse: [],
          stop: [],
          sessionEnd: [],
          permission: [],
          compact: [],
          notification: [],
          subagent: [],
          toolBatch: [],
        },
        providers: {
          deep: {
            protocol: "openai-chat",
            baseUrl: `http://127.0.0.1:${server.port}/v1`,
            headers: {},
            models: {
              "test-model": {
                name: "Test",
                apiId: "responses-id",
                protocol: "openai-responses",
              },
            },
            reasoningReplay: "auto",
            reasoningDetails: "auto",
            thinking: "auto",
            thinkingParam: "auto",
            thinkingKeep: "auto",
            clearThinking: "auto",
            preserveThinking: "auto",
            promptCaching: true,
            streamUsage: true,
            strictTools: false,
          },
        },
        maxOutputTokens: 1024,
        catalog: { autoRefresh: false, ttlMs: 43_200_000 },
        context: { window: 128_000, reserve: 1_000 },
        loop: { maxTurns: 1, continuations: 0, parallelTools: false },
        tools: {
          maxOutputBytes: 10_000,
          maxOutputLines: 100,
          bashTimeoutMs: 5_000,
          readLimitLines: 100,
        },
      },
      "deep",
    );
    await collect(
      provider.provider.stream({ ...request(), model: "test-model" }, new AbortController().signal),
    );
    expect(path).toBe("/v1/responses");
    expect(body.model).toBe("responses-id");
  });

  test("resolves a key from a command", async () => {
    let auth = "";
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        auth = req.headers.get("authorization") ?? "";
        return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    servers.push(server);
    const provider = createProvider(
      {
        useDefaults: false,
        provider: "auth-test",
        model: "test-model",
        mcp: { servers: {} },
        hooks: {
          sessionStart: [],
          userPromptSubmit: [],
          preToolUse: [],
          postToolUse: [],
          stop: [],
          sessionEnd: [],
          permission: [],
          compact: [],
          notification: [],
          subagent: [],
          toolBatch: [],
        },
        providers: {
          "auth-test": {
            protocol: "openai-chat",
            baseUrl: `http://127.0.0.1:${server.port}/v1`,
            headers: {},
            models: {},
            reasoningReplay: "auto",
            reasoningDetails: "auto",
            thinking: "auto",
            thinkingParam: "auto",
            thinkingKeep: "auto",
            clearThinking: "auto",
            preserveThinking: "auto",
            promptCaching: true,
            streamUsage: true,
            strictTools: false,
            auth: {
              command: "sh",
              args: ["-c", "printf command-token"],
              timeoutMs: 5000,
              refreshIntervalMs: 300000,
            },
          },
        },
        maxOutputTokens: 1024,
        catalog: { autoRefresh: false, ttlMs: 43_200_000 },
        context: { window: 128_000, reserve: 1_000 },
        loop: { maxTurns: 1, continuations: 0, parallelTools: false },
        tools: {
          maxOutputBytes: 10_000,
          maxOutputLines: 100,
          bashTimeoutMs: 5_000,
          readLimitLines: 100,
        },
      },
      "auth-test",
    );
    await collect(
      provider.provider.stream({ ...request(), model: "test-model" }, new AbortController().signal),
    );
    expect(auth).toBe("Bearer command-token");
  });
});

describe("model compat overrides", () => {
  test("applies per-model replay and stream usage overrides", async () => {
    let body: Record<string, unknown> = {};
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        body = (await req.json()) as Record<string, unknown>;
        return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    servers.push(server);
    const provider = createProvider(
      {
        useDefaults: false,
        provider: "compat",
        model: "test-model",
        mcp: { servers: {} },
        hooks: {
          sessionStart: [],
          userPromptSubmit: [],
          preToolUse: [],
          postToolUse: [],
          stop: [],
          sessionEnd: [],
          permission: [],
          compact: [],
          notification: [],
          subagent: [],
          toolBatch: [],
        },
        providers: {
          compat: {
            protocol: "openai-chat",
            baseUrl: `http://127.0.0.1:${server.port}/v1`,
            headers: {},
            models: {
              "test-model": {
                name: "Test",
                compat: { reasoningReplay: "never", streamUsage: false },
              },
            },
            reasoningReplay: "auto",
            reasoningDetails: "auto",
            thinking: "auto",
            thinkingParam: "auto",
            thinkingKeep: "auto",
            clearThinking: "auto",
            preserveThinking: "auto",
            promptCaching: true,
            streamUsage: true,
            strictTools: false,
          },
        },
        maxOutputTokens: 1024,
        catalog: { autoRefresh: false, ttlMs: 43_200_000 },
        context: { window: 128_000, reserve: 1_000 },
        loop: { maxTurns: 1, continuations: 0, parallelTools: false },
        tools: {
          maxOutputBytes: 10_000,
          maxOutputLines: 100,
          bashTimeoutMs: 5_000,
          readLimitLines: 100,
        },
      },
      "compat",
    );
    const messages: ModelRequest["messages"] = [
      { role: "user", content: "check" },
      { role: "assistant", content: "done", reasoning: "hidden", toolCalls: [] },
    ];
    await collect(
      provider.provider.stream(
        { ...request(), model: "test-model", messages },
        new AbortController().signal,
      ),
    );
    const converted = body.messages as Array<Record<string, unknown>>;
    expect(converted[2]?.reasoning_content).toBeUndefined();
    expect(body.stream_options).toBeUndefined();
  });
});
