import { afterEach, describe, expect, test } from "bun:test";
import { createAnthropic } from "../../src/providers/anthropic";
import { createGemini } from "../../src/providers/gemini";
import { createOpenAiChat } from "../../src/providers/openai-chat";
import { createOpenAiResponses } from "../../src/providers/openai-responses";
import type { ModelRequest } from "../../src/providers/types";
import {
  chatDone,
  cleanupProviders,
  collect,
  request,
  serve,
  sse,
} from "../helpers/provider-hardening";
import { runtime } from "../helpers/runtime";

afterEach(cleanupProviders);

describe("strict tools and structured output", () => {
  test("transforms strict tool schemas to require every property", async () => {
    let body: Record<string, unknown> = {};
    const base = serve(async (incoming) => {
      body = (await incoming.json()) as Record<string, unknown>;
      return chatDone();
    });
    const provider = createOpenAiChat(runtime(`${base}/v1`, { strictTools: true }));
    await collect(provider.stream(request(), new AbortController().signal));
    const tools = body.tools as Array<{
      function: { parameters: Record<string, unknown>; strict?: boolean };
    }>;
    const parameters = tools[0]?.function.parameters;
    expect(parameters?.additionalProperties).toBe(false);
    expect(parameters?.required).toEqual(["path", "limit"]);
    expect(tools[0]?.function.strict).toBe(true);
  });

  test("disables strict mode with a warning for unsupported schemas", async () => {
    let body: Record<string, unknown> = {};
    const base = serve(async (incoming) => {
      body = (await incoming.json()) as Record<string, unknown>;
      return chatDone();
    });
    const warnings: string[] = [];
    const provider = createOpenAiChat(runtime(`${base}/v1`, { strictTools: true }), (message) =>
      warnings.push(message),
    );
    const mapped: ModelRequest = {
      ...request(),
      tools: [
        {
          name: "map",
          description: "map",
          parameters: {
            type: "object",
            properties: { values: { type: "object", additionalProperties: { type: "string" } } },
          },
        },
      ],
    };
    await collect(provider.stream(mapped, new AbortController().signal));
    const tools = body.tools as Array<{ function: Record<string, unknown> }>;
    expect(tools[0]?.function.strict).toBeUndefined();
    expect(warnings.join(" ")).toContain("strict tools disabled");
  });

  test("sends response_format json_schema for chat", async () => {
    let body: Record<string, unknown> = {};
    const base = serve(async (incoming) => {
      body = (await incoming.json()) as Record<string, unknown>;
      return chatDone();
    });
    const provider = createOpenAiChat(
      runtime(`${base}/v1`, {
        models: {
          "test-model": {
            name: "Test",
            structuredOutput: {
              name: "answer",
              strict: true,
              schema: {
                type: "object",
                properties: { answer: { type: "string" } },
                required: ["answer"],
              },
            },
          },
        },
      }),
    );
    await collect(provider.stream(request(), new AbortController().signal));
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "answer",
        strict: true,
        schema: {
          type: "object",
          properties: { answer: { type: "string" } },
          required: ["answer"],
          additionalProperties: false,
        },
      },
    });
  });

  test("sends text.format json_schema for responses", async () => {
    let body: Record<string, unknown> = {};
    const base = serve(async (incoming) => {
      body = (await incoming.json()) as Record<string, unknown>;
      return new Response(sse('{"type":"response.completed","response":{"status":"completed"}}'), {
        headers: { "content-type": "text/event-stream" },
      });
    });
    const provider = createOpenAiResponses(
      runtime(`${base}/v1`, {
        protocol: "openai-responses",
        strictTools: true,
        models: {
          "test-model": {
            name: "Test",
            structuredOutput: {
              name: "answer",
              strict: true,
              schema: { type: "object", properties: { answer: { type: "string" } } },
            },
          },
        },
      }),
    );
    await collect(provider.stream(request(), new AbortController().signal));
    expect(body.text).toEqual({
      format: {
        type: "json_schema",
        name: "answer",
        strict: true,
        schema: {
          type: "object",
          properties: { answer: { type: "string" } },
          required: ["answer"],
          additionalProperties: false,
        },
      },
    });
    const tools = body.tools as Array<{
      strict?: boolean;
      parameters: Record<string, unknown>;
    }>;
    expect(tools[0]?.strict).toBe(true);
    expect(tools[0]?.parameters.required).toEqual(["path", "limit"]);
  });
});

function anthropicEmpty(): Response {
  return new Response(
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
    { headers: { "content-type": "text/event-stream" } },
  );
}

