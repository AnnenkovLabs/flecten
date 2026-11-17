import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { type AppHarness, environmentProblem, launchApp } from "./fixtures";

test("Flecten imports saved renderer preferences and names its Twin source at both sizes", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const directory = await mkdtemp(join(tmpdir(), "flecten-branding-"));
  const cwd = join(directory, "project");
  const userData = join(directory, "profile");
  const screenshots = "/tmp/flecten-branding-review";
  await mkdir(cwd);
  await mkdir(screenshots, { recursive: true });
  await writeFile(
    join(cwd, "flecten.config.json"),
    JSON.stringify({
      useDefaults: false,
      provider: "test",
      model: "test",
      providers: {
        test: {
          protocol: "openai-chat",
          baseUrl: "http://127.0.0.1:1/v1",
          models: { test: { context: 131072, output: 4096, tools: true } },
        },
      },
      catalog: { autoRefresh: false },
    }),
  );
  let harness: AppHarness | undefined;
  try {
    harness = await launchApp({ cwd, userData, locale: null });
    await expect(harness.page.locator("#prompt")).toBeVisible();
    await harness.page.evaluate(() => {
      localStorage.setItem("flecten.userName", "Current name");
      localStorage.setItem("flecten.locale", "en");
      localStorage.removeItem("flecten.reasoning");
    });
    await harness.app.evaluate(async ({ WebContentsView }) => {
      const view = new WebContentsView({
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      try {
        await view.webContents.loadURL("liquid://app/profile-migration");
        await view.webContents.executeJavaScript(`
          localStorage.setItem("flecten.userName", "Old name");
          localStorage.setItem("flecten.locale", "ru");
          localStorage.setItem("liquid.reasoning", "high");
        `);
        view.webContents.session.flushStorageData();
      } finally {
        view.webContents.close();
      }
    });
    expect(harness.consoleErrors).toEqual([]);
    await harness.close();
    harness = undefined;
    await rm(join(userData, "flecten-renderer-origin-v1"));

    harness = await launchApp({ cwd, userData, locale: null });
    const { app, page } = harness;
    await expect(page.locator("#prompt")).toBeVisible();
    expect(page.url()).toBe("flecten://app/index.html");
    expect(await app.evaluate(({ app: electronApp }) => electronApp.getPath("userData"))).toBe(
      userData,
    );
    expect(
      await page.evaluate(() => ({
        name: localStorage.getItem("flecten.userName"),
        locale: localStorage.getItem("flecten.locale"),
        reasoning: localStorage.getItem("flecten.reasoning"),
        legacyReasoning: localStorage.getItem("liquid.reasoning"),
      })),
    ).toEqual({ name: "Current name", locale: "en", reasoning: "high", legacyReasoning: null });
    expect(await readFile(join(userData, "flecten-renderer-origin-v1"), "utf8")).toBe("1\n");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Twin", exact: true }).click({ force: true });
    const panel = page.getByTestId("twin-page");
    const source = panel.locator(".twin-source").filter({
      has: page.getByRole("checkbox", { name: "Learn from Flecten", exact: true }),
    });
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
        },
        { width, height },
      );
      await page.setViewportSize({ width, height });
      await source.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
      await expect(source.locator("strong")).toHaveText("Flecten");
      await expect(source.locator("[data-tooltip]")).toHaveText(join(cwd, ".flecten/sessions"));
      await expect(source.locator("img")).toHaveAttribute("src", "./twin/logos/flecten.svg");
      expect(
        await source
          .locator("img")
          .evaluate(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
          ),
      ).toBe(true);
      expect(await panel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        false,
      );
      const image = await app.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window) throw new Error("The main app window is unavailable");
        const capture = await window.webContents.capturePage(undefined, {
          stayHidden: true,
          stayAwake: true,
        });
        return capture.toPNG().toString("base64");
      });
      await writeFile(
        join(screenshots, `twin-${width}x${height}.png`),
        Buffer.from(image, "base64"),
      );
    }
    expect(harness.consoleErrors).toEqual([]);
  } finally {
    await harness?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
