import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp, repoRoot } from "./fixtures";

test("focus rings follow intentional keyboard navigation in dialogs and popovers", async () => {
  const harness = await launchApp({
    models: {
      "e2e-model": {
        name: "E2E Mock",
        context: 32768,
        output: 4096,
        tools: true,
        reasoning: true,
      },
    },
  });
  const artifacts = join(repoRoot, ".liquid/focus-navigation-review");
  mkdirSync(artifacts, { recursive: true });
  try {
    const { page, app } = harness;
    await page.emulateMedia({ reducedMotion: "reduce" });
    const settings = page.getByRole("button", { name: "Настройки", exact: true });
    const dialog = page.locator("dialog.settings-dialog");
    const section = dialog.locator(".section-main").first();
    const next = dialog.locator(".section-main").nth(1);
    const select = page.locator(".composer-select").first();
    const options = page.getByRole("option");

    for (const size of [
      { width: 1480, height: 940 },
      { width: 1180, height: 640 },
    ]) {
      await app.evaluate(({ BrowserWindow }, dimensions) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(dimensions.width, dimensions.height);
      }, size);
      await page.setViewportSize(size);
      await settings.click();
      await section.click();
      await expect(section).toHaveCSS("outline-style", "none");
      for (const key of ["a", "Shift", "ArrowLeft"]) {
        await page.keyboard.press(key);
        await expect(section).toBeFocused();
        await expect(section).toHaveCSS("outline-style", "none");
      }
      await page.screenshot({ path: join(artifacts, `settings-pointer-${size.width}.png`) });

      await page.keyboard.press("Tab");
      await expect(next).toBeFocused();
      await expect(next).toHaveCSS("outline-style", "solid");
      await page.keyboard.press("Shift+Tab");
      await expect(section).toBeFocused();
      await expect(section).toHaveCSS("outline-style", "solid");
      await page.screenshot({ path: join(artifacts, `settings-keyboard-${size.width}.png`) });

      await section.click();
      await page.keyboard.press("a");
      await expect(section).toHaveCSS("outline-style", "none");
      const search = dialog.locator(".settings-search input");
      await search.click();
      await page.keyboard.type("MCP");
      await expect(search).toHaveValue("MCP");
      await expect(search).toBeFocused();
      await search.fill("");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(settings).toBeFocused();
      await expect(settings).toHaveCSS("outline-style", "none");

      await select.click();
      const selected = page.getByRole("option", { selected: true });
      await expect(selected).toBeFocused();
      await page.keyboard.press("a");
      await expect(selected).toBeFocused();
      await expect(selected).toHaveCSS("outline-style", "none");
      await expect(page.locator(".floating-menu")).toHaveCSS("opacity", "1");
      await page.screenshot({ path: join(artifacts, `popover-pointer-${size.width}.png`) });
      await page.keyboard.press("ArrowDown");
      await expect(options.nth(1)).toBeFocused();
      await expect(options.nth(1)).toHaveCSS("outline-style", "solid");
      await page.keyboard.press("End");
      await expect(options.last()).toBeFocused();
      await expect(options.last()).toHaveCSS("outline-style", "solid");
      await page.keyboard.press("Home");
      await expect(options.first()).toBeFocused();
      await expect(options.first()).toHaveCSS("outline-style", "solid");
      await page.screenshot({ path: join(artifacts, `popover-keyboard-${size.width}.png`) });
      await page.keyboard.press("Escape");
      await expect(select).toBeFocused();
      await expect(select).toHaveCSS("outline-style", "solid");
      await select.click();
      await options.first().click();
      await page.keyboard.press("a");
      await expect(select).toBeFocused();
      await expect(select).toHaveCSS("outline-style", "none");
    }
    expect(harness.consoleErrors).toEqual([]);
  } finally {
    await harness.close();
  }
});
