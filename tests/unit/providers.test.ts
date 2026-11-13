import { afterEach, describe, expect, test } from "bun:test";
import { createAnthropic } from "../../src/providers/anthropic";
import { createOpenAiChat } from "../../src/providers/openai-chat";
import { createOpenAiResponses } from "../../src/providers/openai-responses";
import type { ModelRequest } from "../../src/providers/types";
import { collect, request, servers, stopServers } from "../helpers/provider-adapters";
import { runtime } from "../helpers/runtime";

afterEach(stopServers);

describe("openai chat adapter", () => {
  test("parses text, tool calls, usage and finish reason", async () => {
    let body: Record<string, unknown> = {};
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        body = (await req.json()) as Record<string, unknown>;
        const sse = [
          'data: {"choices":[{"delta":{"content":"Hi"}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read","arguments":"{\\"path\\":\\"a.ts\\"}"}}]},"finish_reason":"tool_calls"}]}',
          'data: {"usage":{"prompt_tokens":10,"completion_tokens":2}}',
          "data: [DONE]",
          "",
        ].join("\n\n");
        return new Response(sse, { headers: { "content-type": "text/event-stream" } });
      },
    });
    servers.push(server);

    const provider = createOpenAiChat(runtime(`http://127.0.0.1:${server.port}/v1`));
    const events = await collect(
      provider.stream({ ...request(), reasoning: "high" }, new AbortController().signal),
    );

    expect(events).toEqual([
      { type: "text", delta: "Hi" },
      { type: "tool_call_progress", index: 0, name: "read" },
      { type: "tool_call_progress", index: 0, delta: '{"path":"a.ts"}' },
      { type: "tool_call", id: "call-1", name: "read", args: { path: "a.ts" } },
      { type: "usage", input: 10, output: 2, cached: 0 },
      { type: "done", reason: "tool_use" },
    ]);
    expect(body.model).toBe("test-model");
    expect(body.stream).toBe(true);
    expect(body.reasoning_effort).toBe("high");
  });

  test("replays assistant reasoning_content across tool calls", async () => {
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
    const messages: ModelRequest["messages"] = [
      { role: "user", content: "check" },
      {
        role: "assistant",
        content: "",
        reasoning: "I should read the file.",
        toolCalls: [{ id: "tool-1", name: "read", args: { path: "a.ts" } }],
      },
      { role: "tool", toolCallId: "tool-1", name: "read", content: "contents" },
      { role: "assistant", content: "done", reasoning: "", toolCalls: [] },
    ];
    await collect(provider.stream({ ...request(), messages }, new AbortController().signal));

    const converted = body.messages as Array<Record<string, unknown>>;
    expect(converted[2]?.reasoning_content).toBe("I should read the file.");
    expect(converted[4]?.reasoning_content).toBeUndefined();
  });
});

describe("openai responses adapter", () => {
  test("parses output text, function calls and usage", async () => {
    let body: Record<string, unknown> = {};
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        body = (await req.json()) as Record<string, unknown>;
        const data = (payload: unknown) => `data: ${JSON.stringify(payload)}`;
        const args = JSON.stringify({ path: "a.ts" });
        const events = [
          `event: response.output_item.added\n${data({
            type: "response.output_item.added",
            item: {
              type: "function_call",
              id: "fc_1",
              call_id: "call_1",
              name: "read",
              arguments: "",
            },
          })}`,
          `event: response.function_call_arguments.delta\n${data({
            type: "response.function_call_arguments.delta",
            item_id: "fc_1",
            delta: args,
          })}`,
          `event: response.function_call_arguments.done\n${data({
            type: "response.function_call_arguments.done",
            item_id: "fc_1",
            arguments: args,
          })}`,
          `event: response.output_text.delta\n${data({
            type: "response.output_text.delta",
            delta: "Hi",
          })}`,
          `event: response.completed\n${data({
            type: "response.completed",
            response: {
              status: "completed",
              usage: { input_tokens: 10, output_tokens: 2 },
            },
          })}`,
          "",
        ].join("\n\n");
        return new Response(events, { headers: { "content-type": "text/event-stream" } });
      },
    });
    servers.push(server);

    const provider = createOpenAiResponses(
      runtime(`http://127.0.0.1:${server.port}/v1`, { protocol: "openai-responses" }),
    );
    const events = await collect(
      provider.stream({ ...request(), reasoning: "low" }, new AbortController().signal),
    );

    expect(events).toEqual([
      { type: "tool_call_progress", index: 0, name: "read" },
      { type: "tool_call_progress", index: 0, delta: '{"path":"a.ts"}' },
      { type: "tool_call", id: "call_1", name: "read", args: { path: "a.ts" } },
      { type: "text", delta: "Hi" },
      { type: "usage", input: 10, output: 2, cached: 0 },
      { type: "done", reason: "tool_use" },
    ]);
    expect(body.instructions).toBe("system");
    expect(body.reasoning).toEqual({ effort: "low", summary: "auto" });
    const input = body.input as Array<Record<string, unknown>>;
    expect(input[0]?.role).toBe("user");
  });
});

