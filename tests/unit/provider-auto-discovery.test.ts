import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanProviderBaseUrl, type ProtocolHint } from "../../shared/provider-url";
import { HarnessConfigSchema } from "../../src/config/schema";
import { resetCatalogCache } from "../../src/providers/catalog";
import { discoverProvider } from "../../src/providers/discovery";
import { createProvider } from "../../src/providers/registry";
import { collect, request } from "../helpers/provider-adapters";

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

describe("ultra-smart base URL cleaner", () => {
  const cases: Array<[string, string, ProtocolHint | undefined]> = [
    ["api.claudehub.fun", "https://api.claudehub.fun", undefined],
    ["API.CLAUDEHUB.FUN///v1///", "https://api.claudehub.fun/v1", undefined],
    ["https://api.samp.team/v1/chat/completions", "https://api.samp.team/v1", "openai-chat"],
    [
      'curl https://api.samp.team/v1/chat/completions -H "Authorization: Bearer sk-123"',
      "https://api.samp.team/v1",
      "openai-chat",
    ],
    [
      "curl -X POST 'https://api.claudehub.fun/v1/messages'",
      "https://api.claudehub.fun/v1",
      "anthropic-messages",
    ],
    [
      'OPENAI_BASE_URL="https://api.openai.com/v1/responses"',
      "https://api.openai.com/v1",
      "openai-responses",
    ],
    [
      "[My API](https://api.claudehub.fun/v1/v1/models?foo=1#bar)",
      "https://api.claudehub.fun/v1",
      undefined,
    ],
    ["localhost:11434/v1/chat/completions", "http://localhost:11434/v1", "openai-chat"],
    ["127.0.0.1:8080", "http://127.0.0.1:8080", undefined],
    ["ttps://api.example.com/v1", "https://api.example.com/v1", undefined],
    ["https:/api.example.com/v1/", "https://api.example.com/v1", undefined],
    [
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse",
      "https://generativelanguage.googleapis.com/v1beta",
      "gemini",
    ],
  ];

  for (const [input, expected, hint] of cases) {
    test(`cleans ${input}`, () => {
      const result = cleanProviderBaseUrl(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.baseUrl).toBe(expected);
        expect(result.hintedProtocol).toBe(hint);
      }
    });
  }

  test("rejects unsupported schemes and non-hosts", () => {
    expect(cleanProviderBaseUrl("ftp://example.com")).toEqual({
      ok: false,
      error: "unsupported_scheme",
    });
    expect(cleanProviderBaseUrl("not-a-url")).toEqual({ ok: false, error: "invalid" });
    expect(cleanProviderBaseUrl("   ")).toEqual({ ok: false, error: "empty" });
  });
});

