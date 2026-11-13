import { describe, expect, test } from "bun:test";
import type { CatalogProvider } from "../../src/providers/catalog";
import { findModel, formatModelName } from "../../src/providers/catalog";

describe("model names", () => {
  test("formats ids into readable names", () => {
    expect(formatModelName("glm-5.3-prime")).toBe("GLM 5.3 Prime");
    expect(formatModelName("claude-3.5-haiku")).toBe("Claude 3.5 Haiku");
    expect(formatModelName("claude-sonnet-4-5")).toBe("Claude Sonnet 4.5");
    expect(formatModelName("kimi-k2-6")).toBe("Kimi K2.6");
    expect(formatModelName("deepseek-ai/DeepSeek-V4.1-Flash-1017")).toBe(
      "DeepSeek V4.1 Flash 1017",
    );
    expect(formatModelName("gpt-oss-120b")).toBe("GPT OSS 120B");
  });

  test("finds a model across provider prefixes", () => {
    const catalog: Record<string, CatalogProvider> = {
      demo: {
        id: "demo",
        name: "Demo",
        protocol: "openai-chat",
        baseUrl: "https://example.com/v1",
        source: "models.dev",
        models: {
          "deepseek-ai/DeepSeek-V4.1-Flash-1017": {
            name: "DeepSeek V4.1 Flash 1017",
            context: 1_000_000,
            reasoningLevels: ["low", "high", "max"],
          },
        },
      },
    };
    const found = findModel(catalog, "deepseek-ai/DeepSeek-V4.1-Flash-1017");
    expect(found?.context).toBe(1_000_000);
    expect(findModel(catalog, "sference/deepseek-ai/DeepSeek-V4.1-Flash-1017")?.name).toBe(
      "DeepSeek V4.1 Flash 1017",
    );
  });
});

describe("models.dev metadata", () => {
  test("keeps the provider catalog when a reasoning budget uses automatic or zero minimum", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { loadModelsDev, resetCatalogCache } = await import("../../src/providers/catalog");
    const cwd = await mkdtemp(join(tmpdir(), "liquid-catalog-"));
    try {
      resetCatalogCache();
      const catalog = await loadModelsDev(cwd, true, {
        fetch: Object.assign(
          async () =>
            Response.json({
              nvidia: {
                api: "https://integrate.api.nvidia.com/v1",
                models: Object.fromEntries(
                  [-1, 0, 1024].map((min) => [
                    `budget-${min}`,
                    {
                      reasoning: true,
                      reasoning_options: [{ type: "budget_tokens", min, max: 32768 }],
                    },
                  ]),
                ),
              },
              commandcode: {
                name: "CommandCode",
                api: "https://api.commandcode.ai/provider/v1",
                models: { "command-model": { tool_call: true } },
              },
            }),
          { preconnect: fetch.preconnect },
        ),
      });
      expect(Object.keys(catalog)).toEqual(["nvidia", "commandcode"]);
      expect(Object.keys(catalog.nvidia?.models ?? {})).toHaveLength(3);
      expect(catalog.nvidia?.models["budget--1"]?.reasoningMode).toBe("budget");
      expect(catalog.nvidia?.models["budget--1"]?.reasoningBudget).toBeUndefined();
      expect(catalog.nvidia?.models["budget-0"]?.reasoningBudget).toBeUndefined();
      expect(catalog.nvidia?.models["budget-1024"]?.reasoningBudget).toBe(1024);
    } finally {
      resetCatalogCache();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("maps cost, modalities, knowledge and variants", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { loadModelsDev, resetCatalogCache } = await import("../../src/providers/catalog");
    const cwd = await mkdtemp(join(tmpdir(), "liquid-catalog-"));
    try {
      const cache = join(cwd, ".liquid", "cache");
      await mkdir(cache, { recursive: true });
      await writeFile(
        join(cache, "models-dev.json"),
        JSON.stringify({
          demo: {
            id: "demo",
            name: "Demo",
            api: "https://example.com/v1",
            npm: "@ai-sdk/openai-compatible",
            models: {
              "demo-fast": {
                id: "demo-fast",
                name: "Demo Fast",
                reasoning: true,
                reasoning_options: [{ type: "effort", values: ["low", "high"] }],
                tool_call: true,
                structured_output: true,
                attachment: true,
                modalities: { input: ["text", "image"], output: ["text"] },
                limit: { context: 200_000, input: 180_000, output: 64_000 },
                cost: { input: 1.25, output: 10, cache_read: 0.125 },
                knowledge: "2024-09-30",
                release_date: "2025-11-13",
                open_weights: false,
                experimental: {
                  modes: {
                    fast: {
                      cost: { input: 2.5, output: 20 },
                      provider: { body: { service_tier: "priority" } },
                    },
                  },
                },
              },
            },
          },
        }),
      );
      resetCatalogCache();
      const catalog = await loadModelsDev(cwd);
      const model = catalog.demo?.models["demo-fast"];
      expect(model?.cost).toEqual({ input: 1.25, output: 10, cacheRead: 0.125 });
      expect(model?.knowledge).toBe("2024-09-30");
      expect(model?.releaseDate).toBe("2025-11-13");
      expect(model?.structuredOutput).toBe(true);
      expect(model?.input).toBe(180_000);
      expect(model?.vision).toBe(true);
      expect(model?.modalities?.input).toEqual(["text", "image"]);
      expect(model?.variants?.fast?.body).toEqual({ service_tier: "priority" });
      expect(model?.variants?.fast?.cost?.input).toBe(2.5);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
