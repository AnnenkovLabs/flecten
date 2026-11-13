import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { catalogs, type MessageKey } from "../../ui/src/lib/i18n/catalogs";
import { type Locale, locales } from "../../ui/src/lib/i18n/locales";
import { environmentProblem, launchApp } from "./fixtures";

function label(locale: Locale, key: MessageKey): string {
  const value = catalogs[locale][key];
  if (typeof value !== "string") throw new Error(`Expected a plain label: ${key}`);
  return value;
}

test("fresh English default, seven live languages, drafts and saved preference", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const profile = mkdtempSync(join(tmpdir(), "flecten-language-"));
  const h = await launchApp({ locale: null, userData: join(profile, "profile") });
  try {
    const { page } = h;
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
    const draft = "Не перекладай мій текст. 日本語, português, español.";
    await page.locator("#prompt").fill(draft);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    let current: Locale = "en";
    for (const locale of locales) {
      await dialog
        .getByLabel(label(current, "Interface language"), { exact: true })
        .selectOption(locale.id);
      current = locale.id;
      await expect(page.locator("html")).toHaveAttribute("lang", current);
      await expect(dialog.locator("#settings-title")).toHaveText(label(current, "Settings"));
      await expect(dialog.locator("#settings-general")).toHaveText(label(current, "General"));
      await expect(
        dialog.getByLabel(label(current, "Interface language"), { exact: true }),
      ).toHaveValue(current);
      await dialog
        .locator(".rail")
        .getByRole("button", { name: label(current, "Permissions"), exact: true })
        .click();
      await expect(dialog.locator("#settings-permissions")).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`permissions-${current}.png`) });
      await dialog
        .locator(".rail")
        .getByRole("button", { name: label(current, "Providers"), exact: true })
        .click();
      await expect(
        dialog.getByLabel(label(current, "Search providers"), { exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`providers-${current}.png`) });
      await dialog
        .locator(".rail")
        .getByRole("button", { name: label(current, "Previous"), exact: true })
        .click();
      await dialog
        .locator(".rail")
        .getByRole("button", { name: label(current, "General"), exact: true })
        .click();

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
        await page.screenshot({ path: test.info().outputPath(`settings-${current}-${width}.png`) });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await expect(
          dialog.getByRole("button", { name: label(current, "Close settings"), exact: true }),
        ).toBeInViewport();
      }
    }
    await dialog
      .getByRole("button", { name: label(current, "Close settings"), exact: true })
      .click();
    await expect(page.locator("#prompt")).toHaveText(draft);
    await page.screenshot({ path: test.info().outputPath("conversation-ru-1180.png") });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(
      page.getByRole("button", { name: label("ru", "Settings"), exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("flecten.locale"))).toBe("ru");
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
