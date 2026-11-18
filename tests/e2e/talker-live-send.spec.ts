import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

test("send to an active Talker by keyboard and button while Worker continues", async () => {
  test.skip(Boolean(environmentProblem()), environmentProblem());
  const h = await launchApp({ conversation: true, holdSummary: true });
  try {
    const { page, app } = h;
    const prompt = page.locator("#prompt:visible");
    await prompt.fill("Проверь проект, сохрани API");
    await prompt.press("Enter");

    const progress = page.locator(".answer").filter({ hasText: "Прогоняем E2E тесты." });
    await expect(progress).toHaveClass(/is-streaming/);
    const worker = page.locator(".thread .tool-mirror").filter({ hasText: "WORKER_STREAM_BEGIN" });
    await expect(worker).toBeVisible();
    const actions = page.getByRole("group", { name: "Действия агента" });
    const stop = actions.getByRole("button", { name: "Остановка", exact: true });
    const send = actions.getByRole("button", { name: "Отправить", exact: true });
    const cases = [
      { width: 1480, height: 940, text: "Что уже проверено?", key: true },
      { width: 1180, height: 640, text: "Какой следующий шаг?", key: false },
    ];
    for (const { width, height, text, key } of cases) {
      const size = { width, height };
      await app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height),
        size,
      );
      await page.setViewportSize(size);
      await prompt.fill(text);
      await expect(send).toBeEnabled();
      await expect(stop).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await hiddenScreenshot(h, test.info().outputPath(`talker-live-send-${width}.png`));
      if (key) await prompt.press("Enter");
      else await send.click();
      await expect(prompt).toHaveText("");
      await expect(progress).toHaveClass(/is-streaming/);
    }

    await h.releaseSummary();
    for (const { text } of cases)
      await expect(page.getByText(text, { exact: true })).toHaveCount(1);
    await expect(progress).toHaveCount(2);
    await expect(stop).toBeEnabled();
    await worker.getByRole("button").first().click();
    await expect(worker.locator(".detail")).toContainText("WORKER_LIVE_OUTPUT");
    await writeFile(join(h.cwd, "worker-release"), "go");
    await expect(page.locator("#pane-thread iframe.summary")).toBeVisible();
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
