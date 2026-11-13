import { expect, test } from "@playwright/test";
import { type ElectronApplication, launchApp, type Page } from "./fixtures";

const LAYOUT_KEY = "liquid.workspace-layout";

async function resize(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size: number[]) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size[0] ?? 0, size[1] ?? 0);
    },
    [width, height],
  );
  await page.setViewportSize({ width, height });
}

async function withinWorkspace(page: Page, split: boolean): Promise<void> {
  const geometry = await page.evaluate(() => {
    const area = document.querySelector(".work-area")?.getBoundingClientRect();
    const thread = document.querySelector(".thread-surface")?.getBoundingClientRect();
    const panel = document.querySelector("#inspector-panel")?.getBoundingClientRect();
    return {
      area: area && { left: area.left, right: area.right, width: area.width },
      thread: thread && { left: thread.left, right: thread.right, width: thread.width },
      panel: panel && { left: panel.left, right: panel.right, width: panel.width },
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.area).toBeDefined();
  expect(geometry.panel).toBeDefined();
  if (!geometry.area || !geometry.panel) return;
  expect(geometry.panel.right).toBeLessThanOrEqual(geometry.area.right + 1);
  if (split) {
    expect(geometry.thread).toBeDefined();
    expect(geometry.thread?.width).toBeGreaterThan(350);
    expect(geometry.panel.width).toBeGreaterThanOrEqual(320);
    expect(geometry.thread?.right ?? 0).toBeLessThanOrEqual(geometry.panel.left + 1);
  } else {
    expect(geometry.panel.left).toBeCloseTo(geometry.area.left, 0);
    expect(geometry.panel.width).toBeCloseTo(geometry.area.width, 0);
  }
}

test("workspace focuses one surface, preserves drafts and restores a fitting split", async () => {
  const harness = await launchApp({
    reply: "Задача выполнена. Файл прочитан, результат проверен.",
  });
  const { app, page } = harness;
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#prompt").waitFor();
    await page.evaluate((key) => localStorage.setItem(key, "unknown-layout"), LAYOUT_KEY);
    await page.reload();
    const prompt = page.locator("#prompt");
    await expect(prompt).toBeVisible();
    await resize(app, page, 1480, 940);
    await prompt.fill("Прочитай README.md и проверь результат");
    await prompt.press("Enter");
    await expect(page.locator(".answer").last()).toBeVisible();
    await expect(page.getByRole("button", { name: "Остановить", exact: true })).toBeHidden();

    const dialog = page.getByRole("tab", { name: "Диалог", exact: true });
    const changes = page.getByRole("tab", { name: "Изменения", exact: false });
    const history = page.getByRole("tab", { name: "История", exact: false });
    const terminal = page.getByRole("tab", { name: "Терминал", exact: true });
    const splitButton = page.getByRole("button", { name: "Диалог и панель рядом", exact: true });
    await expect(dialog).toHaveAttribute("aria-selected", "true");
    await expect(splitButton).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".work-area")).not.toHaveClass(/is-split/);
    await page.screenshot({ path: test.info().outputPath("dialog-1480.png") });
    await prompt.fill("Черновик останется при просмотре результата");

    await resize(app, page, 1180, 640);
    await dialog.focus();
    await page.keyboard.press("ArrowRight");
    await expect(changes).toBeFocused();
    await expect(changes).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".thread-surface")).toBeHidden();
    await expect(page.locator("#pane-changes")).toBeVisible();
    await expect(splitButton).toHaveCount(0);
    await withinWorkspace(page, false);
    await page.screenshot({ path: test.info().outputPath("changes-focused-1180.png") });

    await page.keyboard.press("ArrowRight");
    await expect(history).toBeFocused();
    await expect(page.getByRole("button", { name: "Обновить историю", exact: true })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(terminal).toBeFocused();
    await expect(page.locator("#pane-terminal")).toBeVisible();
    await page.keyboard.press("Home");
    await expect(dialog).toBeFocused();
    await expect(prompt).toHaveText("Черновик останется при просмотре результата");

    await resize(app, page, 1480, 940);
    await expect(splitButton).toBeVisible();
    await splitButton.click();
    await expect(splitButton).toHaveAttribute("aria-pressed", "true");
    await expect(terminal).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".thread-surface")).toBeVisible();
    await expect(page.locator("#pane-terminal")).toBeVisible();
    await expect(page.locator(".work-area")).toHaveClass(/is-split/);
    await withinWorkspace(page, true);
    await expect(prompt).toHaveText("Черновик останется при просмотре результата");
    await page.screenshot({ path: test.info().outputPath("terminal-split-1480.png") });

    await resize(app, page, 1180, 640);
    await expect(page.locator(".work-area")).not.toHaveClass(/is-split/);
    await expect(page.locator(".thread-surface")).toBeHidden();
    await withinWorkspace(page, false);
    await page.screenshot({ path: test.info().outputPath("terminal-focused-1180.png") });
    await resize(app, page, 1480, 940);
    await expect(page.locator(".work-area")).toHaveClass(/is-split/);
    await withinWorkspace(page, true);
    expect(await page.evaluate((key) => localStorage.getItem(key), LAYOUT_KEY)).toBe("split");

    await page.reload();
    await expect(page.locator("button.task-row").first()).toBeVisible();
    await page.locator("button.task-row").first().click();
    await expect(dialog).toBeVisible();
    await changes.click();
    await expect(page.locator(".work-area")).toHaveClass(/is-split/);
    await expect(splitButton).toHaveAttribute("aria-pressed", "true");
    await withinWorkspace(page, true);
    expect(harness.consoleErrors).toEqual([]);
  } finally {
    await harness.close();
  }
});
