import { expect, test } from "@playwright/test";
import { launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

test("the default marketplace is empty and keeps catalog and installed-module controls usable", async () => {
  const h = await launchApp({ locale: "en" });
  try {
    const { page } = h;
    await h.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1480, 940);
    });
    await page.setViewportSize({ width: 1480, height: 940 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Settings", exact: true }).press("Enter");
    const dialog = page.locator("dialog.settings-dialog");
    await dialog.getByRole("button", { name: "Modules", exact: true }).press("Enter");
    await expect(
      dialog.getByRole("heading", { name: "Module marketplace", exact: true }),
    ).toBeVisible();
    const empty = dialog.getByText(
      "No modules in connected catalogs. Add an HTTPS catalog to get started.",
      { exact: true },
    );
    await expect(empty).toBeVisible();
    await expect(dialog.locator(".market-entry")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Clear filters", exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Refresh marketplace", exact: true }).press("Enter");
    await expect(empty).toBeVisible();
    const search = dialog.getByRole("searchbox", { name: "Search modules" });
    await search.fill("better-trailer");
    await dialog.getByLabel("Module category", { exact: true }).selectOption("interface");
    await expect(dialog.locator(".market-entry")).toHaveCount(0);
    await search.fill("");
    await dialog.getByLabel("Module category", { exact: true }).selectOption("all");
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await h.app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height),
        { width, height },
      );
      await page.setViewportSize({ width, height });
      await expect(empty).toBeVisible();
      expect(
        await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
      await hiddenScreenshot(h, test.info().outputPath(`marketplace-${width}.png`));
    }
    await dialog.getByRole("button", { name: "Installed", exact: false }).press("Enter");
    await expect(
      dialog.getByText("No modules installed. Add a module folder to get started."),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Marketplace", exact: true }).press("Enter");
    await dialog.getByText("Catalog sources", { exact: true }).press("Enter");
    await expect(dialog.getByText("Included with Flecten", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Add catalog", exact: true })).toBeEnabled();
    await dialog
      .getByLabel("Catalog URL", { exact: true })
      .fill("https://example.org/catalog.json");
    await dialog.getByLabel("Catalog URL", { exact: true }).focus();
    await expect(dialog.getByLabel("Catalog URL", { exact: true })).toBeFocused();
    await hiddenScreenshot(h, test.info().outputPath("marketplace-sources.png"));
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
