import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, loadConfig, saveConfig } from "../../src/config/load";
import {
  HooksConfigSchema,
  PermissionsConfigSchema,
  ProviderConfigSchema,
} from "../../src/config/schema";
import { setSecretBackend } from "../../src/config/secrets";

const directories: string[] = [];
const environment = { ...process.env };
afterEach(async () => {
  for (const name of ["FLECTEN_PROFILE", "FLECTEN_CONFIG"]) {
    if (environment[name] === undefined) delete process.env[name];
    else process.env[name] = environment[name];
  }
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  delete process.env.FLECTEN_CONFIG;
  delete process.env.FLECTEN_PROFILE;
  setSecretBackend("file");
  const root = await mkdtemp(join(tmpdir(), "flecten-profile-"));
  directories.push(root);
  const first = join(root, "first");
  const second = join(root, "second");
  const profile = join(root, "profile");
  const config = await loadConfig(first);
  config.useDefaults = false;
  config.provider = "personal";
  config.model = "personal-model";
  config.providers = {
    personal: {
      ...ProviderConfigSchema.parse({
        protocol: "openai-chat",
        baseUrl: "https://personal.invalid/v1",
      }),
      protocol: "openai-chat",
      baseUrl: "https://personal.invalid/v1",
      apiKey: "profile-test-key",
      models: {
        "personal-model": {
          context: 32768,
          output: 4096,
          variants: { careful: { reasoning: "high" } },
        },
      },
    },
  };
  config.ui = { sendShortcut: "modifier-enter", followUpBehavior: "steer" };
  config.permissions = { ...PermissionsConfigSchema.parse({}), shell: "allow" };
  config.hooks = HooksConfigSchema.parse({ preToolUse: [{ command: "project-only-hook" }] });
  await saveConfig(first, config);
  const original = await readFile(join(first, "flecten.config.json"), "utf8");
  process.env.FLECTEN_PROFILE = profile;
  return { first, second, profile, original };
}

test("desktop profile keeps models, keys and personal preferences when the workspace changes", async () => {
  const f = await fixture();
  await loadConfig(f.first);
  const second = await loadConfig(f.second);
  expect(second.provider).toBe("personal");
  expect(second.model).toBe("personal-model");
  expect(second.providers.personal?.apiKey).toBe("profile-test-key");
  expect(second.providers.personal?.models["personal-model"]?.variants?.careful).toEqual({
    reasoning: "high",
  });
  expect(second.ui).toEqual({ sendShortcut: "modifier-enter", followUpBehavior: "steer" });
  expect(second.permissions?.shell).toBe("auto");
  expect(second.hooks.preToolUse).toEqual([]);
  expect(configPath(f.second)).toBe(join(f.profile, "flecten.config.json"));
  expect(await readFile(join(f.first, "flecten.config.json"), "utf8")).toBe(f.original);

  second.ui = { sendShortcut: "enter", followUpBehavior: "queue" };
  second.permissions = { ...PermissionsConfigSchema.parse(second.permissions), shell: "deny" };
  await saveConfig(f.second, second);
  const first = await loadConfig(f.first);
  expect(first.ui).toEqual(second.ui);
  expect(first.permissions?.shell).toBe("allow");
  expect(first.hooks.preToolUse).toMatchObject([{ command: "project-only-hook" }]);
  expect((await loadConfig(f.second)).permissions?.shell).toBe("deny");
  expect(first.providers.personal?.apiKey).toBe("profile-test-key");
  expect(await readFile(join(f.profile, "flecten.config.json"), "utf8")).not.toContain(
    "profile-test-key",
  );
  expect(await readFile(join(f.first, "flecten.config.json"), "utf8")).toBe(f.original);
  await saveConfig(f.second, second, { clearSecrets: ["personal"] });
  expect((await loadConfig(f.first)).providers.personal?.apiKey).toBeUndefined();
});

test("explicit config paths keep their existing independent configuration and credential scope", async () => {
  const f = await fixture();
  await loadConfig(f.first);
  const path = join(f.first, "flecten.config.json");
  process.env.FLECTEN_CONFIG = path;
  expect(configPath(f.second)).toBe(path);
  const config = await loadConfig(f.second);
  expect(config.provider).toBe("personal");
  expect(config.providers.personal?.apiKey).toBeUndefined();
});
