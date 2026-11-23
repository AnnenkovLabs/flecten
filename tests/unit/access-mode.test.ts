import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AccessModeSchema,
  activeAccessMode,
  defaultSandboxEnabled,
} from "../../shared/access-mode";
import { configWithAccessMode } from "../../src/app/access";
import { createHandlers } from "../../src/app/server-handlers";
import { createAppService } from "../../src/app/service";
import { defaultConfig } from "../../src/config/defaults";
import { loadConfig, saveConfig } from "../../src/config/load";
import { HarnessConfigSchema } from "../../src/config/schema";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("fresh config and schema agree on autonomous work with folder consent", () => {
  expect(activeAccessMode(defaultConfig())).toBe("agent");
  expect(activeAccessMode(HarnessConfigSchema.parse({}))).toBe("agent");
  expect(defaultConfig().permissions?.externalPath).toBe("ask");
  expect(defaultConfig().sandbox?.allowNetwork).toBe(true);
});

test("mode selection preserves explicit rules, custom protection and other settings", () => {
  const original = HarnessConfigSchema.parse({
    permissions: {
      rules: [{ action: "write", policy: "deny", pathPrefix: "private" }],
      approvalTimeoutMs: 42_000,
    },
    sandbox: { readDenyPrefixes: ["confidential"], envAllowlist: ["PATH"] },
  });
  for (const mode of AccessModeSchema.options) {
    const next = configWithAccessMode(original, mode);
    expect(activeAccessMode(next)).toBe(mode);
    expect(next.permissions?.rules).toEqual(original.permissions?.rules);
    expect(next.permissions?.approvalTimeoutMs).toBe(42_000);
    expect(next.sandbox?.readDenyPrefixes).toEqual(["confidential"]);
    expect(next.sandbox?.envAllowlist).toEqual(["PATH"]);
    expect(next.providers).toEqual(original.providers);
  }
  expect(original.permissions?.write).toBe("allow");
  const full = configWithAccessMode(original, "full");
  if (!full.sandbox) throw new Error("Missing sandbox configuration");
  full.sandbox.enabled = true;
  expect(activeAccessMode(full)).toBe("custom");
  expect(() => configWithAccessMode(original, "yolo")).toThrow();
});

test("access.set persists the real boundary through the app without replacing config", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-access-mode-"));
  dirs.push(cwd);
  const config = defaultConfig();
  config.catalog = { autoRefresh: false, ttlMs: 43_200_000 };
  if (!config.permissions) throw new Error("Missing permission configuration");
  config.permissions.rules = [{ action: "shell", policy: "ask", checkpoint: true }];
  await saveConfig(cwd, config);
  const app = await createAppService(cwd);
  try {
    const providers = app.settings().config.providers;
    const handlers = createHandlers(app, () => undefined);
    await handlers["access.set"]({ type: "access.set", mode: "full" });
    expect(app.info().accessMode).toBe("full");
    expect(app.info().sandbox.enabled).toBe(false);
    const stored = await loadConfig(cwd);
    expect(activeAccessMode(stored)).toBe("full");
    expect(stored.permissions?.rules).toEqual(config.permissions?.rules);
    expect(stored.providers).toEqual(providers);
    await handlers["access.set"]({ type: "access.set", mode: "confirm" });
    expect(app.settings().config.permissions?.shell).toBe("ask");
    expect(app.info().sandbox.enabled).toBe(defaultSandboxEnabled());
    await expect(
      Promise.resolve().then(() => handlers["access.set"]({ type: "access.set", mode: "invalid" })),
    ).rejects.toThrow();
    expect(app.info().accessMode).toBe("confirm");
  } finally {
    await app.dispose();
  }
});