describe("anthropic adapter", () => {
  test("parses text and usage", async () => {
    let body: Record<string, unknown> = {};
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        body = (await req.json()) as Record<string, unknown>;
        const lines = [
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1,"cache_read_input_tokens":20,"cache_creation_input_tokens":30}}}',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}',
          'event: message_stop\ndata: {"type":"message_stop"}',
          "",
        ].join("\n\n");
        return new Response(lines, { headers: { "content-type": "text/event-stream" } });
      },
    });
    servers.push(server);

    const provider = createAnthropic(
      runtime(`http://127.0.0.1:${server.port}`, { protocol: "anthropic-messages" }),
    );
    const events = await collect(
      provider.stream({ ...request(), reasoning: "high" }, new AbortController().signal),
    );

    expect(events).toEqual([
      { type: "text", delta: "Hi" },
      {
        type: "provider_data",
        data: { kind: "anthropic", blocks: [{ type: "text", text: "Hi" }] },
      },
      { type: "usage", input: 60, output: 3, cached: 20, cacheWrite: 30 },
      { type: "done", reason: "end" },
    ]);
    expect(body.system).toEqual([
      { type: "text", text: "system", cache_control: { type: "ephemeral" } },
    ]);
    expect(body.max_tokens).toBe(100);
  });

  test("groups tool results into a user turn", async () => {
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
      runtime(`http://127.0.0.1:${server.port}`, { protocol: "anthropic-messages" }),
    );
    const messages: ModelRequest["messages"] = [
      { role: "user", content: "check" },
      {
        role: "assistant",
        content: "reading",
        reasoning: "",
        toolCalls: [{ id: "tool-1", name: "read", args: { path: "a.ts" } }],
      },
      { role: "tool", toolCallId: "tool-1", name: "read", content: "contents" },
      { role: "tool", toolCallId: "tool-2", name: "read", content: "more" },
    ];
    await collect(provider.stream({ ...request(), messages }, new AbortController().signal));

    const converted = body.messages as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    expect(converted.map((entry) => entry.role)).toEqual(["user", "assistant", "user"]);
    expect(converted[2]?.content).toHaveLength(2);
    expect(converted[2]?.content[0]?.type).toBe("tool_result");
  });
});

describe("thinking guards", () => {
  test("does not send reasoning parameters to a non-reasoning model", async () => {
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
      runtime(`http://127.0.0.1:${server.port}/v1`, {
        models: { "embed-1": { name: "Embed 1", reasoning: false } },
      }),
    );
    await collect(
      provider.stream(
        { ...request(), model: "embed-1", reasoning: "high" },
        new AbortController().signal,
      ),
    );
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  test("uses budget thinking for Claude 3.7", async () => {
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
      runtime(`http://127.0.0.1:${server.port}`, { protocol: "anthropic-messages" }, "anthropic"),
    );
    await collect(
      provider.stream(
        { ...request(), model: "claude-3-7-sonnet-20250219", reasoning: "high", maxTokens: 32_000 },
        new AbortController().signal,
      ),
    );
    expect((body.thinking as Record<string, unknown>).type).toBe("enabled");
  });
});
