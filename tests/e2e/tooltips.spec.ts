import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

test("custom tooltips delay hover, support keyboard and preserve full values in modal boundaries", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({
    locale: "en",
    directory: `flecten-tooltip-${"long-project-name-".repeat(11)}`,
  });
  try {
    const { page } = h;
    await page.emulateMedia({ reducedMotion: "reduce" });
    const attachment = page.getByRole("button", { name: "Attach files", exact: true });
    const tooltip = page.getByRole("tooltip");
    await attachment.hover();
    await expect(tooltip).toBeHidden();
    // Verify the deliberate hover delay before waiting for the tooltip to open.
    await page.waitForTimeout(200);
    await expect(tooltip).toBeHidden();
    await expect(tooltip).toHaveText("Attach files, folders, images, or PDFs");
    await expect(tooltip).toBeVisible();
    await expect(attachment).toHaveAccessibleDescription("Attach files, folders, images, or PDFs");
    await expect(attachment).not.toHaveAttribute("title");
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
    await expect(attachment).not.toHaveAttribute("aria-describedby");

    await attachment.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(attachment).toBeFocused();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText("Attach files, folders, images, or PDFs");
    await page.keyboard.press("Escape");

    const project = page.locator(".project-select").filter({ hasText: "long-project-name-" });
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
      await project.hover();
      await expect(tooltip).toHaveText(h.cwd);
      await expect(tooltip).toBeVisible();
      await expect(project).toHaveAccessibleDescription(h.cwd);
      await tooltip.hover();
      await page.waitForTimeout(250);
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toHaveCSS("user-select", "text");
      const bounds = await tooltip.boundingBox();
      if (!bounds) throw new Error("The full project path tooltip has no visible bounds");
      expect(bounds.height).toBeGreaterThan(35);
      expect(bounds.x).toBeGreaterThanOrEqual(8);
      expect(bounds.y).toBeGreaterThanOrEqual(8);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 8);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height - 8);
      await hiddenScreenshot(h, test.info().outputPath(`tooltip-full-path-${width}x${height}.png`));
      await page.keyboard.press("Escape");
    }

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole("button", { name: "Close settings", exact: true });
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await expect(dialog.getByRole("tooltip")).toBeVisible();
    await expect(close).toHaveAccessibleDescription("Close settings (Esc)");
    await expect(page.locator("[title]:not(iframe)")).toHaveCount(0);
    await hiddenScreenshot(h, test.info().outputPath("tooltip-inside-settings.png"));
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    await close.click();
    await expect(dialog).toBeHidden();
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
