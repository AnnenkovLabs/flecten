import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelConfig } from "../../src/config/schema";
import {
  type CatalogProvider,
  findCatalogModel,
  findModel,
  resetCatalogCache,
} from "../../src/providers/catalog";

function provider(
  id: string,
  models: Record<string, ModelConfig>,
  baseUrl = `https://${id}.example/v1`,
): CatalogProvider {
  return { id, name: id, protocol: "openai-chat", baseUrl, models, source: "models.dev" };
}

const directories: string[] = [];
afterEach(async () => {
  resetCatalogCache();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("catalog model identity", () => {
  test("does not reuse an older model's limits for a new version", () => {
    const catalog = {
      relay: provider("relay", { "deepseek-v4": { context: 128_000, output: 8192 } }),
    };
    expect(findModel(catalog, "mango11/deepseek-v4.1-flash-1017")).toBeUndefined();
    expect(findModel(catalog, "deepseek")).toBeUndefined();
  });

  test("keeps punctuation that distinguishes model versions", () => {
    const catalog = {
      relay: provider("relay", { "model-v41": { context: 32_000 } }),
    };
    expect(findModel(catalog, "model-v4.1")).toBeUndefined();
  });

  test("prefers the exact qualified ID over an unrelated provider's leaf", () => {
    const exact = { context: 1_000_000, output: 64_000 };
    const catalog = {
      first: provider("first", { "other/model-v4.1": { context: 32_000 } }),
      second: provider("second", { "author/model-v4.1": exact }),
    };
    expect(findModel(catalog, "author/model-v4.1")).toBe(exact);
  });

  test("uses explicit canonical IDs without guessing from the serving alias", () => {
    const exact = {
      context: 1_000_000,
      output: 64_000,
      canonicalId: "author/model-v4.1",
    };
    const catalog = { relay: provider("relay", { "serving-alias": exact }) };
    expect(findModel(catalog, "author/model-v4.1")).toBe(exact);
  });

  test("uses the connected endpoint's limits and capabilities", () => {
    const hosted = { context: 1_048_576, output: 65_536, reasoning: true };
    const catalog = {
      first: provider("first", {
        "author/model-v4.1": { context: 128_000, output: 8192, reasoning: false },
      }),
      host: provider("host", { "mango11/model-v4.1": hosted }, "https://relay.example/api/v1"),
    };
    expect(findModel(catalog, "mango11/model-v4.1", "https://relay.example/api/v1/")).toBe(hosted);
    expect(findModel(catalog, "alias/model-v4.1", "https://relay.example/api/v1")).toBe(hosted);
  });

  test("does not confuse distinct API paths on the same host", () => {
    const scoped = { context: 1_000_000, output: 64_000 };
    const catalog = {
      first: provider("first", { model: { context: 32_000 } }, "https://relay.example/team-a/v1"),
      second: provider("second", { model: scoped }, "https://relay.example/team-b/v1"),
    };
    expect(findModel(catalog, "model", "https://relay.example/team-b/v1")).toBe(scoped);
  });

  test("leaves ambiguous cross-provider limits unknown", () => {
    const catalog = {
      first: provider("first", { "author/model": { context: 32_000 } }),
      second: provider("second", { "other/model": { context: 1_000_000 } }),
    };
    expect(findModel(catalog, "model")).toBeUndefined();
    expect(findModel(catalog, "alias/model")).toBeUndefined();
  });

  test("still resolves an unambiguous exact leaf with a relay namespace", () => {
    const exact = { context: 1_000_000, output: 64_000 };
    const catalog = { relay: provider("relay", { "author/model-v4.1": exact }) };
    expect(findModel(catalog, "relay/author/model-v4.1")).toBe(exact);
  });

  test("normalizes relay namespaces, separator spelling and declared derivative modifiers", () => {
    const original = { context: 1_048_576, output: 393_216, reasoning: true };
    const catalog = {
      deepseek: provider("deepseek", { "deepseek-v4.1-flash-1017": original }),
    };
    for (const id of [
      "DeepSeek-AI/DeepSeek_V4_1_Flash_1017",
      "mango11/deepseek-v4.1-flash-1017-uncensored",
      "community/UncensoredDeepSeek-V4.1-Flash-1017",
      "community/DeepSeek-V4.1-Abliterated-Flash-1017",
      "community/DeepSeek-V4.1-FlashUncensored-1017-abliterated",
    ]) {
      expect(findModel(catalog, id, "https://unknown.example/v1")).toBe(original);
    }
  });

  test("resolves the screenshot alias through the original provider's declared canonical ID", () => {
    const canonicalId = "deepseek/deepseek-v4.1-flash-1017";
    const original = { context: 1_048_576, output: 393_216, reasoning: true, canonicalId };
    const catalog = {
      first: provider("first", {
        [canonicalId]: { context: 128_000, output: 8192, reasoning: false, canonicalId },
      }),
      deepseek: provider("deepseek", { "deepseek-flash": original }),
    };
    expect(findModel(catalog, "mango11/deepseek-v4.1-flash-1017")).toBe(original);
    expect(findModel(catalog, "DeepSeek-AI/DeepSeek-V4.1-Flash-1017-Uncensored")).toBe(original);
  });

  test("uses canonical ownership for Qwen instead of inferring a provider from its family", () => {
    const canonicalId = "alibaba/qwen3.8-flash";
    const original = { context: 1_000_000, output: 131_072, canonicalId };
    const catalog = {
      relay: provider("relay", { "qwen/qwen3.8-flash": { context: 32_000, canonicalId } }),
      alibaba: provider("alibaba", { "qwen3.8-flash": original }),
    };
    expect(findModel(catalog, "community/Qwen3_8-Flash-abliterated")).toBe(original);
  });

  test("prefers a matching display name among equivalent original-provider aliases", () => {
    const canonicalId = "deepseek/deepseek-v4.1-flash-1017";
    const metadata = { context: 1_048_576, output: 393_216, canonicalId };
    const original = { ...metadata, name: "DeepSeek V4.1 Flash 1017" };
    const catalog = {
      deepseek: provider("deepseek", {
        "deepseek-v4-flash-vision-exp": { ...metadata, name: "DeepSeek V4 Flash Vision Exp" },
        "deepseek-flash": original,
      }),
    };
    expect(findModel(catalog, "mango11/deepseek-v4.1-flash-1017")).toBe(original);
  });

  test("keeps versions, checkpoint dates, parameter counts and distillation identity", () => {
    const catalog = {
      deepseek: provider("deepseek", {
        "deepseek-v4.1-flash-1017": { context: 1_000_000 },
        "deepseek-r1-0528": { context: 128_000 },
        "deepseek-r1-distill-qwen-32b": { context: 131_072 },
      }),
      alibaba: provider("alibaba", { "qwen3-coder-480b-a35b-2507": { context: 262_144 } }),
    };
    for (const id of [
      "community/DeepSeek-V4.2-Flash-1017-uncensored",
      "community/DeepSeek-V4.1-Flash-1018-uncensored",
      "community/DeepSeek-R1-0529-abliterated",
      "community/DeepSeek-R1-abliterated",
      "community/DeepSeek-R1-Distill-Qwen-70B-uncensored",
      "community/DeepSeek-R1-Distill-Llama-32B-uncensored",
      "community/DeepSeek-R1-Qwen-32B-uncensored",
      "community/Qwen3-Coder-480B-A35B-2508-uncensored",
      "community/Qwen3-Coder-480B-A3B-2507-uncensored",
    ]) {
      expect(findModel(catalog, id)).toBeUndefined();
    }
  });

  test("keeps the serving endpoint's derivative limits ahead of the original model", () => {
    const hosted = { context: 256_000, output: 32_000 };
    const catalog = {
      deepseek: provider("deepseek", { "deepseek-v4.1-flash-1017": { context: 1_000_000 } }),
      relay: provider("relay", { "community/deepseek-v4.1-flash-1017-uncensored": hosted }),
    };
    expect(
      findModel(
        catalog,
        "community/deepseek-v4.1-flash-1017-uncensored",
        "https://relay.example/v1",
      ),
    ).toBe(hosted);
  });

  test("tries the exact fallback catalog when models.dev only has an older similar ID", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flecten-catalog-matching-"));
    directories.push(directory);
    const cache = join(directory, ".flecten", "cache");
    await mkdir(cache, { recursive: true });
    await writeFile(
      join(cache, "models-dev.json"),
      JSON.stringify({
        old: {
          api: "https://old.example/v1",
          models: { "model-v4": { limit: { context: 128_000, output: 8192 } } },
        },
      }),
    );
    await writeFile(
      join(cache, "agent-one.json"),
      JSON.stringify({ "author/model-v4.1": { context: 1_000_000, output: 64_000 } }),
    );
    expect(await findCatalogModel(directory, "relay/model-v4.1")).toEqual({
      context: 1_000_000,
      output: 64_000,
    });
  });
});
