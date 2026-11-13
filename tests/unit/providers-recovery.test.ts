import { afterEach, describe, expect, test } from "bun:test";
import { HarnessError } from "../../src/errors";
import { createAnthropic } from "../../src/providers/anthropic";
import { createGemini } from "../../src/providers/gemini";
import { createOpenAiChat } from "../../src/providers/openai-chat";
import { createOpenAiResponses } from "../../src/providers/openai-responses";
import type { ModelEvent, ModelRequest } from "../../src/providers/types";
import { runtime } from "../helpers/runtime";

const servers: Array<ReturnType<typeof Bun.serve>> = [];

function request(): ModelRequest {
  return {
    model: "test-model",
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
  };
}

async function collect(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const output: ModelEvent[] = [];
  for await (const event of events) output.push(event);
  return output;
}

async function failure(run: () => Promise<unknown>): Promise<HarnessError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof HarnessError) return error;
    throw error;
  }
  throw new Error("expected a HarnessError");
}

function serve(body: string | ReadableStream<Uint8Array>): string {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    },
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function sse(...events: string[]): string {
  return events.map((event) => `${event}\n\n`).join("");
}

function data(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}`;
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

describe("openai chat recovery", () => {
  test("clean stream ends with a done event", async () => {
    const url = serve(
      sse(
        data({ choices: [{ delta: { content: "Hi" } }] }),
        data({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        "data: [DONE]",
      ),
    );
    const provider = createOpenAiChat(runtime(`${url}/v1`));
    const events = await collect(provider.stream(request(), new AbortController().signal));

    expect(events.at(-1)).toEqual({ type: "done", reason: "end" });
  });

  test("EOF without [DONE] is a provider failure", async () => {
    const url = serve(streamOf([sse(data({ choices: [{ delta: { content: "partial" } }] }))]));
    const provider = createOpenAiChat(runtime(`${url}/v1`));
    const error = await failure(() =>
      collect(provider.stream(request(), new AbortController().signal)),
    );

    expect(error.code).toBe("provider_failed");
    expect(error.message).toContain("incomplete");
    expect(error.message).toContain("[DONE]");
  });

  test("length with tool calls stays max_tokens", async () => {
    const url = serve(
      sse(
        data({
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
              finish_reason: "length",
            },
          ],
        }),
        "data: [DONE]",
      ),
    );
    const provider = createOpenAiChat(runtime(`${url}/v1`));
    const events = await collect(provider.stream(request(), new AbortController().signal));

    expect(events.some((event) => event.type === "tool_call")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done", reason: "max_tokens" });
  });

  test("content filter refuses the stream", async () => {
    const url = serve(
      sse(
        data({
          choices: [{ delta: { content: "blocked" }, finish_reason: "content_filter" }],
        }),
        "data: [DONE]",
      ),
    );
    const provider = createOpenAiChat(runtime(`${url}/v1`));
    const error = await failure(() =>
      collect(provider.stream(request(), new AbortController().signal)),
    );

    expect(error.code).toBe("provider_failed");
    expect(error.message).toContain("content_filter");
  });
});

describe("openai responses recovery", () => {
  test("clean stream ends with a done event", async () => {
    const url = serve(
      sse(
        `event: response.output_text.delta\n${data({
          type: "response.output_text.delta",
          delta: "Hi",
        })}`,
        `event: response.completed\n${data({
          type: "response.completed",
          response: { status: "completed" },
        })}`,
      ),
    );
    const provider = createOpenAiResponses(runtime(`${url}/v1`, { protocol: "openai-responses" }));
    const events = await collect(provider.stream(request(), new AbortController().signal));

    expect(events.at(-1)).toEqual({ type: "done", reason: "end" });
  });

  test("incomplete max_output_tokens maps to max_tokens", async () => {
    const url = serve(
      sse(
        `event: response.incomplete\n${data({
          type: "response.incomplete",
          response: {
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
          },
        })}`,
      ),
    );
    const provider = createOpenAiResponses(runtime(`${url}/v1`, { protocol: "openai-responses" }));
    const events = await collect(provider.stream(request(), new AbortController().signal));

    expect(events.at(-1)).toEqual({ type: "done", reason: "max_tokens" });
  });

  test("EOF without a terminal response event is a provider failure", async () => {
    const url = serve(
      streamOf([
        sse(
          `event: response.output_text.delta\n${data({
            type: "response.output_text.delta",
            delta: "partial",
          })}`,
        ),
      ]),
    );
    const provider = createOpenAiResponses(runtime(`${url}/v1`, { protocol: "openai-responses" }));
    const error = await failure(() =>
      collect(provider.stream(request(), new AbortController().signal)),
    );

    expect(error.code).toBe("provider_failed");
    expect(error.message).toContain("incomplete");
    expect(error.message).toContain("response.completed");
  });
});

describe("anthropic recovery", () => {
  test("message_stop completes the stream", async () => {
    const url = serve(
      sse(
        `event: message_start\n${data({ type: "message_start", message: { usage: {} } })}`,
        `event: message_delta\n${data({
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
        })}`,
        `event: message_stop\n${data({ type: "message_stop" })}`,
      ),
    );
    const provider = createAnthropic(runtime(url, { protocol: "anthropic-messages" }));
    const events = await collect(provider.stream(request(), new AbortController().signal));

    expect(events.at(-1)).toEqual({ type: "done", reason: "end" });
  });

  test("max_tokens wins over tool calls", async () => {
    const url = serve(
      sse(
        `event: message_start\n${data({ type: "message_start", message: { usage: {} } })}`,
        `event: content_block_start\n${data({
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tool-1", name: "read", input: {} },
        })}`,
        `event: content_block_stop\n${data({ type: "content_block_stop", index: 0 })}`,
        `event: message_delta\n${data({
          type: "message_delta",
          delta: { stop_reason: "max_tokens" },
        })}`,
        `event: message_stop\n${data({ type: "message_stop" })}`,
      ),
    );
    const provider = createAnthropic(runtime(url, { protocol: "anthropic-messages" }));
    const events = await collect(provider.stream(request(), new AbortController().signal));

    expect(events.some((event) => event.type === "tool_call")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done", reason: "max_tokens" });
  });

  test("EOF before message_stop is a provider failure", async () => {
    const url = serve(
      streamOf([
        sse(
          `event: message_start\n${data({ type: "message_start", message: { usage: {} } })}`,
          `event: content_block_start\n${data({
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          })}`,
          `event: content_block_delta\n${data({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "partial" },
          })}`,
        ),
      ]),
    );
    const provider = createAnthropic(runtime(url, { protocol: "anthropic-messages" }));
    const error = await failure(() =>
      collect(provider.stream(request(), new AbortController().signal)),
    );

    expect(error.code).toBe("provider_failed");
    expect(error.message).toContain("incomplete");
    expect(error.message).toContain("message_stop");
  });

  test("refusal stops the stream without a done event", async () => {
    const url = serve(
      sse(
        `event: message_start\n${data({ type: "message_start", message: { usage: {} } })}`,
        `event: message_delta\n${data({
          type: "message_delta",
          delta: { stop_reason: "refusal" },
        })}`,
        `event: message_stop\n${data({ type: "message_stop" })}`,
      ),
    );
    const provider = createAnthropic(runtime(url, { protocol: "anthropic-messages" }));
    const error = await failure(() =>
      collect(provider.stream(request(), new AbortController().signal)),
    );

    expect(error.code).toBe("provider_failed");
    expect(error.message).toContain("refusal");
  });
});

describe("gemini recovery", () => {
  test("finishReason completes the stream", async () => {
    const url = serve(
      sse(
        data({
          candidates: [{ content: { parts: [{ text: "Hi" }] }, finishReason: "STOP" }],
        }),
      ),
    );
    const provider = createGemini(runtime(`${url}/v1beta`, { protocol: "gemini" }));
    const events = await collect(provider.stream(request(), new AbortController().signal));

    expect(events.at(-1)).toEqual({ type: "done", reason: "end" });
  });

  test("MAX_TOKENS maps to max_tokens", async () => {
    const url = serve(
      sse(
        data({
          candidates: [{ content: { parts: [{ text: "cut" }] }, finishReason: "MAX_TOKENS" }],
        }),
      ),
    );
    const provider = createGemini(runtime(`${url}/v1beta`, { protocol: "gemini" }));
    const events = await collect(provider.stream(request(), new AbortController().signal));

    expect(events.at(-1)).toEqual({ type: "done", reason: "max_tokens" });
  });

  test("SAFETY refuses the stream", async () => {
    const url = serve(
      sse(data({ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] })),
    );
    const provider = createGemini(runtime(`${url}/v1beta`, { protocol: "gemini" }));
    const error = await failure(() =>
      collect(provider.stream(request(), new AbortController().signal)),
    );

    expect(error.code).toBe("provider_failed");
    expect(error.message).toContain("safety");
  });

  test("EOF without finishReason is a provider failure", async () => {
    const url = serve(
      streamOf([sse(data({ candidates: [{ content: { parts: [{ text: "partial" }] } }] }))]),
    );
    const provider = createGemini(runtime(`${url}/v1beta`, { protocol: "gemini" }));
    const error = await failure(() =>
      collect(provider.stream(request(), new AbortController().signal)),
    );

    expect(error.code).toBe("provider_failed");
    expect(error.message).toContain("incomplete");
    expect(error.message).toContain("finishReason");
  });
});
