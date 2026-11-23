import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAnthropic } from "../../src/providers/anthropic";
import { resetCatalogCache } from "../../src/providers/catalog";
import { discoverProvider } from "../../src/providers/discovery";
import { createGemini } from "../../src/providers/gemini";
import { createOpenAiChat } from "../../src/providers/openai-chat";
import { createOpenAiResponses } from "../../src/providers/openai-responses";
import { TransportError } from "../../src/providers/transport";
import { delegate } from "../../src/twin/inference-core";
import { collect, request } from "../helpers/provider-adapters";
import { runtime } from "../helpers/runtime";

const servers: Array<ReturnType<typeof Bun.serve>> = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const s of servers.splice(0)) s.stop(true);
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

function serve(handler: (req: Request) => Response | Promise<Response>): string {
  const s = Bun.serve({ port: 0, fetch: handler });
  servers.push(s);
  return `http://127.0.0.1:${s.port}`;
}

function sse(frames: unknown[], done = true): Response {
  const lines = frames.map((f) => (typeof f === "string" ? f : `data: ${JSON.stringify(f)}`));
  if (done) lines.push("data: [DONE]");
  return new Response(`${lines.join("\n\n")}\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("Request parameters across all 4 protocol adapters", () => {
  test("omits tool_choice, parallel_tool_calls, and custom prompt_cache_key when tools are empty", async () => {
    const captured: Record<string, Record<string, unknown>> = {};
    const base = serve(async (req) => {
      const path = new URL(req.url).pathname;
      captured[path] = (await req.json()) as Record<string, unknown>;
      if (path.includes("/messages")) {
        return sse(
          [
            'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
            'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
            'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}',
            'event: message_stop\ndata: {"type":"message_stop"}',
          ],
          false,
        );
      }
      if (path.includes("/responses")) {
        return sse(
          [
            'data: {"type":"response.output_text.delta","delta":"ok"}',
            'data: {"type":"response.completed","response":{"status":"completed","output":[]}}',
          ],
          false,
        );
      }
      if (path.includes(":streamGenerateContent")) {
        return sse(
          [{ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] }],
          false,
        );
      }
      return sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]);
    });

    const req = {
      ...request(),
      tools: [],
      toolChoice: "none" as const,
      parallelToolCalls: true,
      promptCacheKey: "flecten:s_test",
    };

    await collect(
      createOpenAiChat(runtime(`${base}/v1`, {}, "custom")).stream(
        req,
        new AbortController().signal,
      ),
    );
    await collect(
      createOpenAiResponses(
        runtime(`${base}/v1`, { protocol: "openai-responses" }, "custom"),
      ).stream(req, new AbortController().signal),
    );
    await collect(
      createAnthropic(runtime(base, { protocol: "anthropic-messages" }, "custom")).stream(
        req,
        new AbortController().signal,
      ),
    );
    await collect(
      createGemini(runtime(`${base}/v1beta`, { protocol: "gemini" }, "custom")).stream(
        req,
        new AbortController().signal,
      ),
    );

    expect(captured["/v1/chat/completions"]?.tool_choice).toBeUndefined();
    expect(captured["/v1/chat/completions"]?.parallel_tool_calls).toBeUndefined();
    expect(captured["/v1/chat/completions"]?.prompt_cache_key).toBeUndefined();
    expect(captured["/v1/responses"]?.tool_choice).toBeUndefined();
    expect(captured["/v1/responses"]?.parallel_tool_calls).toBeUndefined();
    expect(captured["/v1/responses"]?.prompt_cache_key).toBeUndefined();
    expect(captured["/v1/messages"]?.tool_choice).toBeUndefined();
    const geminiPath = Object.keys(captured).find((p) => p.includes(":streamGenerateContent"));
    expect(geminiPath).toBeDefined();
    expect(geminiPath ? captured[geminiPath]?.toolConfig : undefined).toBeUndefined();
  });

  test("Anthropic respects reasoning: false and strips unsigned thinking on replay", async () => {
    let sentBody: Record<string, unknown> = {};
    const base = serve(async (req) => {
      sentBody = (await req.json()) as Record<string, unknown>;
      return sse(
        [
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"ok"}}',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}',
          'event: message_stop\ndata: {"type":"message_stop"}',
        ],
        false,
      );
    });

    const rt = runtime(base, {
      protocol: "anthropic-messages",
      models: { "claude-fable-5": { name: "Fable", reasoning: false } },
    });
    await collect(
      createAnthropic(rt).stream(
        {
          ...request(),
          model: "claude-fable-5",
          reasoning: "high",
          messages: [
            { role: "user", content: "hi" },
            {
              role: "assistant",
              content: "",
              reasoning: "unsign",
              toolCalls: [{ id: "t0", name: "read", args: { path: "x.ts" } }],
              providerData: {
                kind: "anthropic",
                blocks: [
                  { type: "thinking", thinking: "unsign", signature: "" },
                  { type: "tool_use", id: "t0", name: "read", input: { path: "x.ts" } },
                ],
              },
            },
            { role: "tool", toolCallId: "t0", name: "read", content: "ok" },
          ],
        },
        new AbortController().signal,
      ),
    );
    expect(sentBody.thinking).toBeUndefined();
    const asst = (
      sentBody.messages as Array<{ role: string; content: Array<{ type: string }> }>
    )[1];
    expect(asst?.content.some((b) => b.type === "thinking")).toBe(false);
  });
});

describe("Discovery URL normalization, metadata extraction, and filtering", () => {
  test("normalizes pasted /chat/completions and Anthropic /v1 URLs, parses proxy pricing/caps, and filters non-chat models", async () => {
    const paths: string[] = [];
    const base = serve((req) => {
      const p = new URL(req.url).pathname;
      paths.push(p);
      if (p === "/v1/models") {
        return Response.json({
          data: [
            {
              id: "kimi-k3.1-pro",
              context_length: 200_000,
              max_output_tokens: 1_048_576,
              supports_thinking: true,
              supports_vision: true,
              supports_tool_use: true,
              supportsPromptCache: true,
              pricing: {
                price_input_per_1m_usd: 0.6,
                price_output_per_1m_usd: 2.5,
                price_cache_read_per_1m_usd: 0.1,
              },
            },
            { id: "Veo-3.1-Fast" },
            { id: "Nano-Banana-2" },
            { id: "gemini-3.1-flash-image" },
            { id: "Qwen3-Embedding-4B" },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    });

    const cwd = await mkdtemp(join(tmpdir(), "flecten-disc-compat-"));
    dirs.push(cwd);
    resetCatalogCache();

    const openAi = await discoverProvider(cwd, {
      protocol: "openai-chat",
      baseUrl: `${base}/v1/chat/completions`,
    });
    expect(openAi.baseUrl).toBe(`${base}/v1`);
    expect(Object.keys(openAi.models)).toEqual(["kimi-k3.1-pro"]);
    expect(openAi.models["kimi-k3.1-pro"]).toMatchObject({
      context: 200_000,
      output: 200_000,
      reasoning: true,
      vision: true,
      tools: true,
      promptCache: true,
      cost: { input: 0.6, output: 2.5, cacheRead: 0.1 },
    });

    const anth = await discoverProvider(cwd, {
      protocol: "anthropic-messages",
      baseUrl: `${base}/v1`,
    });
    expect(paths).not.toContain("/v1/v1/models");
    expect(Object.keys(anth.models)).toEqual(["kimi-k3.1-pro"]);
  });
});

describe("Twin structured output and 400 fallback", () => {
  test("passes responseFormat without toolChoice:none and falls back on HTTP 400", async () => {
    const seen: Array<{ toolChoice: string | undefined; hasFormat: boolean }> = [];
    const decision = await delegate(
      {
        providerId: "test",
        model: "m1",
        price: () => undefined,
        provider: {
          id: "test",
          model: "m1",
          async *stream(req) {
            seen.push({ toolChoice: req.toolChoice, hasFormat: Boolean(req.responseFormat) });
            if (req.responseFormat) {
              throw new TransportError("unsupported response_format", {
                reason: "http",
                status: 400,
              });
            }
            yield {
              type: "text",
              delta: JSON.stringify({
                verdict: "pass",
                voice: "ok",
                instructions: "",
                entryIds: [],
                emotion: "calm",
              }),
            };
            yield { type: "done", reason: "end" };
          },
        },
      },
      { phase: "final", userMessages: ["hi"], task: "t", directive: "d", evidence: [] },
      [],
      new AbortController().signal,
    );
    expect(decision.verdict).toBe("pass");
    expect(seen).toEqual([
      { toolChoice: undefined, hasFormat: true },
      { toolChoice: undefined, hasFormat: false },
    ]);
  });
});
