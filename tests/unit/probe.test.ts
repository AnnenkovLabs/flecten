import { afterEach, describe, expect, test } from "bun:test";
import { ProviderConfigSchema } from "../../src/config/schema";
import { probeModel } from "../../src/providers/probe";

const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

describe("capability probe", () => {
  test("verifies text, tools and reasoning", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as {
          tools?: unknown[];
          tool_choice?: string;
          messages?: Array<{ content?: string }>;
        };
        const isTool =
          Array.isArray(body.tools) && body.tools.length > 0 && body.tool_choice === "required";
        const isReasoning = body.messages?.some((message) =>
          String(message.content ?? "").includes("17 * 23"),
        );
        if (isTool) {
          const events = [
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read","arguments":"{\\"path\\":\\"package.json\\"}"}}]},"finish_reason":"tool_calls"}]}',
            "data: [DONE]",
            "",
          ].join("\n\n");
          return new Response(events, { headers: { "content-type": "text/event-stream" } });
        }
        if (isReasoning) {
          const events = [
            'data: {"choices":[{"delta":{"reasoning_content":"17 * 23 = 391"}}]}',
            'data: {"choices":[{"delta":{"content":"391"},"finish_reason":"stop"}]}',
            "data: [DONE]",
            "",
          ].join("\n\n");
          return new Response(events, { headers: { "content-type": "text/event-stream" } });
        }
        const events = [
          'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}',
          "data: [DONE]",
          "",
        ].join("\n\n");
        return new Response(events, { headers: { "content-type": "text/event-stream" } });
      },
    });
    servers.push(server);
    const definition = ProviderConfigSchema.parse({
      protocol: "openai-chat",
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      models: {
        "test-model": {
          name: "Test",
          tools: true,
          reasoning: true,
          reasoningLevels: ["low", "high"],
        },
      },
    });
    const result = await probeModel(definition, "test-model");
    expect(result.text).toBe(true);
    expect(result.tools).toBe(true);
    expect(result.reasoning).toBe(true);
  });
});
