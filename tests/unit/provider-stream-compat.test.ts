import { describe, expect, test } from "bun:test";
import { createAnthropic } from "../../src/providers/anthropic";
import { createGemini } from "../../src/providers/gemini";
import { createOpenAiChat } from "../../src/providers/openai-chat";
import { createOpenAiResponses } from "../../src/providers/openai-responses";
import { ProviderResponseError } from "../../src/providers/response";
import { TransportError } from "../../src/providers/transport";
import { collect, request } from "../helpers/provider-adapters";
import { runtime } from "../helpers/runtime";

function sse(frames: unknown[], done = true): Response {
  const lines = frames.map((f) => (typeof f === "string" ? f : `data: ${JSON.stringify(f)}`));
  if (done) lines.push("data: [DONE]");
  return new Response(`${lines.join("\n\n")}\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("OpenAI Chat real-world stream compatibility", () => {
  test("accepts null role/type/name/args, missing tool index, trailing empty choice, and empty function_call stub", async () => {
    const target = runtime("https://offline.invalid/v1");
    target.fetch = async () =>
      sse([
        { choices: [{ delta: { role: "assistant" }, index: 0 }] },
        {
          choices: [
            { delta: { reasoning_content: "", reasoning: "checking file", role: null }, index: 0 },
          ],
        },
        {
          choices: [
            {
              delta: {
                role: null,
                tool_calls: [
                  {
                    id: "call-grok-0",
                    type: "function",
                    function: { name: "read", arguments: null },
                  },
                ],
              },
              index: 0,
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                role: null,
                tool_calls: [
                  {
                    id: "call-grok-0",
                    type: null,
                    function: { name: null, arguments: '{"path":"hello.ts"}' },
                  },
                ],
              },
              index: 0,
            },
          ],
        },
        {
          choices: [
            {
              delta: { function_call: { name: "", arguments: "" }, role: "assistant" },
              finish_reason: "tool_calls",
              index: 0,
            },
          ],
        },
        { choices: [{ index: 0 }] },
        { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } },
      ]);
    const events = await collect(
      createOpenAiChat(target).stream(request(), new AbortController().signal),
    );
    expect(events).toContainEqual({ type: "reasoning", delta: "checking file" });
    expect(events).toContainEqual({
      type: "tool_call",
      id: "call-grok-0",
      name: "read",
      args: { path: "hello.ts" },
    });
    expect(events.at(-1)).toMatchObject({ type: "done", reason: "tool_use" });
  });

  test("separates parallel tool calls that reuse index 0 with distinct ids and avoids duplicating tool names", async () => {
    const target = runtime("https://offline.invalid/v1");
    target.fetch = async () =>
      sse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_a",
                    type: "function",
                    function: { name: "read", arguments: '{"path":' },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_a",
                    type: "function",
                    function: { name: "read", arguments: '"a.ts"}' },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_b",
                    type: "function",
                    function: { name: "read", arguments: '{"path":"b.ts"}' },
                  },
                ],
              },
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ]);
    const events = await collect(
      createOpenAiChat(target).stream(request(), new AbortController().signal),
    );
    expect(events.filter((e) => e.type === "tool_call")).toEqual([
      { type: "tool_call", id: "call_a", name: "read", args: { path: "a.ts" } },
      { type: "tool_call", id: "call_b", name: "read", args: { path: "b.ts" } },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "done", reason: "tool_use" });
  });

  test("preserves real provider error message from in-stream error chunk without misreporting missing [DONE]", async () => {
    const target = runtime("https://offline.invalid/v1");
    target.fetch = async () =>
      sse([
        {
          error: {
            code: "upstream_error",
            message: "Upstream temporarily overloaded",
            type: "upstream_error",
          },
        },
      ]);
    const caught = await collect(
      createOpenAiChat(target).stream(request(), new AbortController().signal),
    ).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ProviderResponseError);
    expect((caught as ProviderResponseError).message).toContain("Upstream temporarily overloaded");
    expect((caught as ProviderResponseError).message).not.toContain("missing [DONE]");
    expect((caught as ProviderResponseError).response.outcome).toBe("provider_error");
    expect((caught as ProviderResponseError).kind).toBe("server");
  });

  test("catches HTTP 200 JSON error bodies before SSE parsing", async () => {
    const target = runtime("https://offline.invalid/v1");
    target.fetch = async () =>
      new Response(
        JSON.stringify({ error: { type: "invalid_request_error", message: "Bad model" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const caught = await collect(
      createOpenAiChat(target).stream(request(), new AbortController().signal),
    ).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(TransportError);
    expect((caught as TransportError).message).toContain("Bad model");
    expect((caught as TransportError).retryable).toBe(false);
  });
});

describe("Anthropic, Responses, and Gemini stream edge cases", () => {
  test("OpenAI Responses reads terminal.output items when output_item.done is omitted and ignores empty usage", async () => {
    const target = runtime("https://offline.invalid/v1", { protocol: "openai-responses" });
    target.fetch = async () =>
      sse(
        [
          {
            type: "response.completed",
            response: {
              status: "completed",
              usage: {},
              output: [
                {
                  type: "function_call",
                  call_id: "call_end",
                  name: "read",
                  arguments: '{"path":"a.ts"}',
                },
              ],
            },
          },
        ],
        false,
      );
    const events = await collect(
      createOpenAiResponses(target).stream(request(), new AbortController().signal),
    );
    expect(events).toContainEqual({
      type: "tool_call",
      id: "call_end",
      name: "read",
      args: { path: "a.ts" },
    });
    expect(events.some((e) => e.type === "usage")).toBe(false);
  });

  test("Gemini preserves functionCall.id and rejects MALFORMED_FUNCTION_CALL", async () => {
    const target = runtime("https://offline.invalid/v1beta", { protocol: "gemini" });
    target.fetch = async () =>
      sse(
        [
          {
            candidates: [
              {
                content: {
                  parts: [
                    { functionCall: { id: "g_call_9", name: "read", args: { path: "a.ts" } } },
                  ],
                },
                finishReason: "STOP",
              },
            ],
          },
        ],
        false,
      );
    const events = await collect(
      createGemini(target).stream(request(), new AbortController().signal),
    );
    expect(events).toContainEqual({
      type: "tool_call",
      id: "g_call_9",
      name: "read",
      args: { path: "a.ts" },
    });

    target.fetch = async () =>
      sse(
        [{ candidates: [{ content: { parts: [] }, finishReason: "MALFORMED_FUNCTION_CALL" }] }],
        false,
      );
    await expect(
      collect(createGemini(target).stream(request(), new AbortController().signal)),
    ).rejects.toThrow("MALFORMED_FUNCTION_CALL");
  });

  test("Anthropic handles missing delta index and flushes unstopped tool_use on tool_use stop", async () => {
    const target = runtime("https://offline.invalid", { protocol: "anthropic-messages" });
    target.fetch = async () =>
      sse(
        [
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_1","name":"read","input":{}}}',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a.ts\\"}"}}',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":10}}',
          'event: message_stop\ndata: {"type":"message_stop"}',
        ],
        false,
      );
    const events = await collect(
      createAnthropic(target).stream(request(), new AbortController().signal),
    );
    expect(events).toContainEqual({
      type: "tool_call",
      id: "tu_1",
      name: "read",
      args: { path: "a.ts" },
    });
  });
});
