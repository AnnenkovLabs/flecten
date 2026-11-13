import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";

test.skip(Boolean(environmentProblem()), environmentProblem());

test("local speech settings expose models, check missing installs and persist engine choices", async () => {
  const h = await launchApp();
  try {
    const { page, app } = h;
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    const engine = dialog.getByLabel("Движок распознавания", { exact: true });
    await engine.selectOption("faster-whisper");
    const whisper = dialog.getByLabel("Локальная модель faster-whisper", { exact: true });
    await expect(whisper.locator("option")).toHaveCount(6);
    await whisper.selectOption("large-v3-turbo");
    await expect(dialog.getByLabel("Вычисления распознавания")).toHaveValue("cpu");
    await expect(dialog.getByLabel("Модель распознавания", { exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Проверить установку", exact: true }).click();
    await expect(
      dialog.getByRole("status").filter({ hasText: "Движок не установлен" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Установить движок и модель", exact: true }),
    ).toBeEnabled();
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
      for (const current of ["faster-whisper", "vosk"] as const) {
        await engine.selectOption(current);
        await engine.evaluate((el) => el.closest(".st-group")?.scrollIntoView({ block: "start" }));
        if (current === "vosk") {
          const vosk = dialog.getByLabel("Локальная модель Vosk", { exact: true });
          await expect(vosk.locator("option")).toHaveCount(3);
          await vosk.selectOption("vosk-model-small-uk-v3-nano");
          await expect(dialog.getByLabel("Язык речи", { exact: true })).toHaveCount(0);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        );
        await page.screenshot({ path: `.liquid/local-voice-${current}-${width}x${height}.png` });
        await dialog
          .getByRole("button", { name: "Установить движок и модель", exact: true })
          .scrollIntoViewIfNeeded();
        await expect(
          dialog.getByRole("button", { name: "Установить движок и модель", exact: true }),
        ).toBeInViewport();
      }
    }
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(dialog.getByText("Сохранено", { exact: true })).toBeVisible();
    const saved = JSON.parse(await readFile(join(h.cwd, "flecten.config.json"), "utf8"));
    expect(saved.voice).toMatchObject({
      engine: "vosk",
      local: {
        whisperModel: "large-v3-turbo",
        voskModel: "vosk-model-small-uk-v3-nano",
        device: "cpu",
      },
    });
    await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await expect(engine).toHaveValue("vosk");
    await expect(dialog.getByLabel("Локальная модель Vosk", { exact: true })).toHaveValue(
      "vosk-model-small-uk-v3-nano",
    );
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});

test("installed Vosk converts the recorded microphone audio and inserts real recognition", async () => {
  test.skip(
    !process.env.FLECTEN_VOICE_SMOKE_AUDIO || !process.env.FLECTEN_VOICE_HOME,
    "Requires prepared local models and a public microphone WAV",
  );
  const h = await launchApp({
    fakeMicrophone: true,
    fakeMicrophoneFile: process.env.FLECTEN_VOICE_SMOKE_AUDIO ?? "",
    voiceHome: process.env.FLECTEN_VOICE_HOME ?? "",
  });
  try {
    const { page } = h;
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    await dialog.getByLabel("Движок распознавания", { exact: true }).selectOption("vosk");
    await dialog
      .getByLabel("Локальная модель Vosk", { exact: true })
      .selectOption("vosk-model-small-en-us-0.15");
    await dialog.getByRole("button", { name: "Проверить установку", exact: true }).click();
    await expect(
      dialog.getByRole("status").filter({ hasText: "Движок и модель готовы" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(dialog.getByText("Сохранено", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Сообщение агенту" });
    await editor.fill("Dictation:");
    await page.getByRole("button", { name: "Голосовой ввод", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Запись 0:08" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Остановить голосовой ввод" }).click();
    await expect(editor).toContainText("one zero", { timeout: 30_000 });
    await expect(page.locator(".voice-glow")).toHaveCount(0);
    await page.screenshot({ path: ".liquid/local-voice-real-result.png" });
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
