import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productEnv } from "../../shared/environment.cjs";
import { configPath, loadConfig, saveConfig } from "../../src/config/load";
import { setSecretBackend } from "../../src/config/secrets";
import { SandboxPolicy } from "../../src/security/sandbox";
import { isProtectedPath } from "../../src/store/checkpoints/restore";

const names = [
  "FLECTEN_CONFIG",
  "LIQUID_CONFIG",
  "FLECTEN_PROVIDER",
  "LIQUID_PROVIDER",
  "FLECTEN_MODEL",
  "LIQUID_MODEL",
] as const;
const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
const directories: string[] = [];

beforeEach(() => {
  setSecretBackend("file");
  for (const name of names) delete process.env[name];
});

afterEach(async () => {
  for (const name of names) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("Flecten settings override legacy environment names without changing the environment", () => {
  const environment = { LIQUID_MODEL: "legacy", FLECTEN_MODEL: "current" };
  expect(productEnv("MODEL", environment)).toBe("current");
  expect(productEnv("MODEL", { LIQUID_MODEL: "legacy" })).toBe("legacy");
  expect(productEnv("MODEL", {})).toBeUndefined();
  expect(environment).toEqual({ LIQUID_MODEL: "legacy", FLECTEN_MODEL: "current" });
});

test("loading and saving retain an existing config; the new config takes precedence", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-config-"));
  directories.push(cwd);
  const legacy = join(cwd, "liquid.config.json");
  const preferred = join(cwd, "flecten.config.json");
  await writeFile(legacy, JSON.stringify({ model: "gpt-5.1", context: { promptBudget: 12345 } }));
  expect(configPath(cwd)).toBe(legacy);
  const config = await loadConfig(cwd);
  expect(config.context.promptBudget).toBe(12345);
  config.context.promptBudget = 23456;
  expect(await saveConfig(cwd, config)).toBe(legacy);
  expect((await loadConfig(cwd)).context.promptBudget).toBe(23456);
  expect(await Bun.file(preferred).exists()).toBe(false);

  await writeFile(
    preferred,
    JSON.stringify({ model: "gpt-5.1", context: { promptBudget: 34567 } }),
  );
  expect(configPath(cwd)).toBe(preferred);
  expect((await loadConfig(cwd)).context.promptBudget).toBe(34567);
  process.env.LIQUID_CONFIG = legacy;
  process.env.LIQUID_MODEL = "gpt-legacy";
  expect((await loadConfig(cwd)).model).toBe("gpt-legacy");
  process.env.FLECTEN_CONFIG = preferred;
  process.env.FLECTEN_MODEL = "gpt-current";
  expect((await loadConfig(cwd)).model).toBe("gpt-current");
  expect(configPath(cwd)).toBe(preferred);
  expect(configPath(cwd, legacy)).toBe(legacy);
});

test("both config names remain protected from model writes and automatic undo", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-protection-"));
  directories.push(cwd);
  const policy = new SandboxPolicy({ workspaceRoot: cwd });
  for (const name of ["flecten.config.json", "liquid.config.json"]) {
    expect((await policy.checkWrite(name)).allowed).toBe(false);
    expect(isProtectedPath(name)).toBe(true);
  }
});
