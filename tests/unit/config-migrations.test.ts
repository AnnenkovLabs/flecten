import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_FILE, loadConfig, saveConfig } from "../../src/config/load";
import { CONFIG_SCHEMA_VERSION } from "../../src/config/schema";
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
  delete process.env.FLECTEN_PROVIDER;
  delete process.env.FLECTEN_MODEL;
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
  const dir = await mkdtemp(join(tmpdir(), "liquid-config-migrations-"));
  dirs.push(dir);
  return dir;
}

describe("config migrations", () => {
  test("migrates an unversioned config and keeps legacy keys", async () => {
    const cwd = await tempDir();
    await writeFile(
      join(cwd, CONFIG_FILE),
      JSON.stringify({
        provider: "openai",
        model: "gpt-5.1",
        maxOutputTokens: 4096,
        tools: { maxOutputBytes: 1234 },
        hooks: { preToolUse: [{ command: "true" }] },
      }),
    );

    const config = await loadConfig(cwd);
    expect(config.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(config.maxOutputTokens).toBe(4096);
    expect(config.tools.maxOutputBytes).toBe(1234);
    expect(config.tools.retryAttempts).toBe(1);
    expect(config.tools.retryBackoffMs).toBe(500);
    expect(config.tools.outputBudgetRatio).toBe(0.1);
    expect(config.hooks.preToolUse[0]?.failClosed).toBe(false);
    expect(config.terminal).toEqual({
      scrollback: 1000,
      commandTimeoutMs: 120_000,
      jobWaitMs: 30_000,
      ansi: true,
      notifyOnExit: true,
      maxProcesses: 64,
      maxMemoryMb: 4096,
    });
    expect(config.sessions).toEqual({
      retentionDays: 30,
      maxSessions: 100,
      trashDays: 7,
      maxConcurrent: 4,
      autoResume: true,
    });
    expect(config.budgets).toEqual({});
    expect(config.update).toEqual({
      channel: "stable",
      autoCheck: true,
      autoDownload: true,
      installOnQuit: true,
    });
    expect(config.telemetry).toEqual({ enabled: false });
    expect(config).not.toHaveProperty("plugins");
    expect(config.commands).toEqual({ dirs: [] });
    expect(config.modes).toEqual({ dirs: [] });
    expect(config.subagents).toEqual({ dirs: [] });
    expect(config.lsp).toEqual({ servers: {}, formatters: {} });
    expect(config.context.promptBudget).toBe(24_000);
    expect(config.context.compactWarn).toEqual([70, 85, 95]);
    expect(config.context.outputBudgetRatio).toBe(0.1);
  });

  test("raises the unused version 1 prompt budget and keeps a deliberate one", async () => {
    const cwd = await tempDir();
    const file = join(cwd, CONFIG_FILE);
    await writeFile(file, JSON.stringify({ schemaVersion: 1, context: { promptBudget: 8000 } }));
    expect((await loadConfig(cwd)).context.promptBudget).toBe(24_000);
    await writeFile(file, JSON.stringify({ schemaVersion: 1, context: { promptBudget: 12_000 } }));
    expect((await loadConfig(cwd)).context.promptBudget).toBe(12_000);
    await writeFile(file, JSON.stringify({ schemaVersion: 2, context: { promptBudget: 8000 } }));
    expect((await loadConfig(cwd)).context.promptBudget).toBe(8000);
  });

  test.each([undefined, 1, 2, 3])(
    "drops retired plugins from schema %s while preserving modules and explicit extensions",
    async (schemaVersion) => {
      const cwd = await tempDir();
      const path = join(cwd, CONFIG_FILE);
      const modules = { dirs: ["./my-module"], trusted: { "./my-module": "reviewed-revision" } };
      const input = {
        schemaVersion,
        plugins: { enabled: true, dirs: ["./old-plugin"], trusted: { "./old-plugin": "old-hash" } },
        modules,
        skills: { sources: [] },
        mcp: { servers: { docs: { command: "bun", args: ["docs.ts"] } } },
        hooks: { preToolUse: [{ command: "true" }] },
        commands: { dirs: ["./commands"] },
        subagents: { dirs: ["./agents"] },
      };
      await writeFile(path, JSON.stringify(input));
      const config = await loadConfig(cwd);
      expect(config).not.toHaveProperty("plugins");
      expect(config.modules).toMatchObject(modules);
      expect(config.skills?.sources).toEqual([]);
      expect(config.mcp.servers.docs).toMatchObject(input.mcp.servers.docs);
      expect(config.hooks.preToolUse[0]?.command).toBe("true");
      expect(config.commands?.dirs).toEqual(["./commands"]);
      expect(config.subagents?.dirs).toEqual(["./agents"]);
      expect(await Bun.file(path).json()).toEqual(JSON.parse(JSON.stringify(input)));
      await saveConfig(cwd, config);
      const saved = await Bun.file(path).json();
      expect(saved).not.toHaveProperty("plugins");
      expect(saved.modules).toMatchObject(modules);
    },
  );

  test("saves the current schema version", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, CONFIG_FILE), JSON.stringify({ provider: "openai" }));

    const config = await loadConfig(cwd);
    await saveConfig(cwd, config);

    const file = (await Bun.file(join(cwd, CONFIG_FILE)).json()) as { schemaVersion?: number };
    expect(file.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
  });

  test("rejects unknown top-level keys with migration guidance", async () => {
    const cwd = await tempDir();
    await writeFile(
      join(cwd, CONFIG_FILE),
      JSON.stringify({ provider: "openai", legacyTypo: true }),
    );

    await expect(loadConfig(cwd)).rejects.toThrow(/unknown top-level config key.*legacyTypo/);
    await expect(loadConfig(cwd)).rejects.toThrow(
      `remove or migrate the config to schemaVersion ${CONFIG_SCHEMA_VERSION}`,
    );
  });

  test("rejects a future schema version", async () => {
    const cwd = await tempDir();
    await writeFile(
      join(cwd, CONFIG_FILE),
      JSON.stringify({ schemaVersion: CONFIG_SCHEMA_VERSION + 1, provider: "openai" }),
    );

    await expect(loadConfig(cwd)).rejects.toThrow(/schemaVersion/);
  });

  test("saves to an explicit path", async () => {
    const cwd = await tempDir();
    const path = join(cwd, "explicit.config.json");
    const config = await loadConfig(cwd);
    await saveConfig(cwd, config, { path });
    expect(await Bun.file(path).exists()).toBe(true);
    expect(await Bun.file(join(cwd, CONFIG_FILE)).exists()).toBe(false);
  });
});
