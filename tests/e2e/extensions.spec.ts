import { expect, test } from "@playwright/test";
import { type AppHarness, environmentProblem, launchApp } from "./fixtures";

async function snapshot(h: AppHarness, name: string): Promise<void> {
  const sizes: Array<[number, number]> = [
    [1480, 940],
    [1180, 640],
  ];
  for (const [width, height] of sizes) {
    await h.app.evaluate(
      ({ BrowserWindow }, size: [number, number]) =>
        BrowserWindow.getAllWindows()[0]?.setContentSize(size[0], size[1]),
      [width, height] as [number, number],
    );
    await h.page.setViewportSize({ width, height });
    await h.page.evaluate(() => document.fonts.ready.then(() => true));
    const overflow = await h.page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    await h.page.screenshot({
      path: test.info().outputPath(`${name}-${width}x${height}.png`),
      animations: "disabled",
    });
  }
}

test("settings expose modules without the retired plugin section", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp();
  try {
    const { page } = h;
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    await expect(dialog.getByRole("button", { name: "Плагины", exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Модули", exact: true }).click();
    await dialog.getByRole("button", { name: "Установленные", exact: false }).click();
    await expect(dialog.getByLabel("Папка модуля", { exact: true })).toBeVisible();
    await snapshot(h, "modules-without-plugins");
    const search = dialog.getByLabel("Поиск по разделам и полям", { exact: true });
    await search.fill("Плагины");
    await expect(dialog.getByRole("button", { name: "Плагины", exact: true })).toHaveCount(0);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});

test("MCP and hooks settings expose typed controls at both viewport sizes", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp();
  try {
    const { page } = h;
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await page.getByRole("button", { name: "MCP", exact: true }).click();
    await page.getByRole("button", { name: "Добавить сервер", exact: true }).click();
    await expect(page.locator(".server-card")).toBeVisible();
    await snapshot(h, "mcp-settings");
    await page.getByRole("button", { name: "Автоматические действия", exact: true }).click();
    await expect(page.getByLabel("Когда")).toHaveValue("preToolUse");
    await expect(page.getByLabel("Когда").locator('option[value="permission"]')).toHaveCount(1);
    await expect(page.getByLabel("Когда").locator('option[value="toolBatch"]')).toHaveCount(1);
    await snapshot(h, "hook-settings");
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
