import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";

test.skip(Boolean(environmentProblem()), environmentProblem());

test("voice records audio, reacts to the mic, transcribes into the draft, cancels safely", async () => {
  const harness = await launchApp({ fakeMicrophone: true });
  const { page, app } = harness;
  try {
    const editor = page.getByRole("textbox", { name: "Сообщение агенту" });
    await expect(page.getByRole("button", { name: "Голосовой ввод", exact: true })).toBeEnabled();
    await editor.fill("Задача:");
    await page.screenshot({ path: ".liquid/voice-before.png" });
    await page.getByRole("button", { name: "Голосовой ввод", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Запись" })).toBeVisible();
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
        },
        { width, height },
      );
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
        width,
        height,
      });
      await expect
        .poll(() =>
          page
            .locator(".voice-glow")
            .evaluate((el) => Number((el as HTMLElement).style.getPropertyValue("--voice-level"))),
        )
        .toBeGreaterThan(0);
      await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeDisabled();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow).toBe(false);
      await page.screenshot({ path: `.liquid/voice-${width}x${height}.png` });
    }
    await page.getByRole("button", { name: "Остановить голосовой ввод" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Распознаю речь" })).toBeVisible();
    await page.screenshot({ path: ".liquid/voice-processing.png" });
    await expect(editor).toHaveText("Задача: Добавь голосовой ввод.");
    await expect(page.locator(".voice-glow")).toHaveCount(0);
    await page.screenshot({ path: ".liquid/voice-result.png" });

    await page.getByRole("button", { name: "Голосовой ввод", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Запись" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".voice-glow")).toHaveCount(0);
    await expect(editor).toHaveText("Задача: Добавь голосовой ввод.");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Голосовой ввод", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Запись" })).toBeVisible();
    const animations = await page
      .locator(".voice-glow")
      .evaluate((el) => el.getAnimations({ subtree: true }).length);
    expect(animations).toBe(0);
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(page.locator(".voice-glow")).toHaveCount(0);
    expect(harness.consoleErrors).toEqual([]);
  } finally {
    await harness.close();
  }
});
