import { afterEach, describe, expect, test } from "bun:test";
import { createAnthropic } from "../../src/providers/anthropic";
import { createGemini } from "../../src/providers/gemini";
import { createOpenAiChat } from "../../src/providers/openai-chat";
import { createOpenAiResponses } from "../../src/providers/openai-responses";
import type { ModelRequest } from "../../src/providers/types";
import { collect, request, servers, stopServers } from "../helpers/provider-adapters";
import { runtime } from "../helpers/runtime";

afterEach(stopServers);

describe("provider compatibility nuances", () => {
  test("replays reasoning with the alias field for Groq", async () => {
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
    const provider = createOpenAiChat(
      runtime(`http://127.0.0.1:${server.port}/v1`, { reasoningReplay: "alias" }, "groq"),
    );
    const messages: ModelRequest["messages"] = [
      { role: "user", content: "check" },
      {
        role: "assistant",
        content: "",
        reasoning: "think",
        toolCalls: [{ id: "tool-1", name: "read", args: { path: "a.ts" } }],
      },
      { role: "tool", toolCallId: "tool-1", name: "read", content: "contents" },
    ];
    await collect(provider.stream({ ...request(), messages }, new AbortController().signal));
    const converted = body.messages as Array<Record<string, unknown>>;
    expect(converted[2]?.reasoning).toBe("think");
    expect(converted[2]?.reasoning_content).toBeUndefined();
  });

  test("pads empty reasoning for DeepSeek when tools are present", async () => {
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
    const provider = createOpenAiChat(
      runtime(`http://127.0.0.1:${server.port}/v1`, {}, "deepseek"),
    );
    const messages: ModelRequest["messages"] = [
      { role: "user", content: "check" },
      {
        role: "assistant",
        content: "",
        reasoning: "",
        toolCalls: [{ id: "tool-1", name: "read", args: { path: "a.ts" } }],
      },
      { role: "tool", toolCallId: "tool-1", name: "read", content: "contents" },
    ];
    await collect(provider.stream({ ...request(), messages }, new AbortController().signal));
    const converted = body.messages as Array<Record<string, unknown>>;
    expect(converted[2]?.reasoning_content).toBe("");
  });

  test("replays OpenRouter reasoning details unchanged", async () => {
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
    const provider = createOpenAiChat(
      runtime(`http://127.0.0.1:${server.port}/v1`, {}, "openrouter"),
    );
    const details = [
      { type: "reasoning.text", text: "thought", signature: "sig", index: 0 },
      { type: "reasoning.encrypted", data: "enc", index: 1 },
    ];
    const messages: ModelRequest["messages"] = [
      { role: "user", content: "check" },
      {
        role: "assistant",
        content: "",
        reasoning: "thought",
        toolCalls: [{ id: "tool-1", name: "read", args: { path: "a.ts" } }],
        providerData: { kind: "openrouter", details },
      },
      { role: "tool", toolCallId: "tool-1", name: "read", content: "contents" },
    ];
    await collect(provider.stream({ ...request(), messages }, new AbortController().signal));
    const converted = body.messages as Array<Record<string, unknown>>;
    expect(converted[2]?.reasoning_details).toEqual(details);
  });

  test("preserves Gemini thought signatures on tool calls", async () => {
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
    const provider = createOpenAiChat(runtime(`http://127.0.0.1:${server.port}/v1`));
    const extraContent = { google: { thought_signature: "sig" } };
    const messages: ModelRequest["messages"] = [
      { role: "user", content: "check" },
      {
        role: "assistant",
        content: "",
        reasoning: "",
        toolCalls: [{ id: "tool-1", name: "read", args: { path: "a.ts" }, extraContent }],
      },
      { role: "tool", toolCallId: "tool-1", name: "read", content: "contents" },
    ];
    await collect(provider.stream({ ...request(), messages }, new AbortController().signal));
    const converted = body.messages as Array<Record<string, unknown>>;
    const calls = converted[2]?.tool_calls as Array<Record<string, unknown>>;
    expect(calls[0]?.extra_content).toEqual(extraContent);
  });

  test("replays raw OpenAI Responses reasoning items", async () => {
    let body: Record<string, unknown> = {};
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        body = (await req.json()) as Record<string, unknown>;
        return new Response(
          'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    servers.push(server);
    const provider = createOpenAiResponses(
      runtime(`http://127.0.0.1:${server.port}/v1`, { protocol: "openai-responses" }, "openai"),
    );
    const messages: ModelRequest["messages"] = [
      { role: "user", content: "check" },
      {
        role: "assistant",
        content: "",
        reasoning: "thought",
        toolCalls: [{ id: "call_1", name: "read", args: { path: "a.ts" } }],
        providerData: {
          kind: "openai-responses",
          items: [
            { type: "reasoning", id: "rs_1", encrypted_content: "encrypted", summary: [] },
            {
              type: "function_call",
              id: "fc_1",
              call_id: "call_1",
              name: "read",
              arguments: '{"path":"a.ts"}',
            },
          ],
        },
      },
      { role: "tool", toolCallId: "call_1", name: "read", content: "contents" },
    ];
    await collect(provider.stream({ ...request(), messages }, new AbortController().signal));
    const input = body.input as Array<Record<string, unknown>>;
    expect(input[1]?.type).toBe("reasoning");
    expect(input[1]?.encrypted_content).toBe("encrypted");
    expect(input[2]?.type).toBe("function_call");
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
  });

  test("uses adaptive thinking for newer Claude models", async () => {
    let body: Record<string, unknown> = {};
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        body = (await req.json()) as Record<string, unknown>;
        return new Response(
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    servers.push(server);
    const provider = createAnthropic(
      runtime(
        `http://127.0.0.1:${server.port}`,
        {
          protocol: "anthropic-messages",
          models: {
            "claude-opus-4-7": {
              name: "Claude Opus 4.7",
              reasoning: true,
              reasoningMode: "effort",
              reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
            },
          },
        },
        "anthropic",
      ),
    );
    await collect(
      provider.stream(
        { ...request(), model: "claude-opus-4-7", reasoning: "high", maxTokens: 32_000 },
        new AbortController().signal,
      ),
    );
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(body.output_config).toEqual({ effort: "high" });
  });

  test("uses budget thinking and captures signatures for older Claude models", async () => {
    let body: Record<string, unknown> = {};
    let headers: Headers | undefined;
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        headers = req.headers;
        body = (await req.json()) as Record<string, unknown>;
        const lines = [
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"plan"}}',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig"}}',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
          'event: message_stop\ndata: {"type":"message_stop"}',
          "",
        ].join("\n\n");
        return new Response(lines, { headers: { "content-type": "text/event-stream" } });
      },
    });
    servers.push(server);
    const provider = createAnthropic(
      runtime(
        `http://127.0.0.1:${server.port}`,
        {
          protocol: "anthropic-messages",
          models: {
            "claude-sonnet-4-5": {
              name: "Claude Sonnet 4.5",
              reasoning: true,
              reasoningMode: "budget",
            },
          },
        },
        "anthropic",
      ),
    );
    const events = await collect(
      provider.stream(
        { ...request(), model: "claude-sonnet-4-5", reasoning: "high", maxTokens: 32_000 },
        new AbortController().signal,
      ),
    );
    expect((body.thinking as Record<string, unknown>).type).toBe("enabled");
    expect(headers?.get("anthropic-beta")).toContain("interleaved-thinking");
    const providerData = events.find((event) => event.type === "provider_data");
    expect(providerData).toEqual({
      type: "provider_data",
      data: {
        kind: "anthropic",
        blocks: [{ type: "thinking", thinking: "plan", signature: "sig" }],
      },
    });
  });

  test("parses native Gemini thinking and function calls", async () => {
    let body: Record<string, unknown> = {};
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        body = (await req.json()) as Record<string, unknown>;
        const data = (payload: unknown) => `data: ${JSON.stringify(payload)}`;
        const events = [
          data({
            candidates: [
              {
                content: {
                  parts: [{ text: "plan", thought: true, thoughtSignature: "sig" }],
                },
              },
            ],
          }),
          data({ candidates: [{ content: { parts: [{ text: "Hi" }] } }] }),
          data({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: { name: "read", args: { path: "a.ts" } },
                      thoughtSignature: "call-sig",
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2 },
          }),
          "",
        ].join("\n\n");
        return new Response(events, { headers: { "content-type": "text/event-stream" } });
      },
    });
    servers.push(server);
    const provider = createGemini(
      runtime(`http://127.0.0.1:${server.port}/v1beta`, { protocol: "gemini" }, "google"),
    );
    const events = await collect(
      provider.stream({ ...request(), reasoning: "high" }, new AbortController().signal),
    );
    expect(events.some((event) => event.type === "reasoning" && event.delta === "plan")).toBe(true);
    expect(events.some((event) => event.type === "text" && event.delta === "Hi")).toBe(true);
    expect(events.some((event) => event.type === "tool_call" && event.name === "read")).toBe(true);
    expect(events.some((event) => event.type === "provider_data")).toBe(true);
    expect(
      (body.generationConfig as Record<string, Record<string, unknown>>).thinkingConfig
        ?.includeThoughts,
    ).toBe(true);
  });
});