describe("multi-endpoint auto-discovery and combined provider routing", () => {
  test("combines split OpenAI + Anthropic + Gemini endpoints under one single provider and routes each model to its native endpoint", async () => {
    const hitRoutes: string[] = [];
    const base = serve(async (req) => {
      const url = new URL(req.url);
      const path = url.pathname;
      const isAnthropicAuth = req.headers.has("x-api-key");

      if (req.method === "GET" && path === "/v1/models" && isAnthropicAuth) {
        return Response.json({
          data: [{ id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" }],
        });
      }
      if (req.method === "GET" && path === "/v1/models" && !isAnthropicAuth) {
        return Response.json({
          data: [
            { id: "deepseek-v4-pro", context_length: 128_000, max_output_tokens: 8192 },
            { id: "gpt-6-luna", context_length: 200_000, max_output_tokens: 16_384 },
          ],
        });
      }
      if (req.method === "GET" && path === "/v1beta/models") {
        return Response.json({
          models: [
            {
              name: "models/gemini-2.5-pro",
              displayName: "Gemini 2.5 Pro",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        });
      }

      if (req.method === "POST" && path === "/v1/chat/completions") {
        const body = (await req.json()) as Record<string, unknown>;
        if (!body.model) return new Response("missing model", { status: 400 });
        hitRoutes.push(`chat:${String(body.model)}`);
        return new Response(
          'data: {"choices":[{"delta":{"content":"from-chat"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      if (req.method === "POST" && path === "/v1/messages") {
        const body = (await req.json()) as Record<string, unknown>;
        if (!body.model) return new Response("missing model", { status: 400 });
        hitRoutes.push(`anthropic:${String(body.model)}`);
        const sse = [
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"from-anth"}}',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
          'event: message_stop\ndata: {"type":"message_stop"}',
        ].join("\n\n");
        return new Response(`${sse}\n\n`, { headers: { "content-type": "text/event-stream" } });
      }
      if (req.method === "POST" && path.startsWith("/v1beta/models/")) {
        hitRoutes.push(`gemini:${path}`);
        return new Response(
          'data: {"candidates":[{"content":{"parts":[{"text":"from-gemini"}]},"finishReason":"STOP"}]}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    const cwd = await mkdtemp(join(tmpdir(), "flecten-auto-disc-"));
    dirs.push(cwd);
    resetCatalogCache();

    // User passes messy schemeless/full endpoint URL with protocol: "auto"
    const discovered = await discoverProvider(cwd, {
      protocol: "auto",
      baseUrl: `curl ${base}/v1/chat/completions`,
      apiKey: "sk-test-combined",
    });

    expect(discovered.protocol).toBe("openai-chat");
    expect(discovered.detectedProtocols?.sort()).toEqual([
      "anthropic-messages",
      "gemini",
      "openai-chat",
    ]);
    expect(Object.keys(discovered.models).sort()).toEqual([
      "claude-sonnet-5-5",
      "deepseek-v4-pro",
      "gemini-2.5-pro",
      "gpt-6-luna",
    ]);
    expect(discovered.models["deepseek-v4-pro"]?.protocol).toBeUndefined();
    expect(discovered.models["claude-sonnet-5-5"]?.protocol).toBe("anthropic-messages");
    expect(discovered.models["gemini-2.5-pro"]?.protocol).toBe("gemini");
    expect(discovered.protocolBaseUrls).toMatchObject({
      "openai-chat": `${base}/v1`,
      "anthropic-messages": `${base}/v1`,
      gemini: `${base}/v1beta`,
    });

    // Wire the single discovered provider into the real registry and call all 3 model families!
    const config = HarnessConfigSchema.parse({
      useDefaults: false,
      provider: "unified",
      model: "deepseek-v4-pro",
      providers: {
        unified: {
          protocol: discovered.protocol,
          protocolBaseUrls: discovered.protocolBaseUrls,
          baseUrl: discovered.baseUrl,
          apiKey: "sk-test-combined",
          models: discovered.models,
        },
      },
    });
    const active = createProvider(config, "unified").provider;

    const chatEvents = await collect(
      active.stream(
        { ...request(), model: "deepseek-v4-pro", tools: [] },
        new AbortController().signal,
      ),
    );
    const anthEvents = await collect(
      active.stream(
        { ...request(), model: "claude-sonnet-5-5", tools: [] },
        new AbortController().signal,
      ),
    );
    const geminiEvents = await collect(
      active.stream(
        { ...request(), model: "gemini-2.5-pro", tools: [] },
        new AbortController().signal,
      ),
    );

    expect(chatEvents).toContainEqual({ type: "text", delta: "from-chat" });
    expect(anthEvents).toContainEqual({ type: "text", delta: "from-anth" });
    expect(geminiEvents).toContainEqual({ type: "text", delta: "from-gemini" });
    expect(hitRoutes).toEqual([
      "chat:deepseek-v4-pro",
      "anthropic:claude-sonnet-5-5",
      "gemini:/v1beta/models/gemini-2.5-pro:streamGenerateContent",
    ]);
  });
});
