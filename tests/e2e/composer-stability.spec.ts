import { expect, type Page, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";

test.skip(Boolean(environmentProblem()), environmentProblem());

async function geometry(page: Page) {
  return page.evaluate(() =>
    [
      ".composer",
      "#prompt",
      ".composer-bar",
      ".model-button",
      ".voice",
      ".send, .composer-actions",
    ].map((selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const { x, y, width, height } = element.getBoundingClientRect();
      return { selector, x, y, width, height };
    }),
  );
}

test("dictation, queue and run updates preserve composer geometry", async () => {
  const h = await launchApp({ fakeMicrophone: true, holdSummary: true });
  const { page, app } = h;
  try {
    const prompt = page.locator("#prompt");
    await expect(prompt).toBeVisible();
    for (const size of [
      { width: 1480, height: 940 },
      { width: 1180, height: 640 },
    ]) {
      await app.evaluate(({ BrowserWindow }, dimensions) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(dimensions.width, dimensions.height);
      }, size);
      await page.setViewportSize(size);
      await prompt.fill("Задача:");
      const idle = await geometry(page);
      const microphone = await page.locator(".voice .icon").elementHandle();
      await page.screenshot({ path: test.info().outputPath(`idle-${size.width}.png`) });
      await page.getByRole("button", { name: "Голосовой ввод", exact: true }).click();
      await expect(page.locator(".voice")).toHaveAttribute("aria-pressed", "true");
      expect(await geometry(page)).toEqual(idle);
      expect(await microphone?.evaluate((element) => element.isConnected)).toBe(true);
      await expect(page.locator(".voice")).toHaveAttribute("title", /Запись/);
      await page.screenshot({ path: test.info().outputPath(`recording-${size.width}.png`) });
      await page.getByRole("button", { name: "Остановить голосовой ввод" }).click();
      await expect(page.locator(".voice-status")).toHaveText("Распознаю речь…");
      expect(await geometry(page)).toEqual(idle);
      await page.screenshot({ path: test.info().outputPath(`processing-${size.width}.png`) });
      await expect(prompt).toHaveText("Задача: Добавь голосовой ввод.");
      expect(await geometry(page)).toEqual(idle);

      await page.getByRole("button", { name: "Голосовой ввод", exact: true }).click();
      await expect(page.locator(".voice")).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Отмена", exact: true }).click();
      await expect(page.locator(".voice-glow")).toHaveCount(0);
    }

    await prompt.fill("Прочитай README.md");
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(page.getByRole("status", { name: "Сводка собирается" })).toBeVisible();
    const running = await geometry(page);
    const editor = await prompt.elementHandle();
    const terminal = await page.getByRole("tab", { name: "Терминал", exact: true }).boundingBox();
    await prompt.fill("Следующее сообщение");
    await page.getByRole("button", { name: "В очередь", exact: true }).click();
    const queue = page.getByRole("region", { name: "Очередь сообщений" });
    await expect(queue).toBeVisible();
    expect(await queue.evaluate((element) => element.closest("form"))).toBeNull();
    expect(await geometry(page)).toEqual(running);
    expect(await editor?.evaluate((element) => element.isConnected)).toBe(true);
    const queueBox = await queue.boundingBox();
    expect(queueBox && queueBox.y + queueBox.height).toBeLessThan(running[0]?.y ?? 0);
    await page.screenshot({ path: test.info().outputPath("queue-1180.png") });

    await queue.getByRole("button", { name: "Изменить сообщение" }).click();
    await queue.getByRole("textbox", { name: "Текст сообщения" }).fill("Изменённое сообщение");
    await queue.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(queue).toContainText("Изменённое сообщение");
    expect(await geometry(page)).toEqual(running);
    await queue.getByRole("button", { name: "Удалить сообщение" }).click();
    await expect(queue).toHaveCount(0);
    expect(await geometry(page)).toEqual(running);

    await h.releaseSummary();
    await expect(page.getByRole("button", { name: "Остановить", exact: true })).toBeHidden();
    expect(await geometry(page)).toEqual(running);
    expect(await page.getByRole("tab", { name: "Терминал", exact: true }).boundingBox()).toEqual(
      terminal,
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Голосовой ввод", exact: true }).click();
    await expect(page.locator(".voice")).toHaveAttribute("aria-pressed", "true");
    expect(await geometry(page)).toEqual(running);
    expect(
      await page
        .locator(".voice-glow")
        .evaluate((el) => el.getAnimations({ subtree: true }).length),
    ).toBe(0);
    await page.keyboard.press("Escape");
    await page.screenshot({ path: test.info().outputPath("finished-1180.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
