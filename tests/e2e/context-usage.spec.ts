import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp, repoRoot } from "./fixtures";

test("context details show real usage, fit both viewports and survive reopening", async () => {
  const harness = await launchApp({
    usage: { input: 6000, output: 1200, cached: 4000, reasoning: 800 },
    models: {
      "e2e-model": {
        name: "E2E Mock",
        context: 131072,
        output: 4096,
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
    await button.click();
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
      await button.click();
      await expect(popup.locator(".lh-context-tokens dd")).toHaveText([
        "6k",
        "1.2k",
        "800",
        "4k",
        "Нет данных",
      ]);
      await expect(popup.locator("[role=progressbar]")).toHaveAttribute("aria-valuenow", "6");
      await expect(popup).toContainText("Автосжатие при 100%");
      await expect(popup.locator(".lh-context-models")).toContainText("e2e-model");
      await expect(popup.locator(".lh-context-costs")).toContainText("$0.02");
      const box = await popup.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.y).toBeGreaterThanOrEqual(7);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height - 7);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width - 7);
      await page.screenshot({ path: join(artifactDir, `context-${width}.png`) });
      await page.keyboard.press("Escape");
    }
    await page.reload();
    await task.click();
    await button.click();
    await expect(popup.locator(".lh-context-tokens dd")).toHaveText([
      "6k",
      "1.2k",
      "800",
      "4k",
      "Нет данных",
    ]);
    expect(harness.consoleErrors).toEqual([]);
  } finally {
    await test.info().attach("console-errors", {
      body: JSON.stringify(harness.consoleErrors),
      contentType: "application/json",
    });
    await harness.close();
  }
});
