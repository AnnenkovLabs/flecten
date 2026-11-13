import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { ModelInfo } from "../../ui/src/lib/types";
import { launchApp } from "./fixtures";

async function withinViewport(page: Page, menu: Locator): Promise<void> {
  const bounds = await menu.boundingBox();
  const size = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(size).not.toBeNull();
  if (!bounds || !size) return;
  expect(bounds.x).toBeGreaterThanOrEqual(7);
  expect(bounds.y).toBeGreaterThanOrEqual(7);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width - 7);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height - 7);
}

test("compact composer: menus, atomic mentions, drafts, attachments and submission", async () => {
  const models: Record<string, ModelInfo> = {};
  for (let index = 0; index < 30; index += 1) {
    models[index === 0 ? "e2e-model" : `model-${index}`] = {
      name: index === 0 ? "E2E Reasoning" : `Модель с длинным названием ${index}`,
      context: 32768,
      output: 4096,
      tools: true,
      reasoning: true,
      reasoningLevels: ["none", "low", "medium", "high", "xhigh"],
    };
  }
  const harness = await launchApp({ models });
  const { page, app, cwd } = harness;
  const path = ".agents/skills/better-accessibility/focus-and-keyboard.md";
  mkdirSync(join(cwd, ".agents/skills/better-accessibility"), { recursive: true });
  writeFileSync(join(cwd, path), "# Keyboard\nKeep focus visible.\n");
  try {
    const prompt = page.locator("#prompt");
    await expect(prompt).toBeVisible();
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, size: number[]) => {
          BrowserWindow.getAllWindows()[0]?.setContentSize(size[0] ?? 0, size[1] ?? 0);
        },
        [width, height],
      );
      await page.setViewportSize({ width, height });
      await page.locator(".model-button").click();
      const picker = page.getByRole("dialog", { name: "Выбор модели" });
      await expect(picker).toBeVisible();
      await withinViewport(page, picker);
      await expect(picker.locator(".list")).toBeVisible();
      await picker.getByRole("combobox").fill("Модель с длинным названием 29");
      await expect(picker.getByRole("option")).toHaveCount(1);
      await picker.getByRole("combobox").fill("");
      await page.screenshot({ path: test.info().outputPath(`models-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect(page.locator(".model-button")).toBeFocused();

      const effort = page.getByRole("button", { name: /^Уровень рассуждений модели:/ });
      await effort.click();
      const reasoning = page.getByRole("dialog", { name: "Уровень рассуждений модели" });
      await withinViewport(page, reasoning);
      await page.screenshot({ path: test.info().outputPath(`reasoning-${width}.png`) });
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await expect(effort).toHaveText("очень высокий");
      await expect(effort).toBeFocused();
    }

    await prompt.fill("Проверь @focus-and");
    await expect(
      page.getByRole("option", { name: "focus-and-keyboard.md", exact: false }),
    ).toBeVisible();
    await prompt.press("Enter");
    const chip = prompt.locator("[data-mention]");
    await expect(chip).toHaveText("@focus-and-keyboard.md");
    await expect(chip).toHaveAttribute("data-path", path);
    await prompt.press("ControlOrMeta+z");
    await expect(chip).toHaveCount(0);
    await prompt.press("ControlOrMeta+Shift+z");
    await expect(chip).toHaveCount(1);
    await prompt.press("End");
    await prompt.press("ArrowLeft");
    await expect(page.getByRole("listbox", { name: "Файлы и папки" })).toHaveCount(0);
    await prompt.press("End");
    await prompt.press("Backspace");
    await prompt.press("Backspace");
    await expect(chip).toHaveCount(0);
    await prompt.press("ControlOrMeta+z");
    await expect(chip).toHaveCount(1);
    await prompt.press("End");
    await page.keyboard.type("и сохрани результат");
    await prompt.press("Shift+Enter");
    await page.keyboard.type("Без изменения API");
    await expect(prompt).toContainText("Без изменения API");

    await prompt.press("ControlOrMeta+a");
    await prompt.press("ControlOrMeta+c");
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      `Проверь @${path} и сохрани результат\nБез изменения API`,
    );
    await prompt.press("ControlOrMeta+v");
    await expect(chip).toHaveCount(1);
    await prompt.press("End");
    await page.getByRole("button", { name: "Новая задача", exact: true }).click();
    // The unsent new-task draft stays on the new-task surface.
    await expect(chip).toHaveCount(1);

    await app.evaluate(
      ({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      },
      join(cwd, "README.md"),
    );
    await page.getByRole("button", { name: "Прикрепить файлы", exact: true }).click();
    await expect(page.getByRole("list", { name: "Вложения" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Добавить вложение", exact: true })).toHaveCount(
      0,
    );
    const voice = await page
      .getByRole("button", { name: "Голосовой ввод", exact: true })
      .boundingBox();
    const send = await page.getByRole("button", { name: "Отправить", exact: true }).boundingBox();
    expect(voice?.y).toBe(send?.y);
    expect((send?.x ?? 0) - (voice?.x ?? 0)).toBeLessThanOrEqual(44);
    await page.screenshot({ path: test.info().outputPath("composer-1180.png") });

    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(prompt).toBeFocused();
    await expect(prompt).toHaveText("");
    await expect(page.getByRole("button", { name: "Остановить", exact: true })).toBeHidden({
      timeout: 45000,
    });
    const user = page.locator(".msg.user").first();
    await expect(user).toContainText(`@${path}`);
    const sessions = join(cwd, ".liquid/sessions");
    const session = readdirSync(sessions, { withFileTypes: true }).find((entry) =>
      entry.isDirectory(),
    )?.name;
    expect(session).toBeDefined();
    const events = readFileSync(join(sessions, session ?? "", "events.jsonl"), "utf8");
    expect(events).toContain("Keep focus visible.");

    // A dock draft keeps its structured chip when leaving and reopening the task.
    await prompt.fill("Дальше @focus-and");
    const fileOption = page.getByRole("option").filter({
      has: page.locator(".lh-mention-name", { hasText: /^focus-and-keyboard\.md$/ }),
    });
    await expect(fileOption).toBeVisible();
    await fileOption.click();
    await expect(chip).toHaveCount(1);
    await page.getByRole("button", { name: "Новая задача", exact: true }).click();
    await expect(prompt).toHaveText("");
    await page.locator("button.task-row").first().click();
    await expect(chip).toHaveCount(1);
    await expect(prompt).toContainText("Дальше");
    await page.locator(".model-button").click();
    const dockPicker = page.getByRole("dialog", { name: "Выбор модели" });
    await withinViewport(page, dockPicker);
    await page.screenshot({ path: test.info().outputPath("dock-models-1180.png") });
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.screenshot({ path: test.info().outputPath("dock-composer-1180.png") });
    await prompt.fill("");
    await prompt.evaluate((element) => {
      const data = new DataTransfer();
      data.setData("text/plain", "<img src=x onerror=alert(1)>");
      data.setData("text/html", '<img src=x onerror="alert(1)">');
      element.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    await expect(prompt).toHaveText("<img src=x onerror=alert(1)>");
    await expect(prompt.locator("img")).toHaveCount(0);
    await prompt.fill("Повторная отправка");
    await prompt.press("Enter");
    await expect(page.getByRole("button", { name: "Остановить", exact: true })).toBeHidden({
      timeout: 45000,
    });
    await prompt.press("ControlOrMeta+z");
    await expect(prompt).toHaveText("");
    expect(harness.consoleErrors, harness.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await harness.close();
  }
});
