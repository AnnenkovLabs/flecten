import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";

test("thread and composer polish", async () => {
  const problem = environmentProblem();
  if (problem) {
    test.skip(true, problem);
    return;
  }
  const harness = await launchApp({ delayMs: 300 });
  const { app, page } = harness;
  try {
    await expect(page.locator('section[aria-label="Новая сессия"]')).toBeVisible();
    await page.setViewportSize({ width: 1180, height: 640 });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1180, 640);
    });
    await page.waitForTimeout(500);

    await page.locator("#prompt").fill("Прочитай README.md и покажи итог");
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(page.locator("#prompt")).toBeFocused();
    await expect(page.locator(".msg-time").first()).toBeVisible();
    await expect(page.locator(".answer-time").first()).toBeVisible();
    await expect(page.locator("button.run-summary").first()).toBeVisible({ timeout: 30_000 });

    await page.screenshot({ path: test.info().outputPath("thread-1180.png") });

    await page.locator(".thread").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.waitForTimeout(300);
    const jumpVisible = await page.locator("button.jump").isVisible();
    console.log(`jump before new message: ${jumpVisible}`);

    await page.keyboard.press("Control+f");
    await expect(page.locator(".thread-search input")).toBeFocused();
    await page.locator(".thread-search input").fill("README");
    await expect(page.locator(".thread-search .search-count")).not.toHaveText("нет");
    await page.getByRole("button", { name: "Следующее совпадение" }).click();
    await page.screenshot({ path: test.info().outputPath("search-1180.png") });
    await page.keyboard.press("Escape");
    await expect(page.locator(".thread-search")).toHaveCount(0);
    await expect(page.locator("#prompt")).toBeFocused();

    await page.locator("#prompt").fill("Ещё один шаг");
    await page.locator("#prompt").press("Enter");
    await expect(page.locator("button.jump")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("jump-1180.png") });
    await page.locator("button.jump").click();
    await expect(page.locator("button.jump")).toHaveCount(0);

    const task = page.locator(".task").first();
    await task.hover();
    await task.getByRole("button", { name: /Действия:/ }).click();
    await task.getByRole("menuitem", { name: "Переименовать" }).click();
    await task.getByRole("textbox", { name: "Новое имя задачи" }).fill("Новое имя");
    await task.getByRole("textbox", { name: "Новое имя задачи" }).press("Enter");
    await expect(task.locator(".task-title")).toHaveText("Новое имя");

    await task.hover();
    await task.getByRole("button", { name: /Действия:/ }).click();
    await task.getByRole("menuitem", { name: "Удалить" }).click();
    await expect(task.getByText("Удалить задачу?")).toBeVisible();
    await task.getByRole("button", { name: "Отмена" }).click();

    const search = page.getByRole("textbox", { name: "Поиск задач" });
    await search.fill("Новое имя");
    await expect(page.locator(".task")).toHaveCount(1);
    await search.fill("zzz");
    await expect(page.getByText("Ничего не найдено")).toBeVisible();
    await search.fill("");

    const dataTransfer = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" }),
      );
      return transfer;
    });
    await page.locator("#prompt").dispatchEvent("dragover", { dataTransfer });
    await expect(page.locator(".drop-hint")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("drop-1180.png") });
    await page.locator("#prompt").dispatchEvent("drop", { dataTransfer });

    await page.screenshot({ path: test.info().outputPath("final-1180.png") });

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1480, 940);
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: test.info().outputPath("final-1480.png") });

    const overflow = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    console.log(`overflow: ${JSON.stringify(overflow)}`);

    expect(harness.consoleErrors, harness.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await harness.close();
  }
});
