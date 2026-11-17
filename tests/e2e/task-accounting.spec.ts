import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

test("unknown task spending is visible at both supported window sizes", async () => {
  const h = await launchApp({ reply: "Проверка завершена." });
  try {
    await h.page.emulateMedia({ reducedMotion: "reduce" });
    await h.page.locator("#prompt").fill("Прочитай README.md");
    await h.page.locator("#prompt").press("Enter");
    await expect(h.page.getByRole("button", { name: "Остановка", exact: true })).toBeHidden();
    const entries = await readdir(join(h.cwd, ".flecten/sessions"), { withFileTypes: true });
    const sessionId = entries.find((entry) => entry.isDirectory())?.name;
    if (!sessionId) throw new Error("The fixture did not create a session");
    await h.app.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("agent:event", {
        type: "task.budget",
        sessionId: id,
        budget: {
          limits: {},
          spent: { tokens: 500, wallClockMs: 100 },
          remaining: {},
          accounting: { status: "unavailable", missingRequests: 1, unpricedRequests: 0 },
        },
      });
    }, sessionId);
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await h.page.setViewportSize({ width, height });
      await expect(h.page.locator(".strip")).toContainText("Расход неизвестен");
      expect(await h.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await hiddenScreenshot(h, test.info().outputPath(`unknown-cost-${width}x${height}.png`));
    }
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
