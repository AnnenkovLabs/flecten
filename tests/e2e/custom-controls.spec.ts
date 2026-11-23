import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

test("custom settings controls support keyboard, dismissal and saved values", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({ locale: "en" });
  try {
    const { page } = h;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    const shortcut = dialog.getByRole("combobox", { name: "Send message", exact: true });
    await shortcut.focus();
    await shortcut.press("Enter");
    const options = page.getByRole("listbox").getByRole("option");
    await expect(options).toHaveCount(2);
    await page.keyboard.press("End");
    await expect(options.last()).toBeFocused();
    await page.keyboard.press("Home");
    await expect(options.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(options.last()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(shortcut).toBeFocused();
    await expect(shortcut).toHaveAttribute("value", "modifier-enter");

    await shortcut.press("Space");
    await page.keyboard.press("Home");
    await page.keyboard.press("Escape");
    await expect(shortcut).toBeFocused();
    await expect(shortcut).toHaveAttribute("value", "modifier-enter");
    await expect(dialog).toBeVisible();
    await shortcut.press("Enter");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(
      dialog.getByRole("combobox", { name: "Messages while working", exact: true }),
    ).toBeFocused();

    const language = dialog.getByRole("combobox", { name: "Interface language", exact: true });
    await language.click();
    await page.keyboard.press("p");
    await expect(
      page.getByRole("option", { name: "Português (Brasil)", exact: true }),
    ).toBeFocused();
    await dialog.getByRole("heading", { name: "General", exact: true }).click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(language).toHaveAttribute("value", "en");
    await language.focus();
    await language.press("p");
    await expect(
      page.getByRole("option", { name: "Português (Brasil)", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await language.press("End");
    await expect(page.getByRole("option").last()).toBeFocused();
    await page.keyboard.press("Escape");
    await language.press("Home");
    await expect(page.getByRole("option").first()).toBeFocused();
    await page.keyboard.press("Escape");

    await dialog.getByRole("button", { name: "Appearance", exact: true }).click();
    const scale = dialog.getByRole("slider", { name: "Interface scale", exact: true });
    await expect(scale).toHaveCSS("appearance", "none");
    await scale.focus();
    await scale.press("ArrowRight");
    await expect(scale).toHaveAttribute("aria-valuetext", "105%");
    await dialog
      .getByRole("button", { name: "Reset Interface scale to 100%", exact: true })
      .click();
    await expect(scale).toHaveAttribute("aria-valuetext", "100%");

    await dialog.getByRole("button", { name: "Access", exact: true }).click();
    await dialog.getByText("Advanced access settings", { exact: true }).click();
    const source = dialog.getByRole("checkbox").first();
    await expect(source).toHaveCSS("appearance", "none");
    const wasChecked = await source.isChecked();
    await source.focus();
    await source.press("Space");
    await expect(source).toBeChecked({ checked: !wasChecked });
    await source.press("Space");
    await expect(source).toBeChecked({ checked: wasChecked });

    await dialog.getByRole("button", { name: "Models", exact: true }).click();
    const reasoning = dialog.getByRole("combobox", {
      name: "Default main model: Model reasoning level",
      exact: true,
    });
    await expect(reasoning).toBeDisabled();
    await dialog.getByRole("button", { name: "General", exact: true }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByText("Saved", { exact: true })).toBeVisible();
    const saved = JSON.parse(await readFile(join(h.cwd, "flecten.config.json"), "utf8"));
    expect(saved.ui.sendShortcut).toBe("modifier-enter");

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
      await language.click();
      const listbox = page.getByRole("listbox");
      await expect(listbox).toBeVisible();
      await expect(page.locator(".floating-menu:popover-open")).toHaveCSS("opacity", "1");
      const bounds = await listbox.boundingBox();
      if (!bounds) throw new Error("The select listbox has no visible bounds");
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
      await hiddenScreenshot(h, test.info().outputPath(`custom-controls-${width}x${height}.png`));
      await page.keyboard.press("Escape");
    }
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(shortcut).toHaveAttribute("value", "modifier-enter");
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
