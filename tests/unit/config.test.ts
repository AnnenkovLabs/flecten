import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_FILE, loadConfig, saveConfig } from "../../src/config/load";
import { CONFIG_SCHEMA_VERSION, HarnessConfigSchema } from "../../src/config/schema";
import { setSecretBackend } from "../../src/config/secrets";

const dirs: string[] = [];
const saved = {
  provider: process.env.FLECTEN_PROVIDER,
  model: process.env.FLECTEN_MODEL,
  config: process.env.FLECTEN_CONFIG,
};

beforeEach(() => {
  setSecretBackend("file");
  delete process.env.FLECTEN_CONFIG;
});

afterEach(async () => {
  if (saved.provider === undefined) delete process.env.FLECTEN_PROVIDER;
  else process.env.FLECTEN_PROVIDER = saved.provider;
  if (saved.model === undefined) delete process.env.FLECTEN_MODEL;
  else process.env.FLECTEN_MODEL = saved.model;
  if (saved.config === undefined) delete process.env.FLECTEN_CONFIG;
  else process.env.FLECTEN_CONFIG = saved.config;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-config-"));
  dirs.push(dir);
  return dir;
}

describe("config", () => {
  test("uses Talker and Worker by default and preserves an explicit opt-out", async () => {
    const cwd = await tempDir();
    const config = await loadConfig(cwd);
    expect(config.conversation?.enabled).toBe(true);
    expect(HarnessConfigSchema.parse({}).conversation?.enabled).toBe(true);
    expect(HarnessConfigSchema.parse({ conversation: {} }).conversation?.enabled).toBe(true);
    config.conversation = { enabled: false };
    await saveConfig(cwd, config);
    expect((await loadConfig(cwd)).conversation?.enabled).toBe(false);
  });

  test("ships known providers", async () => {
    const cwd = await tempDir();
    const config = await loadConfig(cwd);
    expect(Object.keys(config.providers)).toEqual([
      "openai",
      "anthropic",
      "google",
      "openrouter",
      "deepseek",
      "moonshotai",
      "zai",
      "alibaba",
      "groq",
      "cerebras",
      "ollama",
    ]);
    expect(config.maxOutputTokens).toBe(0);
    expect(config.providers.openai?.protocol).toBe("openai-responses");
  });

  test("adds a custom OpenAI-compatible provider", async () => {
    const cwd = await tempDir();
    await writeFile(
      join(cwd, "flecten.config.json"),
      JSON.stringify({
        provider: "local",
        model: "qwen3-coder",
        providers: {
          local: { protocol: "openai-chat", baseUrl: "http://127.0.0.1:11434/v1" },
        },
      }),
    );
    const config = await loadConfig(cwd);
    expect(config.provider).toBe("local");
    expect(config.model).toBe("qwen3-coder");
    expect(config.providers.local?.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(config.providers.openai).toBeDefined();
  });

  test("rejects an unknown active provider", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "flecten.config.json"), JSON.stringify({ provider: "nope" }));
    await expect(loadConfig(cwd)).rejects.toThrow("not configured");
  });

  test("infers the provider from a Claude model", async () => {
    const cwd = await tempDir();
    delete process.env.FLECTEN_PROVIDER;
    process.env.FLECTEN_MODEL = "claude-sonnet-4-6";
    const config = await loadConfig(cwd);
    expect(config.provider).toBe("anthropic");
  });

  test("keeps a saved provider map authoritative", async () => {
    const cwd = await tempDir();
    const config = await loadConfig(cwd);
    config.useDefaults = false;
    delete config.providers.ollama;
    await saveConfig(cwd, config);
    const reloaded = await loadConfig(cwd);
    expect(reloaded.providers.ollama).toBeUndefined();
    expect(reloaded.useDefaults).toBe(false);
  });

  test("keeps api keys out of the config file", async () => {
    const cwd = await tempDir();
    const config = await loadConfig(cwd);
    const openai = config.providers.openai;
    if (!openai) throw new Error("openai provider missing");
    openai.apiKey = "sk-test-secret";
    await saveConfig(cwd, config);
    const file = (await Bun.file(join(cwd, "flecten.config.json")).json()) as {
      providers: Record<string, { apiKey?: string }>;
    };
    expect(file.providers.openai?.apiKey).toBeUndefined();
    const secrets = (await Bun.file(join(cwd, ".liquid", "secrets.json")).json()) as Record<
      string,
      string
    >;
    expect(JSON.parse(secrets.openai ?? "{}").value).toBe("sk-test-secret");
    const reloaded = await loadConfig(cwd);
    expect(reloaded.providers.openai?.apiKey).toBe("sk-test-secret");
    await saveConfig(cwd, reloaded, { clearSecrets: ["openai"] });
    const cleared = await loadConfig(cwd);
    expect(cleared.providers.openai?.apiKey).toBeUndefined();
  });

  test("roundtrips through the FLECTEN_CONFIG path", async () => {
    const cwd = await tempDir();
    const path = join(cwd, "custom.config.json");
    await writeFile(
      path,
      JSON.stringify({ provider: "openai", model: "gpt-5.1", maxOutputTokens: 4096 }),
    );
    process.env.FLECTEN_CONFIG = path;

    const config = await loadConfig(cwd);
    expect(config.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    config.maxOutputTokens = 8192;

    expect(await saveConfig(cwd, config)).toBe(path);
    expect(await Bun.file(join(cwd, CONFIG_FILE)).exists()).toBe(false);

    const savedFile = (await Bun.file(path).json()) as {
      schemaVersion: number;
      maxOutputTokens: number;
    };
    expect(savedFile.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(savedFile.maxOutputTokens).toBe(8192);

    const reloaded = await loadConfig(cwd);
    expect(reloaded.maxOutputTokens).toBe(8192);
  });

  test("rejects a missing explicit config path", async () => {
    const cwd = await tempDir();
    await expect(loadConfig(cwd, join(cwd, "missing.json"))).rejects.toThrow("config not found");
  });

  test("loads MCP servers and hooks with safe defaults", async () => {
    const cwd = await tempDir();
    await writeFile(
      join(cwd, "flecten.config.json"),
      JSON.stringify({
        mcp: { servers: { docs: { command: "bun", args: ["server.ts"] } } },
        hooks: { preToolUse: [{ command: "true" }] },
      }),
    );
    const config = await loadConfig(cwd);
    expect(config.mcp.servers.docs).toMatchObject({
      command: "bun",
      protocol: "auto",
      enabled: true,
      timeoutMs: 60_000,
      maxTools: 64,
    });
    expect(config.hooks.preToolUse[0]).toEqual({
      type: "command",
      async: false,
      command: "true",
      matcher: "*",
      timeoutMs: 10_000,
      enabled: true,
      failClosed: false,
    });
    expect(config.hooks.sessionEnd).toEqual([]);

    await saveConfig(cwd, config);
    const reloaded = await loadConfig(cwd);
    expect(reloaded.mcp).toEqual(config.mcp);
    expect(reloaded.hooks).toEqual(config.hooks);
  });

  test("rejects an invalid MCP server id", async () => {
    const cwd = await tempDir();
    await writeFile(
      join(cwd, "flecten.config.json"),
      JSON.stringify({ mcp: { servers: { "Bad Name": { command: "true" } } } }),
    );
    await expect(loadConfig(cwd)).rejects.toThrow("server id");
  });
});
