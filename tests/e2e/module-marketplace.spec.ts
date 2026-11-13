import { expect, test } from "@playwright/test";
import { launchApp } from "./fixtures";

test("discover, filter, install and trust a marketplace module in the hidden desktop", async () => {
  const h = await launchApp({ locale: "en" });
  try {
    const { page } = h;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    await dialog.getByRole("button", { name: "Modules", exact: true }).click();
    await expect(
      dialog.getByRole("heading", { name: "Module marketplace", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "View module: Trailer timeline", exact: true }),
    ).toBeVisible();
    const search = dialog.getByRole("searchbox", { name: "Search modules" });
    await search.fill("missing-module");
    await expect(
      dialog.getByText("No matching modules. Clear the search or choose another category."),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Clear filters", exact: true }).click();
    await dialog.getByLabel("Module category", { exact: true }).selectOption("interface");
    await expect(dialog.locator(".market-entry")).toHaveCount(1);
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
      await expect(
        dialog.getByRole("button", { name: "View module: Trailer timeline", exact: true }),
      ).toBeVisible();
      expect(
        await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: test.info().outputPath(`marketplace-${width}.png`) });
    }
    await search.fill("frame-workflow");
    const workflow = dialog.getByRole("button", {
      name: "View module: Frame workflow",
      exact: true,
    });
    await workflow.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByText("frame-service", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Install module", exact: true }).click();
    await expect(
      dialog.getByText("Installed. Review and trust each new module in Installed to enable it.", {
        exact: true,
      }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Manage installed modules", exact: true }).click();
    await expect(dialog.locator(".module-row")).toHaveCount(2);
    await expect(
      dialog.getByRole("button", { name: "Trust this version", exact: true }),
    ).toHaveCount(2);
    for (const row of await dialog.locator(".module-row").all()) {
      await row.getByRole("button", { name: "Trust this version", exact: true }).click();
      await expect(row.getByRole("button", { name: "Disable", exact: true })).toBeEnabled();
    }
    await dialog.getByRole("button", { name: "Marketplace", exact: true }).click();
    await dialog.getByRole("button", { name: "Back to marketplace", exact: true }).click();
    await search.fill("");
    await dialog.getByText("Catalog sources", { exact: true }).click();
    await expect(dialog.getByText("Included with Flecten", { exact: true })).toBeVisible();
    await dialog
      .getByLabel("Catalog URL", { exact: true })
      .fill("https://example.org/catalog.json");
    await dialog.getByLabel("Catalog URL", { exact: true }).focus();
    await expect(dialog.getByLabel("Catalog URL", { exact: true })).toBeFocused();
    await page.screenshot({ path: test.info().outputPath("marketplace-sources.png") });
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
