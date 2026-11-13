#!/usr/bin/env node
// Headless visual preview of the real app: Electron + real sidecar + local mock provider.
// Works without a display (Ozone headless + SwiftShader).
//   node scripts/ui-preview.mjs <scenario.json> [outDir]
// Scenario: { "projectName": "atlas", "workspace": {"README.md": "..."}, "steps": [
//   {"size": [1480, 940]}, {"shot": "name"}, {"fill": ["selector", "text"]}, {"press": "Enter"},
//   {"click": "selector"}, {"wait": "selector"} | {"wait": 500}, {"eval": "js in renderer"},
//   {"emit": {"type": "error", ...}} (an event as if the core had sent it;
//   "sessionId": "@latest" targets the task updated last) ] }
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scenarioPath = process.argv[2];
const outDir = resolve(process.argv[3] ?? join(repoRoot, ".liquid/preview"));
if (!scenarioPath) {
  console.error("usage: node scripts/ui-preview.mjs <scenario.json> [outDir]");
  process.exit(2);
}
const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));
mkdirSync(outDir, { recursive: true });

function startMock() {
  const child = spawn("bun", [join(repoRoot, "scripts/e2e-mock.mjs")], {
    cwd: repoRoot,
    env: { ...process.env, E2E_MOCK_PORT: "0", ...(scenario.mockEnv ?? {}) },
    stdio: ["ignore", "pipe", "ignore"],
  });
  return new Promise((resolveUrl, reject) => {
    const lines = createInterface({ input: child.stdout });
    const timer = setTimeout(() => reject(new Error("mock provider did not start")), 15_000);
    lines.on("line", (line) => {
      let port;
      try {
        port = JSON.parse(line).port;
      } catch {
        return;
      }
      if (typeof port !== "number") return;
      clearTimeout(timer);
      resolveUrl({ url: `http://127.0.0.1:${port}`, stop: () => child.kill("SIGTERM") });
    });
  });
}

const cwd = scenario.projectName
  ? join(tmpdir(), scenario.projectName)
  : mkdtempSync(join(tmpdir(), "liquid-preview-"));
if (scenario.projectName) {
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });
}
const home = mkdtempSync(join(tmpdir(), "liquid-preview-home-"));
for (const [name, text] of Object.entries(scenario.workspace ?? { "README.md": "# Demo\n" })) {
  mkdirSync(dirname(join(cwd, name)), { recursive: true });
  writeFileSync(join(cwd, name), text);
}
const mock = await startMock();
const configPath = join(cwd, "flecten.config.json");
writeFileSync(
  configPath,
  JSON.stringify(
    scenario.config ?? {
      useDefaults: false,
      provider: "mock",
      model: "e2e-model",
      providers: {
        mock: {
          name: "Mock",
          protocol: "openai-chat",
          baseUrl: `${mock.url}/v1`,
          apiKey: "sk-preview",
          models: {
            "e2e-model": { name: "E2E Model", context: 128000, output: 8192, tools: true },
          },
        },
      },
    },
    null,
    2,
  ).replaceAll("$MOCK_URL", mock.url),
);

const executablePath = createRequire(import.meta.url)("electron");
const env = { ...process.env, FLECTEN_CWD: cwd, FLECTEN_CONFIG: configPath, HOME: home };
delete env.ELECTRON_RUN_AS_NODE;
delete env.FLECTEN_DEV_URL;
const app = await electron.launch({
  executablePath,
  args: [
    "--ozone-platform=headless",
    "--ozone-override-screen-size=1920,1200",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--force-device-scale-factor=1",
    join(repoRoot, "shell/main.mjs"),
  ],
  env,
  cwd,
  timeout: 60_000,
});
const page = await app.firstWindow();
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(String(error)));
await page.waitForLoadState("domcontentloaded");

async function setSize(width, height) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(size[0], size[1]);
    },
    [width, height],
  );
  await page.setViewportSize({ width, height }).catch(() => undefined);
  await page.waitForTimeout(300);
}

/** The task updated last, for `{"emit": {"sessionId": "@latest"}}`. */
function latestSession() {
  const index = JSON.parse(readFileSync(join(cwd, ".liquid/sessions/index.json"), "utf8"));
  const sessions = [...(index.sessions ?? [])].sort((a, b) =>
    String(b.updatedAt).localeCompare(String(a.updatedAt)),
  );
  return sessions[0]?.id ?? "";
}

let exitCode = 0;
try {
  await setSize(1480, 940);
  await page.waitForTimeout(scenario.settleMs ?? 1200);
  for (const step of scenario.steps ?? []) {
    if (step.size) await setSize(step.size[0], step.size[1]);
    if (step.fill) await page.fill(step.fill[0], step.fill[1]);
    if (step.type) await page.keyboard.type(step.type);
    if (step.press) await page.keyboard.press(step.press);
    if (step.click) await page.click(step.click);
    if (typeof step.wait === "number") await page.waitForTimeout(step.wait);
    if (typeof step.wait === "string") await page.waitForSelector(step.wait, { timeout: 30_000 });
    if (step.eval) console.log(`eval: ${JSON.stringify(await page.evaluate(step.eval))}`);
    if (step.emit) {
      const event =
        step.emit.sessionId === "@latest"
          ? { ...step.emit, sessionId: latestSession() }
          : step.emit;
      await app.evaluate(({ BrowserWindow }, payload) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send("agent:event", payload);
      }, event);
    }
    if (step.shot) {
      const file = join(outDir, `${step.shot}.png`);
      await page.screenshot({ path: file, fullPage: false });
      console.log(`shot: ${file}`);
    }
  }
} catch (error) {
  exitCode = 1;
  console.error(`preview failed: ${error instanceof Error ? error.message : String(error)}`);
  await page.screenshot({ path: join(outDir, "failure.png") }).catch(() => undefined);
} finally {
  if (errors.length > 0) console.log(`renderer errors:\n${errors.join("\n")}`);
  await app.close().catch(() => undefined);
  mock.stop();
  rmSync(cwd, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
process.exit(exitCode);
