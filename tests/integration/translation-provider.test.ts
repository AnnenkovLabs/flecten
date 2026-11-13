import { expect, test } from "bun:test";
import { translationOptions } from "../../src/app/translation";
import { HarnessConfigSchema } from "../../src/config/schema";

test("configured translator uses its real adapter, model, price, cache and zero retries", async () => {
  const requests: Record<string, unknown>[] = [];
  let fail = false;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      expect(request.headers.get("x-translation-test")).toBe("configured");
      requests.push((await request.json()) as Record<string, unknown>);
      if (fail) return new Response("unavailable", { status: 503 });
      const result = { sourceLanguage: "ru", allEnglish: false, texts: ["Fix it."] };
      const frames = [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "t",
                    type: "function",
                    function: { name: "translation_result", arguments: JSON.stringify(result) },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [{ delta: {}, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        },
      ];
      return new Response(
        `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  try {
    const config = HarnessConfigSchema.parse({
      useDefaults: false,
      provider: "test",
      model: "worker",
      maxOutputTokens: 0,
      providers: {
        test: {
          protocol: "openai-chat",
          baseUrl: `http://127.0.0.1:${server.port}/v1`,
          headers: { "x-translation-test": "configured" },
          transport: { retries: 3 },
          models: {
            worker: { tools: true },
            translator: {
              tools: true,
              reasoning: false,
              output: 512,
              cost: { input: 1, output: 2 },
            },
          },
        },
      },
      translation: { enabled: true, provider: "test", model: "translator" },
    });
    const select = translationOptions();
    const language = select(config);
    expect(language).toBeDefined();
    if (!language) throw new Error("Missing translator");
    let cost = 0;
    const signal = new AbortController().signal;
    expect(
      (
        await language.client.translate("Почини.", "en", signal, ({ usage }) => {
          cost += language.price(usage) ?? 0;
        })
      ).text,
    ).toBe("Fix it.");
    expect(cost).toBeCloseTo(0.00004);
    expect(requests[0]).toMatchObject({
      model: "translator",
      tool_choice: "required",
      max_tokens: 512,
    });
    expect(
      ((requests[0]?.tools ?? []) as Array<{ function: { name: string } }>).map(
        (tool) => tool.function.name,
      ),
    ).toEqual(["translation_result"]);
    expect(select(config)?.client).toBe(language.client);
    await language.client.translate("Почини.", "en", signal, () => {
      throw new Error("Cache miss");
    });
    expect(requests).toHaveLength(1);
    fail = true;
    await expect(
      language.client.translate("Другая задача.", "en", signal, () => {}),
    ).rejects.toThrow();
    expect(requests).toHaveLength(2);
    config.translation = undefined;
    expect(select(config)).toBeUndefined();
  } finally {
    server.stop(true);
  }
});
