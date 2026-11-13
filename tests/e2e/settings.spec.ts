import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";

test("settings save practical preferences and apply them to the composer", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({
    delayMs: 1500,
    models: {
      "e2e-model": { name: "E2E Mock", context: 32768, output: 4096, tools: true },
      "equal-limits": { name: "Equal limits", context: 32768, output: 32768, disabled: true },
    },
  });
  try {
    const { page } = h;
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    await expect(dialog.locator("#settings-general")).toBeVisible();
    await expect(dialog.getByText("Ходов на задачу", { exact: true })).toHaveCount(0);
    await expect(dialog.getByText("TTL каталога, часов", { exact: true })).toHaveCount(0);
    await page.getByLabel("Отправка сообщения", { exact: true }).selectOption("modifier-enter");
    await page.getByLabel("Сообщения во время работы", { exact: true }).selectOption("steer");
    await page.getByLabel("Одновременные задачи", { exact: true }).fill("8");
    await page.getByRole("button", { name: "Терминал и инструменты", exact: true }).click();
    await page.getByLabel("Ожидание команды, с", { exact: true }).fill("60");
    await expect(page.getByLabel("Вывод, байт", { exact: true })).toBeHidden();
    await page.getByRole("button", { name: "История и откат", exact: true }).click();
    await page.getByLabel("Хранить снимки, дней", { exact: true }).fill("21");
    await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Бюджеты", exact: true })).toHaveCount(0);
    await page.getByLabel("Хранить снимки, дней", { exact: true }).fill("0");
    await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
    await expect(dialog.locator(".settings-foot")).toContainText("Хранение снимков: От 1 до 365.");
    await expect(
      dialog.locator(".settings-foot").getByText("Не сохранено", { exact: true }),
    ).toHaveCount(0);
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
      await page.getByRole("button", { name: "Общее", exact: true }).click();
      await expect(dialog.locator(".settings-foot").getByRole("alert")).toContainText(
        "Хранение снимков: От 1 до 365.",
      );
      await page.screenshot({ path: test.info().outputPath(`blocked-save-${width}.png`) });
    }
    await page.getByRole("button", { name: "История и откат", exact: true }).click();
    await page.getByLabel("Хранить снимки, дней", { exact: true }).fill("21");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(dialog.getByText("Сохранено", { exact: true })).toBeVisible();
    const saved = JSON.parse(await readFile(join(h.cwd, "flecten.config.json"), "utf8"));
    expect(saved.ui).toEqual({ sendShortcut: "modifier-enter", followUpBehavior: "steer" });
    expect(saved.sessions.maxConcurrent).toBe(8);
    expect(saved.terminal.commandTimeoutMs).toBe(60_000);
    expect(saved.checkpoints.maxAgeDays).toBe(21);
    expect(saved.budgets).toEqual({});
    expect(saved.loop.maxTurns).toBe(0);
    expect(saved.maxOutputTokens).toBe(0);
    await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.reload();
    await expect(page.locator('section[aria-label="Новая сессия"]')).toBeVisible();
    const prompt = page.locator("#prompt");
    await prompt.fill("Read README.md");
    await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeEnabled();
    await prompt.press("Enter");
    await prompt.press("x");
    await expect(prompt).toHaveText("Read README.md\nx");
    await prompt.press("Control+Enter");
    await expect(prompt).toHaveText("");
    await expect(page.getByRole("button", { name: "Остановить", exact: true })).toBeVisible();
    await expect(page.locator("iframe.summary")).toBeVisible();
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
