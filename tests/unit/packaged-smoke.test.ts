import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const { smokeEnvironment, validateSmokeResult } =
  require("../../scripts/smoke-environment.mjs") as {
    smokeEnvironment(env: Record<string, string>, cwd: string, out: string): Record<string, string>;
    validateSmokeResult(result: unknown, cwd: string): unknown;
  };
const { bundledAgent, smokeRenderer } = require("../../shell/packaged-smoke.mjs") as {
  bundledAgent(command: string, resources: string, packaged: boolean): unknown;
  smokeRenderer(win: {
    webContents: { executeJavaScript(script: string): Promise<unknown> };
  }): Promise<unknown>;
};

test("packaged smoke removes current and legacy product overrides", () => {
  const env = smokeEnvironment(
    {
      PATH: "/fixture/bin",
      FLECTEN_AGENT_BIN: "/external",
      LIQUID_AGENT_BIN: "/legacy",
      FLECTEN_DEV_URL: "http://fixture.invalid",
      LIQUID_DEV_URL: "http://legacy.invalid",
      FLECTEN_PROFILE: "/profile",
      LIQUID_MODEL: "foreign-model",
      ELECTRON_RUN_AS_NODE: "1",
    },
    "/smoke",
    "/smoke/status.json",
  );
  expect(env).toEqual({
    PATH: "/fixture/bin",
    FLECTEN_SMOKE: "1",
    FLECTEN_SMOKE_OUT: "/smoke/status.json",
    FLECTEN_CWD: "/smoke",
    FLECTEN_CONFIG: "/smoke/flecten.config.json",
    FLECTEN_HEADLESS: "1",
  });
  expect(() =>
    validateSmokeResult({ type: "status", cwd: "/smoke", providers: [{}] }, "/smoke"),
  ).toThrow("renderer");
});

test("packaged smoke refuses a development or external agent executable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flecten-smoke-bundle-"));
  const name = process.platform === "win32" ? "flecten-agent.exe" : "flecten-agent";
  const expected = join(directory, name);
  const external = join(directory, "external-agent");
  try {
    await writeFile(expected, "fixture");
    await writeFile(external, "fixture");
    expect(() => bundledAgent(expected, directory, false)).toThrow("installed package");
    expect(() => bundledAgent(external, directory, true)).toThrow("bundled agent");
    expect(bundledAgent(expected, directory, true)).toMatchObject({
      command: expected,
      expected,
      packaged: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("renderer probe requires preload, receives status over its bridge and observes composer/model", async () => {
  const status = { type: "status", cwd: "/smoke", model: "smoke-model", providers: [{}] };
  let listener: ((event: unknown) => void) | undefined;
  let unsubscribed = false;
  let sent: unknown;
  const context = {
    window: {
      desktop: {
        agent: {
          onEvent: (next: (event: unknown) => void) => {
            listener = next;
            return () => {
              unsubscribed = true;
            };
          },
          send: (command: unknown) => {
            sent = command;
            queueMicrotask(() => listener?.(status));
          },
        },
      },
    },
    document: {
      documentElement: {},
      querySelector: (selector: string) =>
        selector.startsWith("#prompt")
          ? { getBoundingClientRect: () => ({ width: 300 }) }
          : { getAttribute: () => "Smoke · smoke-model" },
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout,
    clearTimeout,
  };
  const result = await smokeRenderer({
    webContents: { executeJavaScript: (script) => runInNewContext(script, context) },
  });
  expect(sent).toEqual({ type: "hello" });
  expect(unsubscribed).toBe(true);
  expect(result).toMatchObject({
    status,
    renderer: { ready: true, preload: true, composer: true },
  });
  await expect(
    smokeRenderer({
      webContents: { executeJavaScript: (script) => runInNewContext(script, { window: {} }) },
    }),
  ).rejects.toThrow("preload");
});
