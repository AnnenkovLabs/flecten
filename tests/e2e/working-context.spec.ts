import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp } from "./fixtures";

test("task navigation keeps attachments, reading position and follow-at-end intent", async () => {
  const reply = Array.from(
    { length: 35 },
    (_, index) =>
      `### Результат ${index + 1}\n\nПроверена часть проекта. Подробное объяснение результата и следующего действия.`,
  ).join("\n\n");
  const harness = await launchApp({ reply });
  const { page, app, cwd } = harness;
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const prompt = page.locator("#prompt");
    await expect(prompt).toBeVisible();
    await prompt.fill("Первая задача");
    await prompt.press("Enter");
    await expect(page.locator(".answer").last()).toBeVisible();
    await expect(page.getByRole("button", { name: "Остановка", exact: true })).toBeHidden();
    const task = page.locator("button.task-row").first();
    await app.evaluate(
      ({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      },
      join(cwd, "README.md"),
    );
    await page.getByRole("button", { name: "Прикрепить файлы", exact: true }).click();
    await expect(page.getByRole("list", { name: "Вложения" })).toBeVisible();
    await prompt.fill("Черновик первой задачи");
    await page.locator(".thread").evaluate((node) => {
      node.scrollTop = 180;
    });
    await expect.poll(() => page.locator(".thread").evaluate((node) => node.scrollTop)).toBe(180);
    await expect(page.locator("button.jump")).toBeVisible();

    await page.getByRole("button", { name: "Новая задача", exact: true }).click();
    await expect(prompt).toHaveText("");
    await expect(page.getByRole("list", { name: "Вложения" })).toHaveCount(0);
    await prompt.fill("Отдельный черновик");
    await task.click();
    await expect(prompt).toHaveText("Черновик первой задачи");
    await expect(page.getByRole("list", { name: "Вложения" })).toContainText("README.md");
    await expect.poll(() => page.locator(".thread").evaluate((node) => node.scrollTop)).toBe(180);
    await expect(page.locator("button.jump")).toBeVisible();

    await page.locator("button.jump").click();
    await expect(page.locator("button.jump")).toHaveCount(0);
    await page.getByRole("button", { name: "Новая задача", exact: true }).click();
    await expect(prompt).toHaveText("Отдельный черновик");
    await task.click();
    await expect
      .poll(() =>
        page
          .locator(".thread")
          .evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
      )
      .toBeLessThanOrEqual(2);
    await expect(page.locator("button.jump")).toHaveCount(0);
    expect(harness.consoleErrors).toEqual([]);
  } finally {
    await harness.close();
  }
});
