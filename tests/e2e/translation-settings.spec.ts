import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";

test("translation settings stay hidden while other preferences persist at both window sizes", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp();
  try {
    const { page } = h;
    const configPath = join(h.cwd, "flecten.config.json");
    const original = JSON.parse(await readFile(configPath, "utf8"));
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    const save = dialog.getByRole("button", { name: "Сохранить", exact: true });
    await expect(dialog.getByText("Язык агента", { exact: true })).toBeHidden();
    await expect(dialog.getByText("Работать на английском", { exact: true })).toBeHidden();
    await expect(dialog.getByRole("checkbox", { name: "Работать на английском" })).toHaveCount(0);
    await expect(page.getByLabel("Модель перевода", { exact: true })).toBeHidden();
    await expect(page.getByLabel("Язык ответа", { exact: true })).toBeHidden();
    await expect(page.getByLabel("Язык интерфейса", { exact: true })).toBeVisible();
    await page.getByLabel("Отправка сообщения", { exact: true }).selectOption("modifier-enter");
    await expect(save).toBeEnabled();
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
      await expect(save).toBeVisible();
      await expect(dialog.getByText("Язык агента", { exact: true })).toBeHidden();
      const bounds = await dialog.evaluate((element) => ({
        width: element.scrollWidth,
        client: element.clientWidth,
      }));
      expect(bounds.width).toBeLessThanOrEqual(bounds.client + 1);
      await page.screenshot({ path: test.info().outputPath(`translation-${width}.png`) });
    }
    await save.click();
    await expect(dialog.getByText("Сохранено", { exact: true })).toBeVisible();
    const saved = JSON.parse(await readFile(configPath, "utf8"));
    expect(saved.translation).toEqual(original.translation);
    expect(saved.ui.sendShortcut).toBe("modifier-enter");
    await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await expect(dialog.getByText("Работать на английском", { exact: true })).toBeHidden();
    await expect(page.getByLabel("Отправка сообщения", { exact: true })).toHaveValue(
      "modifier-enter",
    );
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
