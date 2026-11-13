import { expect, test } from "@playwright/test";
import { launchApp } from "./fixtures";

test("segmented composer actions and copy buttons preserve keyboard and failure feedback", async () => {
  const h = await launchApp({ holdSummary: true });
  const { page, app } = h;
  try {
    await page.locator("#prompt").fill("Прочти README.md");
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(page.getByRole("button", { name: "Остановка", exact: true })).toBeVisible();
    await page.locator("#prompt").fill("Следующая инструкция");
    const actions = page.getByRole("group", { name: "Действия агента" });
    await expect(actions.getByRole("button")).toHaveCount(3);
    await actions.getByRole("button", { name: "Остановка", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(
      actions.getByRole("button", { name: "Добавить в очередь", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      actions.getByRole("button", { name: "Уточнить сейчас", exact: true }),
    ).toBeFocused();
    await page.locator("#prompt").fill("");
    await expect(page.locator(".answer-actions")).toHaveCount(0);
    await expect(page.locator(".answer-foot")).toHaveCount(0);
    await h.releaseSummary();
    const copy = page.locator(".answer .copy-button").first();
    await expect(copy).toBeVisible();
    await copy.click();
    await expect(copy).toHaveAccessibleName("Скопировано");
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).not.toBe("");
    await expect(copy).toHaveAccessibleName("Скопировать ответ");
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error("denied");
          },
        },
      }),
    );
    await copy.click();
    await expect(copy).toHaveAccessibleName("Скопировать ответ");
    await expect(
      page.getByText("Не удалось скопировать. Попробуйте ещё раз.", { exact: true }),
    ).toBeVisible();
    await expect(copy).not.toHaveClass(/is-copied/);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
