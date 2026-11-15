import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

test("provider auto refresh preserves its settings and reveals manual overwrite only when enabled", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({ locale: "ru" });
  try {
    const { page } = h;
    async function showPrivateWindow(): Promise<void> {
      if (process.env.FLECTEN_E2E_PRIVATE_DISPLAY !== "1") return;
      await h.app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window?.restore();
        window?.showInactive();
      });
    }
    await showPrivateWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const settings = page.locator("dialog.settings-dialog");
    const toggle = page.getByRole("switch", { name: "Обновлять модели каждый час", exact: true });
    const overwrite = page.getByRole("checkbox", {
      name: "Перезаписывать ручные правки моделей",
      exact: true,
    });

    async function openAdvanced(): Promise<void> {
      await page.getByRole("button", { name: "Настройки", exact: true }).click();
      await expect(settings).toHaveAttribute("aria-busy", "false");
      await page.getByRole("button", { name: "Провайдеры", exact: true }).click();
      await page.locator('[data-provider-id="e2e"]').click();
      await page.getByRole("tab", { name: "Модели", exact: true }).click();
      await expect(toggle).toHaveCount(0);
      await page.getByRole("tab", { name: "Дополнительно", exact: true }).click();
    }

    async function save(): Promise<void> {
      await settings.getByRole("button", { name: "Сохранить", exact: true }).click();
      await expect(settings.getByText("Сохранено", { exact: true })).toBeVisible();
    }

    async function reopen(): Promise<void> {
      await settings.getByRole("button", { name: "Закрыть настройки", exact: true }).click();
      await openAdvanced();
    }

    await openAdvanced();
    await expect(toggle).not.toBeChecked();
    await expect(overwrite).toHaveCount(0);

    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await h.app.evaluate(
        ({ BrowserWindow }, size) => {
          const window = BrowserWindow.getAllWindows()[0];
          window?.setMinimumSize(0, 0);
          window?.setContentSize(size.width, size.height);
          if (process.env.FLECTEN_E2E_PRIVATE_DISPLAY === "1") {
            window?.restore();
            window?.showInactive();
          }
        },
        { width, height },
      );
      await page.setViewportSize({ width, height });
      await toggle.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(toggle).toBeFocused();
      expect(
        await toggle.evaluate(
          (node) => getComputedStyle(node.nextElementSibling as Element).outlineWidth,
        ),
      ).toBe("2px");
      await hiddenScreenshot(
        h,
        test.info().outputPath(`provider-refresh-off-${width}x${height}.png`),
      );
      await showPrivateWindow();
      await toggle.press("Space");
      await expect(toggle).toBeChecked();
      await expect(overwrite).not.toBeChecked();
      const refresh = page.locator(".model-refresh");
      await expect(refresh).toBeVisible();
      expect(
        await refresh.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth && node.scrollWidth <= node.clientWidth;
        }),
      ).toBe(true);
      await hiddenScreenshot(
        h,
        test.info().outputPath(`provider-refresh-on-${width}x${height}.png`),
      );
      await showPrivateWindow();
      if (width === 1480) await toggle.press("Space");
    }

    await save();
    await reopen();
    await expect(toggle).toBeChecked();
    await expect(overwrite).not.toBeChecked();
    await overwrite.focus();
    await overwrite.press("Space");
    await expect(overwrite).toBeChecked();
    await save();
    await reopen();
    await expect(overwrite).toBeChecked();
    await toggle.press("Space");
    await expect(toggle).not.toBeChecked();
    await expect(overwrite).toHaveCount(0);
    await save();
    await reopen();
    await expect(toggle).not.toBeChecked();
    await expect(overwrite).toHaveCount(0);

    const saved = JSON.parse(await readFile(join(h.cwd, "flecten.config.json"), "utf8"));
    expect(saved.providers.e2e.modelAutoRefresh).toEqual({ enabled: false, overwriteManual: true });
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
