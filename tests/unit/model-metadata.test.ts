import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerOps } from "../../src/app/provider-ops";
import { sanitize } from "../../src/app/provider-secrets";
import { contextWindow, hydrateActiveModel, maxOutputTokens } from "../../src/app/provider-state";
import { HarnessConfigSchema } from "../../src/config/schema";
import { resetCatalogCache } from "../../src/providers/catalog";

const dirs: string[] = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(async () => {
  resetCatalogCache();
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(data: unknown[], catalogModels: Record<string, unknown> = {}) {
  resetCatalogCache();
  const requests: Array<{ method: string; path: string; authorization: string | null }> = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push({
        method: request.method,
        path,
        authorization: request.headers.get("authorization"),
      });
      return path === "/v1/models"
        ? Response.json({ data })
        : new Response("not found", { status: 404 });
    },
  });
  servers.push(server);
  const cwd = await mkdtemp(join(tmpdir(), "liquid-model-metadata-"));
  dirs.push(cwd);
  const config = HarnessConfigSchema.parse({
    useDefaults: false,
    provider: "relay",
    model: "active",
    catalog: { autoRefresh: false },
    providers: {
      relay: {
        protocol: "openai-chat",
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        apiKey: "metadata-secret",
        models: {
          active: { name: "Active", context: 128_000, output: 8192, source: "manual" },
        },
      },
    },
  });
  const cache = join(cwd, ".liquid", "cache");
  await mkdir(cache, { recursive: true });
  await writeFile(
    join(cache, "models-dev.json"),
    JSON.stringify({
      relay: { api: config.providers.relay?.baseUrl, models: catalogModels },
    }),
  );
  await writeFile(join(cache, "agent-one.json"), "{}");
  const ops = providerOps({
    cwd,
    config: () => config,
    commit: async () => {
      throw new Error("Metadata must not save settings");
    },
    info: () => {
      throw new Error("Metadata must not modify app state");
    },
  });
  return { config, cwd, ops, requests };
}

test("manual model lookup imports API limits using the saved draft credential without generation", async () => {
  const id = "mango11/deepseek-v4.1-flash-1017";
  const { config, ops, requests } = await setup(
    [
      {
        id,
        context_length: 1_048_576,
        max_output_tokens: 65_536,
        supports_tools: true,
        supports_reasoning: true,
        reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
      },
    ],
    { [id]: { limit: { context: 128_000, output: 8192 } } },
  );
  const provider = sanitize(config).providers.relay;
  expect(provider).toBeDefined();
  const draft = ops.registerDraft({ provider, providerId: "relay" });
  const before = structuredClone(config);
  const result = await ops.modelMetadata({ draftToken: draft.draftToken, model: id });
  expect(result.model).toMatchObject({
    context: 1_048_576,
    output: 65_536,
    tools: true,
    reasoning: true,
    reasoningLevels: ["low", "high", "max"],
  });
  expect(requests[0]?.authorization).toBe("Bearer metadata-secret");
  expect(requests.every((request) => request.method === "GET")).toBe(true);
  expect(JSON.stringify(result)).not.toContain("metadata-secret");
  expect(config).toEqual(before);
  const definition = config.providers.relay;
  if (!definition) throw new Error("Missing test provider");
  definition.models[id] = result.model;
  config.model = id;
  expect(contextWindow(config)).toBe(1_048_576);
  expect(maxOutputTokens(config)).toBe(65_536);
});

test("unknown model remains without invented limits or capabilities", async () => {
  const { ops } = await setup([{ id: "available" }], {
    "deepseek-v4": { limit: { context: 128_000, output: 8192 }, reasoning: true },
  });
  const result = await ops.modelMetadata({ providerId: "relay", model: "deepseek-v4.1-new" });
  expect(result.model).toEqual({ name: "Deepseek V4.1 New", source: "manual" });
});

test("missing backend listing falls back to models.dev after normalizing derivative aliases", async () => {
  const { ops, requests } = await setup([], {
    "DeepSeek-AI/DeepSeek-V4.1-Flash-1017": {
      limit: { context: 1_048_576, output: 393_216 },
      tool_call: true,
      reasoning: true,
    },
  });
  const result = await ops.modelMetadata({
    providerId: "relay",
    model: "mango11/deepseek_v4-1_flash_1017-uncensored-abliterated",
  });
  expect(result.model).toMatchObject({
    context: 1_048_576,
    output: 393_216,
    tools: true,
    reasoning: true,
    source: "models.dev",
  });
  const otherCheckpoint = await ops.modelMetadata({
    providerId: "relay",
    model: "mango11/deepseek-v4.1-flash-1018-uncensored",
  });
  expect(otherCheckpoint.model.context).toBeUndefined();
  expect(requests.every((request) => request.method === "GET")).toBe(true);
});

test("exact catalog metadata fills an unlisted manual model and incomplete active output", async () => {
  const { config, cwd, ops } = await setup([{ id: "active" }], {
    active: { limit: { context: 1_048_576, output: 65_536 }, reasoning: true },
    "deepseek/deepseek-v4.1-flash-1017": {
      limit: { context: 1_048_576, output: 393_216 },
      tool_call: true,
    },
  });
  const model = await ops.modelMetadata({
    providerId: "relay",
    model: "deepseek/deepseek-v4.1-flash-1017",
  });
  expect(model.model).toMatchObject({ context: 1_048_576, output: 393_216, tools: true });
  const definition = config.providers.relay;
  if (!definition) throw new Error("Missing test provider");
  definition.models.active = { context: 200_000, reasoning: false };
  await hydrateActiveModel(config, cwd);
  expect(definition.models.active).toMatchObject({
    context: 200_000,
    reasoning: false,
    output: 65_536,
  });
});
