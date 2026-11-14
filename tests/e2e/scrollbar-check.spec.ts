import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";

const SIZES = [
  { width: 1480, height: 940 },
  { width: 1180, height: 640 },
] as const;

/** The window is an app, not a page: the document itself never scrolls, only its panels do. */
test("the document never scrolls at either window size, before and after a run", async () => {
  const problem = environmentProblem();
  if (problem) {
    test.skip(true, problem);
    return;
  }
  const harness = await launchApp();
  const { app, page } = harness;
  const measure = async (label: string) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await app.evaluate(({ BrowserWindow }, next) => {
        BrowserWindow.getAllWindows()[0]?.setSize(next.width, next.height);
      }, size);
      await page.waitForTimeout(300);
      const box = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      }));
      const where = `${label} at ${size.width}x${size.height}`;
      expect(box.scrollWidth, `horizontal document scroll ${where}`).toBeLessThanOrEqual(box.width);
      expect(box.scrollHeight, `vertical document scroll ${where}`).toBeLessThanOrEqual(box.height);
    }
  };
  try {
    await expect(page.getByRole("region", { name: "Новая задача", exact: true })).toBeVisible();
    await measure("new session");
    await page.locator("#prompt").fill("Прочитай README.md и покажи итог");
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(page.locator("button.run-summary").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Остановить" })).toBeHidden({ timeout: 45_000 });
    await measure("finished run");
    expect(harness.consoleErrors, harness.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await harness.close();
  }
});
