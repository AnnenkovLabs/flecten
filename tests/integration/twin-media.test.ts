import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTwin } from "../../src/app/twin";
import { HarnessConfigSchema } from "../../src/config/schema";
import type { ModelProvider, ModelRequest } from "../../src/providers/types";

test.each([true, false])(
  "Twin shares the Worker's explicit vision override (%s), keeping image bytes out of text",
  async (vision) => {
    const cwd = await mkdtemp(join(tmpdir(), "twin-vision-"));
    const requests: ModelRequest[] = [];
    const config = HarnessConfigSchema.parse({
      useDefaults: false,
      provider: "test",
      model: "test",
      providers: {
        test: {
          protocol: "openai-chat",
          baseUrl: "https://example.test/v1",
          models: { test: { modalities: { input: ["text", "image"] }, vision } },
        },
      },
    });
    const provider: ModelProvider = {
      id: "test",
      model: "test",
      async *stream(request) {
        requests.push(request);
        yield {
          type: "text",
          delta: JSON.stringify({
            verdict: "pass",
            voice: "Один экран, как я и просил.",
            instructions: "",
            entryIds: [],
            emotion: "pleased",
          }),
        };
        yield { type: "usage", input: 10, output: 5, cached: 0 };
        yield { type: "done", reason: "end" };
      },
    };
    const twin = await createTwin(cwd, { config: () => config, provider: () => provider });
    try {
      await twin.configure({ enabled: true });
      const pixels =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
      await twin.delegate(
        {
          phase: "final",
          userMessages: ["Один экран"],
          task: "Checkout",
          directive: "",
          evidence: [],
          images: [{ mediaType: "image/png", data: pixels }],
        },
        new AbortController().signal,
      );
      const input = requests[0]?.messages[0];
      if (input?.role !== "user") throw new Error("Missing Twin review input");
      expect(input.images?.length ?? 0).toBe(vision ? 1 : 0);
      expect(input.content).not.toContain(pixels);
      if (!vision) expect(input.content).toContain("Their pixels were not inspected");
    } finally {
      await twin.dispose();
      await rm(cwd, { recursive: true, force: true });
    }
  },
);
