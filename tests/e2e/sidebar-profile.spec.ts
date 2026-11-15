import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";

test("sidebar profile renames persistently and keeps settings separate", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({ locale: "en", user: "Original user" });
  try {
    const { page, app } = h;
    await page.emulateMedia({ reducedMotion: "reduce" });
    const profile = page.locator("button.user-profile");
    const avatar = profile.locator(".avatar");
    const name = profile.locator(".user-name");
    const settings = page.getByRole("button", { name: "Settings", exact: true });
    const menu = page.getByRole("dialog", { name: "Profile", exact: true });
    const rename = page.getByRole("dialog", { name: "Change name", exact: true });
    let currentName = "Original user";

    for (const size of [
      { width: 1480, height: 940 },
      { width: 1180, height: 640 },
    ]) {
      await app.evaluate(({ BrowserWindow }, dimensions) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(dimensions.width, dimensions.height);
      }, size);
      await page.setViewportSize(size);
      await page.evaluate(() => document.fonts.ready.then(() => true));
      await expect(profile).toHaveAccessibleName(currentName);
      await expect(name).toHaveText(currentName);
      await expect(settings).toHaveCount(1);
      await expect(profile).toBeInViewport();
      await expect(settings).toBeInViewport();
      await expect(page.locator(".side-user button.user-settings")).toHaveCount(1);

      const geometry = await page.locator(".side-user").evaluate((footer) => {
        const button = footer.querySelector("button.user-profile");
        const action = footer.querySelector("button.user-settings");
        if (!button || !action) throw new Error("Sidebar profile controls are missing");
        const bounds = button.getBoundingClientRect();
        const settingsBounds = action.getBoundingClientRect();
        return {
          width: bounds.width,
          height: bounds.height,
          right: bounds.right,
          settingsLeft: settingsBounds.left,
          settingsHeight: settingsBounds.height,
          rightInset: footer.getBoundingClientRect().right - settingsBounds.right,
        };
      });
      expect(geometry.height).toBeGreaterThanOrEqual(40);
      expect(geometry.settingsHeight).toBeGreaterThanOrEqual(40);
      expect(geometry.settingsLeft).toBeGreaterThanOrEqual(geometry.right);
      expect(geometry.rightInset).toBeGreaterThanOrEqual(0);
      expect(geometry.rightInset).toBeLessThanOrEqual(16);

      await page.mouse.move(1, 1);
      const resting = await profile.evaluate((node) => getComputedStyle(node).backgroundColor);
      await page.screenshot({ path: test.info().outputPath(`profile-${size.width}.png`) });
      await avatar.hover();
      await expect
        .poll(() => profile.evaluate((node) => getComputedStyle(node).backgroundColor))
        .not.toBe(resting);
      await expect.poll(() => profile.evaluate((node) => node.getAnimations().length)).toBe(0);
      const hovered = await profile.evaluate((node) => getComputedStyle(node).backgroundColor);
      await name.hover();
      await expect(profile).toHaveCSS("background-color", hovered);
      await page.screenshot({ path: test.info().outputPath(`profile-hover-${size.width}.png`) });

      await avatar.click();
      await expect(menu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(profile).toBeFocused();

      await name.click();
      await expect(menu).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`profile-menu-${size.width}.png`) });
      await menu.getByRole("button", { name: "Change name", exact: true }).click();
      const input = rename.getByRole("textbox", { name: "Name", exact: true });
      await expect(input).toBeVisible();
      await expect(input).toBeFocused();
      await expect(input).toHaveValue(currentName);
      await expect(input).toHaveAttribute("maxlength", "80");
      await input.fill("   ");
      await expect(rename.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      await input.fill("Discarded name");
      await rename.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(rename).toBeHidden();
      await expect(profile).toHaveAccessibleName(currentName);
      await expect(profile).toBeFocused();

      await profile.click({ position: { x: geometry.width - 6, y: geometry.height / 2 } });
      await expect(menu).toBeVisible();
      await menu.getByRole("button", { name: "Change name", exact: true }).click();
      const nextName = `Ірина ${size.width}`;
      await input.fill(`  ${nextName}  `);
      await page.screenshot({ path: test.info().outputPath(`profile-rename-${size.width}.png`) });
      await rename.getByRole("button", { name: "Save", exact: true }).click();
      await expect(rename).toBeHidden();
      await expect(profile).toHaveAccessibleName(nextName);
      await expect(avatar).toHaveText("І");
      await expect(profile).toBeFocused();
      await page.reload();
      await expect(profile).toHaveAccessibleName(nextName);
      await expect(name).toHaveText(nextName);
      expect(await page.evaluate(() => localStorage.getItem("flecten.userName"))).toBe(nextName);
      currentName = nextName;

      await settings.click();
      await expect(page.locator("dialog.settings-dialog")).toBeVisible();
      await expect(menu).toBeHidden();
      await page.keyboard.press("Escape");
      await expect(page.locator("dialog.settings-dialog")).toBeHidden();
      await expect(settings).toBeFocused();
    }
    await profile.click({ button: "right" });
    await expect(menu).toBeVisible();
    await page.getByRole("button", { name: "Collapse projects panel", exact: true }).click();
    await expect(menu).toHaveCount(0);
    await expect(profile).toHaveCount(0);
    await page.locator(".titlebar").getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("dialog.settings-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Show projects panel", exact: true }).click();
    await expect(profile).toBeVisible();
    await expect(menu).toHaveCount(0);
    await page.getByRole("button", { name: "IDE", exact: true }).click();
    await page.locator(".titlebar").getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("dialog.settings-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
