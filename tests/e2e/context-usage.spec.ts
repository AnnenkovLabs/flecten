import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp, repoRoot } from "./fixtures";

test("context details show real usage, fit both viewports and survive reopening", async () => {
  const harness = await launchApp({
    usage: { input: 90_900, output: 1200, cached: 4000, reasoning: 800 },
    models: {
      "e2e-model": {
        name: "E2E Mock",
        context: 1_048_576,
        output: 943_718,
        tools: true,
        reasoning: false,
        cost: { input: 2, output: 10, cacheRead: 0.2 },
      },
    },
  });
  const { page, app } = harness;
  const artifactDir = join(repoRoot, ".liquid/context-usage-review");
  mkdirSync(artifactDir, { recursive: true });
  try {
    await page.evaluate(() => localStorage.setItem("flecten.locale", "ru"));
    await page.reload();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".model-button")).toContainText("E2E Mock");
    const button = page.locator(".lh-context-button");
    await expect(button).toBeVisible();
    await button.click({ force: true });
    const popup = page.locator(".lh-context-pop");
    await expect(popup).toContainText("Автосжатие при 100%");
    await expect(popup).not.toContainText("запросов в этой задаче ещё не было");
    await expect(popup.locator(".lh-context-compact")).toBeDisabled();
    await popup.screenshot({ path: join(artifactDir, "context-empty.png") });
    const buttonBox = await button.boundingBox();
    expect(buttonBox?.width).toBeLessThan(62);
    await page.keyboard.press("Escape");
    await expect(button).toBeFocused();
    await page.locator("#prompt").fill("Проверь README");
    await page.locator("#prompt").press("Enter");
    await expect(page.locator(".answer").last()).toBeVisible();
    await expect(page.locator(".composer-actions")).toBeHidden();
    const task = page.locator("button.task-row").first();
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]?.setContentSize(size[0] ?? 1480, size[1] ?? 940),
        [width, height],
      );
      await page.setViewportSize({ width, height });
      await button.click({ force: true });
      await expect(popup.locator(".lh-context-tokens dd")).toHaveText([
        "90.9k",
        "1.2k",
        "800",
        "4k",
        "Нет данных",
      ]);
      await expect(popup.locator(".lh-context-head span")).toHaveText("92.1k из 1.0M · 9%");
      await expect(popup.locator("[role=progressbar]")).toHaveAttribute("aria-valuenow", "9");
      await expect(popup).toContainText("Автосжатие при 100%");
      await expect(popup.locator(".lh-context-models")).toContainText("e2e-model");
      await expect(popup.locator(".lh-context-costs")).toContainText("$0.19");
      const box = await popup.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.y).toBeGreaterThanOrEqual(7);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height - 7);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width - 7);
      const screenshot = await app.evaluate(
        async ({ BrowserWindow }, size) => {
          const window = BrowserWindow.getAllWindows()[0];
          if (!window) throw new Error("app window missing");
          // A minimized window needs a paint after resize before its screenshot is current.
          await window.webContents.capturePage(
            { x: 0, y: 0, ...size },
            { stayHidden: true, stayAwake: true },
          );
          const image = await window.webContents.capturePage(
            { x: 0, y: 0, ...size },
            { stayHidden: true, stayAwake: true },
          );
          return image.toPNG().toString("base64");
        },
        { width, height },
      );
      writeFileSync(join(artifactDir, `context-${width}.png`), Buffer.from(screenshot, "base64"));
      await page.keyboard.press("Escape");
    }
    await page.reload();
    await task.click({ force: true });
    await expect(button).toHaveText("9%");
    await button.click({ force: true });
    await expect(popup.locator(".lh-context-tokens dd")).toHaveText([
      "90.9k",
      "1.2k",
      "800",
      "4k",
      "Нет данных",
    ]);
    await expect(popup.locator(".lh-context-head span")).toHaveText("92.1k из 1.0M · 9%");
    await expect(popup.locator("[role=progressbar]")).toHaveAttribute("aria-valuenow", "9");
    await expect(popup.locator(".lh-context-costs")).toContainText("$0.19");
    expect(harness.consoleErrors).toEqual([]);
  } finally {
    await test.info().attach("console-errors", {
      body: JSON.stringify(harness.consoleErrors),
      contentType: "application/json",
    });
    await harness.close();
  }
});
