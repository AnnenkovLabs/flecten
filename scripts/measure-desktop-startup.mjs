import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "@playwright/test";
import { ITERATIONS, P95_BUDGET_MS, summarizeStartup } from "./measure-startup.mjs";

const executablePath = process.argv[2];
if (!executablePath)
  throw new Error("Usage: bun scripts/measure-desktop-startup.mjs <packaged executable>");
const samples = [];

for (let run = 0; run < ITERATIONS; run += 1) {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-desktop-startup-"));
  const configPath = join(cwd, "flecten.config.json");
  const model = "startup-ready";
  await writeFile(
    configPath,
    JSON.stringify({
      useDefaults: false,
      provider: "startup",
      model,
      providers: {
        startup: {
          name: "Startup",
          protocol: "openai-chat",
          baseUrl: "http://127.0.0.1:9/v1",
          models: { [model]: { name: "Startup ready", context: 8192, output: 1024, tools: true } },
        },
      },
      catalog: { autoRefresh: false, ttlMs: 43_200_000 },
    }),
  );
  const env = {
    ...process.env,
    FLECTEN_CWD: cwd,
    FLECTEN_CONFIG: configPath,
    FLECTEN_SECRET_BACKEND: "file",
    FLECTEN_HEADLESS: "1",
  };
  for (const name of [
    "ELECTRON_RUN_AS_NODE",
    "FLECTEN_DEV_URL",
    "FLECTEN_DEVTOOLS",
    "FLECTEN_AGENT_BIN",
    "FLECTEN_PROVIDER",
    "FLECTEN_MODEL",
    "FLECTEN_SMOKE",
    "FLECTEN_SMOKE_OUT",
  ])
    delete env[name];
  let app;
  try {
    const started = performance.now();
    app = await electron.launch({
      executablePath: resolve(executablePath),
      args: [`--user-data-dir=${join(cwd, "profile")}`],
      env,
      timeout: 20_000,
    });
    const page = await app.firstWindow();
    await page.locator(".model-button", { hasText: "Startup ready" }).waitFor({ timeout: 20_000 });
    await page.locator('[contenteditable="true"]').waitFor({ timeout: 20_000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    });
    // The rendered configured model proves the renderer received sidecar status.
    const ms = Math.round(performance.now() - started);
    samples.push(ms);
    console.log(`desktop startup run ${run + 1}: ${ms}ms`);
  } finally {
    await app?.close();
    await rm(cwd, { recursive: true, force: true });
  }
}

const result = summarizeStartup(samples, P95_BUDGET_MS);
console.log(
  JSON.stringify({
    target: "packaged-window-and-sidecar",
    executablePath: resolve(executablePath),
    freshProfiles: true,
    samples,
    ...result,
  }),
);
if (!result.ok) process.exitCode = 1;
