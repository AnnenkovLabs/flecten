import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

test("model settings import current metadata and leave unknown limits blank", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const modelId = "mango11/deepseek-v4.1-flash-1017";
  const requests: Array<{ method: string | undefined; path: string | undefined }> = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url });
    response.setHeader("content-type", "application/json");
    if (request.url !== "/v1/models") {
      response.writeHead(404);
      response.end("{}");
      return;
    }
    response.end(
      JSON.stringify({
        data: [
          { id: "active-model" },
          ...[modelId, "stale-model"].map((id) => ({
            id,
            context_length: 1_048_576,
            max_output_tokens: 65_536,
            supports_tools: true,
            supports_reasoning: true,
            reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
          })),
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing metadata provider port");
  const cwd = await mkdtemp(join(tmpdir(), "flecten-model-metadata-"));
  const path = join(cwd, "flecten.config.json");
  await mkdir(join(cwd, ".flecten", "cache"), { recursive: true });
  await writeFile(join(cwd, ".flecten", "cache", "models-dev.json"), "{}");
  await writeFile(join(cwd, ".flecten", "cache", "agent-one.json"), "{}");
  await writeFile(
    path,
    JSON.stringify({
      useDefaults: false,
      provider: "metadata",
      model: "active-model",
      providers: {
        metadata: {
          name: "Metadata provider",
          protocol: "openai-chat",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          models: {
            "active-model": { name: "Active model", context: 131_072, output: 4096 },
            "stale-model": {
              name: "My DeepSeek",
              context: 128_000,
              output: 8192,
              tools: true,
              reasoning: true,
              reasoningMode: "effort",
              reasoningLevels: ["low", "medium", "high"],
              source: "manual",
              headers: { "x-model-option": "preserve" },
              extraBody: { temperature: 0.5 },
              variants: { fast: { name: "Fast", body: { service_tier: "priority" } } },
            },
          },
        },
      },
      catalog: { autoRefresh: false },
    }),
  );
  const h = await launchApp({ cwd, locale: "en" });
  try {
    const { page } = h;
    await h.app.evaluate(({ BrowserWindow }, privateDisplay) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setContentSize(1480, 940);
      if (privateDisplay) {
        window?.restore();
        window?.showInactive();
      }
    }, process.env.FLECTEN_E2E_PRIVATE_DISPLAY === "1");
    await page.setViewportSize({ width: 1480, height: 940 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Providers", exact: true }).click();
    await page.locator('[data-provider-id="metadata"]').click();
    await page.getByRole("tab", { name: "Models", exact: true }).click();
    const modelsPanel = page.getByRole("tabpanel", { name: "Models", exact: true });
    await modelsPanel.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByPlaceholder("Model ID, e.g. deepseek-chat").fill(modelId);
    await page.getByRole("button", { name: "Add model", exact: true }).click();
    const sheet = page.locator("dialog.model-sheet");
    await expect(sheet.getByLabel("Context (tokens)", { exact: true })).toHaveValue("1048576");
    await expect(sheet.getByLabel("Response limit (tokens)", { exact: true })).toHaveValue("65536");
    await expect(sheet.getByRole("button", { name: "maximum", exact: true })).toHaveClass(/is-on/);
    await sheet.getByRole("button", { name: "Done", exact: true }).click();

    await modelsPanel.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByPlaceholder("Model ID, e.g. deepseek-chat").fill("unknown-release-2030");
    await page.getByRole("button", { name: "Add model", exact: true }).click();
    await expect(sheet.getByLabel("Context (tokens)", { exact: true })).toHaveValue("");
    await expect(sheet.getByLabel("Response limit (tokens)", { exact: true })).toHaveValue("");
    await expect(sheet.getByRole("combobox", { name: "Mode", exact: true })).toHaveText("Auto");
    await expect(sheet.locator(".st-chip.is-on")).toHaveCount(0);
    await expect(sheet.getByRole("checkbox").first()).not.toBeChecked();
    await expect(
      sheet.getByText("Unknown limits stay blank. Enter them manually if needed."),
    ).toBeVisible();
    await sheet.getByRole("button", { name: "Done", exact: true }).click();

    await page.locator('.model-main[data-model-id="stale-model"]').click();
    await expect(sheet.getByLabel("Context (tokens)", { exact: true })).toHaveValue("128000");
    await expect(sheet.getByLabel("Response limit (tokens)", { exact: true })).toHaveValue("8192");
    await sheet.getByRole("button", { name: "Refresh model details", exact: true }).click();
    await expect(sheet.getByLabel("Context (tokens)", { exact: true })).toHaveValue("1048576");
    await expect(sheet.getByLabel("Response limit (tokens)", { exact: true })).toHaveValue("65536");
    await expect(sheet.getByRole("textbox").first()).toHaveValue("My DeepSeek");
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await h.app.evaluate(
        ({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
        },
        { width, height },
      );
      await page.setViewportSize({ width, height });
      await sheet
        .getByRole("button", { name: "Refresh model details", exact: true })
        .scrollIntoViewIfNeeded();
      expect(await sheet.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await hiddenScreenshot(h, test.info().outputPath(`model-details-${width}x${height}.png`));
      if (process.env.FLECTEN_E2E_PRIVATE_DISPLAY === "1") {
        await h.app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];
          window?.restore();
          window?.showInactive();
        });
      }
    }
    await sheet.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const saved = JSON.parse(await readFile(path, "utf8"));
    const models = saved.providers.metadata.models;
    const automatic = saved.providers.metadata.modelMetadataBaseline;
    expect(automatic[modelId].context).toBe(1_048_576);
    expect(automatic["stale-model"].output).toBe(65_536);
    expect(automatic["stale-model"].name).not.toBe("My DeepSeek");
    expect(models[modelId].context).toBe(1_048_576);
    expect(models[modelId].output).toBe(65_536);
    expect(models["unknown-release-2030"]).not.toHaveProperty("context");
    expect(models["unknown-release-2030"]).not.toHaveProperty("output");
    expect(models["unknown-release-2030"]).not.toHaveProperty("tools");
    expect(models["unknown-release-2030"]).not.toHaveProperty("reasoning");
    expect(models["unknown-release-2030"]).not.toHaveProperty("reasoningLevels");
    expect(models["stale-model"]).toMatchObject({
      name: "My DeepSeek",
      context: 1_048_576,
      output: 65_536,
      reasoningLevels: ["low", "high", "max"],
      headers: { "x-model-option": "preserve" },
      extraBody: { temperature: 0.5 },
      variants: { fast: { name: "Fast", body: { service_tier: "priority" } } },
    });
    expect(
      requests.filter((request) => request.path === "/v1/models").length,
    ).toBeGreaterThanOrEqual(3);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(cwd, { recursive: true, force: true });
  }
});