function geminiDone(): Response {
  return new Response(sse('{"candidates":[{"content":{"parts":[]},"finishReason":"STOP"}]}'), {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("provider strict schemas by protocol", () => {
  test("transforms Anthropic tool and structured output schemas", async () => {
    let body: Record<string, unknown> = {};
    const base = serve(async (incoming) => {
      body = (await incoming.json()) as Record<string, unknown>;
      return anthropicEmpty();
    });
    const provider = createAnthropic(
      runtime(
        base,
        {
          protocol: "anthropic-messages",
          strictTools: true,
          models: {
            "test-model": {
              name: "Test",
              structuredOutput: {
                name: "answer",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    answer: { type: "string" },
                    meta: {
                      $ref: "#/$defs/meta",
                    },
                  },
                  $defs: {
                    meta: {
                      type: "object",
                      properties: { score: { type: "number" } },
                    },
                  },
                },
              },
            },
          },
        },
        "anthropic",
      ),
    );
    await collect(provider.stream(request(), new AbortController().signal));

    const tools = body.tools as Array<{
      input_schema: Record<string, unknown>;
      strict?: boolean;
    }>;
    expect(tools[0]?.strict).toBe(true);
    expect(tools[0]?.input_schema.additionalProperties).toBe(false);
    expect(tools[0]?.input_schema.required).toEqual(["path", "limit"]);

    const output = body.output_config as {
      format: { type: string; schema: Record<string, unknown> };
    };
    expect(output.format.type).toBe("json_schema");
    expect(output.format.schema.additionalProperties).toBe(false);
    expect(output.format.schema.required).toEqual(["answer", "meta"]);
  });

  test("inlines refs and strips unsupported keys for Anthropic tools", async () => {
    let body: Record<string, unknown> = {};
    const base = serve(async (incoming) => {
      body = (await incoming.json()) as Record<string, unknown>;
      return anthropicEmpty();
    });
    const provider = createAnthropic(
      runtime(base, { protocol: "anthropic-messages" }, "anthropic"),
    );
    const mapped: ModelRequest = {
      ...request(),
      tools: [
        {
          name: "map",
          description: "map",
          parameters: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            properties: { item: { $ref: "#/$defs/item" } },
            $defs: {
              item: { type: "object", properties: { name: { type: "string" } } },
            },
          },
        },
      ],
    };
    await collect(provider.stream(mapped, new AbortController().signal));
    const tools = body.tools as Array<{ input_schema: Record<string, unknown> }>;
    const schema = tools[0]?.input_schema as {
      $schema?: unknown;
      $defs?: unknown;
      properties: { item: Record<string, unknown> };
    };
    expect(schema.$schema).toBeUndefined();
    expect(schema.$defs).toBeUndefined();
    expect(schema.properties.item.type).toBe("object");
  });

  test("transforms Gemini tool and structured output schemas", async () => {
    let body: Record<string, unknown> = {};
    const base = serve(async (incoming) => {
      body = (await incoming.json()) as Record<string, unknown>;
      return geminiDone();
    });
    const provider = createGemini(
      runtime(
        `${base}/v1beta`,
        {
          protocol: "gemini",
          models: {
            "test-model": {
              name: "Test",
              structuredOutput: {
                name: "answer",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    answer: { type: "string" },
                    meta: { $ref: "#/$defs/meta" },
                    tags: { type: ["string", "null"] },
                    list: { oneOf: [{ type: "string" }, { type: "number" }] },
                    extra: { type: "object", additionalProperties: { type: "string" } },
                  },
                  $defs: {
                    meta: { type: "object", properties: { score: { type: "number" } } },
                  },
                },
              },
            },
          },
        },
        "google",
      ),
    );
    await collect(provider.stream(request(), new AbortController().signal));

    const declarations = (
      body.tools as Array<{ functionDeclarations: Array<{ parameters: Record<string, unknown> }> }>
    )[0]?.functionDeclarations;
    expect(declarations?.[0]?.parameters.additionalProperties).toBeUndefined();
    expect(declarations?.[0]?.parameters.required).toEqual(["path"]);

    const config = body.generationConfig as {
      responseMimeType: string;
      responseSchema: Record<string, unknown>;
    };
    expect(config.responseMimeType).toBe("application/json");
    const properties = config.responseSchema.properties as Record<string, Record<string, unknown>>;
    expect(config.responseSchema.$defs).toBeUndefined();
    expect(properties.meta?.type).toBe("object");
    const meta = properties.meta as { properties: Record<string, { type?: string }> };
    expect(meta.properties.score?.type).toBe("number");
    expect(properties.tags?.type).toBe("string");
    expect(properties.tags?.nullable).toBe(true);
    expect(properties.list?.anyOf).toBeDefined();
    expect(properties.list?.oneOf).toBeUndefined();
    expect(properties.extra?.additionalProperties).toBeUndefined();
  });
});
