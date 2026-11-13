import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelConfig } from "../../src/config/schema";
import { actualizeModels } from "../../src/providers/actualize";
import { resetCatalogCache } from "../../src/providers/catalog";
import { discoverProvider } from "../../src/providers/discovery";

const servers: Array<ReturnType<typeof Bun.serve>> = [];
const dirs: string[] = [];

beforeEach(() => resetCatalogCache());

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-discovery-"));
  dirs.push(dir);
  return dir;
}

describe("provider discovery", () => {
  test("reads API models and fills missing metadata from the catalog", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path !== "/v1/models") return new Response("not found", { status: 404 });
        return Response.json({
          data: [
            { id: "qwen3-coder" },
            { id: "mystery-model", context_length: 64_000, max_output_tokens: 8_000 },
          ],
        });
      },
    });
    servers.push(server);
    const cwd = await tempDir();
    const cache = join(cwd, ".liquid", "cache");
    await mkdir(cache, { recursive: true });
    await writeFile(
      join(cache, "models-dev.json"),
      JSON.stringify({
        local: {
          id: "local",
          name: "Local",
          api: `http://127.0.0.1:${server.port}/v1`,
          npm: "@ai-sdk/openai-compatible",
          models: {
            "qwen3-coder": {
              id: "qwen3-coder",
              name: "Qwen3 Coder",
              reasoning: true,
              reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }],
              tool_call: true,
              limit: { context: 131_072, output: 32_768 },
            },
          },
        },
      }),
    );
    await writeFile(join(cache, "agent-one.json"), "{}");

    const result = await discoverProvider(cwd, {
      protocol: "openai-chat",
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
    });

    expect(result.providerName).toBe("Local");
    expect(result.models["qwen3-coder"]?.context).toBe(131_072);
    expect(result.models["qwen3-coder"]?.reasoning).toBe(true);
    expect(result.models["qwen3-coder"]?.tools).toBe(true);
    expect(result.models["qwen3-coder"]?.reasoningLevels).toEqual(["low", "medium", "high"]);
    expect(result.models["mystery-model"]?.name).toBe("Mystery Model");
    expect(result.models["mystery-model"]?.context).toBe(64_000);
    expect(result.models["mystery-model"]?.output).toBe(8_000);
  });
});

describe("native local discovery", () => {
  test("fills context and capabilities from LM Studio", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/v1/models") {
          return Response.json({ data: [{ id: "qwen3-coder" }] });
        }
        if (path === "/api/v1/models") {
          return Response.json({
            models: [
              {
                id: "qwen3-coder",
                max_context_length: 65_536,
                capabilities: ["tool_use", "vision"],
              },
            ],
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    servers.push(server);
    const cwd = await tempDir();
    const cache = join(cwd, ".liquid", "cache");
    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, "models-dev.json"), "{}");
    await writeFile(join(cache, "agent-one.json"), "{}");

    const result = await discoverProvider(cwd, {
      protocol: "openai-chat",
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
    });
    const model = result.models["qwen3-coder"];
    expect(model?.context).toBe(65_536);
    expect(model?.tools).toBe(true);
    expect(model?.vision).toBe(true);
    expect(model?.source).toBe("lmstudio");
    expect(result.warnings.some((warning) => warning.includes("lmstudio"))).toBe(true);
  });
});

describe("model actualization", () => {
  test("returns a diff and preserves overrides and variants", () => {
    const existing: Record<string, ModelConfig> = {
      "model-a": {
        name: "My Model A",
        context: 32_000,
        headers: { "x-tenant": "a" },
        extraBody: { temperature: 0 },
        compat: { strictTools: true },
        variants: { fast: { name: "Fast", body: { service_tier: "priority" } } },
        disabled: true,
        failoverModels: ["model-b"],
      },
      "model-b": { name: "Model B", context: 8_000 },
    };
    const discovered: Record<string, ModelConfig> = {
      "model-a": {
        name: "Model A",
        context: 64_000,
        output: 4_000,
        tools: true,
        source: "api",
      },
      "model-c": { name: "Model C", context: 16_000, source: "api" },
    };

    const result = actualizeModels(existing, discovered);

    const merged = result.models["model-a"];
    expect(merged?.name).toBe("My Model A");
    expect(merged?.context).toBe(64_000);
    expect(merged?.output).toBe(4_000);
    expect(merged?.tools).toBe(true);
    expect(merged?.headers).toEqual({ "x-tenant": "a" });
    expect(merged?.extraBody).toEqual({ temperature: 0 });
    expect(merged?.compat).toEqual({ strictTools: true });
    expect(merged?.variants?.fast?.body).toEqual({ service_tier: "priority" });
    expect(merged?.disabled).toBe(true);
    expect(merged?.failoverModels).toEqual(["model-b"]);

    expect(result.models["model-c"]).toEqual(discovered["model-c"]);
    expect(result.models["model-b"]).toBeUndefined();
    expect(result.added).toEqual(["model-c"]);
    expect(result.removed).toEqual(["model-b"]);
    expect(result.updated).toEqual([
      { id: "model-a", fields: ["context", "output", "tools", "source"] },
    ]);
  });
});
