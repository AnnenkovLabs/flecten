import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";

test("public and local dictionary can be reviewed, customized and removed", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({ locale: "en" });
  try {
    const { page } = h;
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    await dialog.getByRole("button", { name: "Memory and dictionary", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Liquid Glass", exact: true })).toBeVisible();
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
      await page.screenshot({ path: test.info().outputPath(`dictionary-public-${width}.png`) });
      const overflow = await dialog.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      );
      expect(overflow).toBe(false);
    }
    await dialog.getByRole("button", { name: "Local dictionary", exact: true }).click();
    await expect(
      dialog.getByText("No local terms yet. Add a term or explain a new meaning to the agent."),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Add term", exact: true }).click();
    await dialog.getByLabel("Term", { exact: true }).fill("Teamglass");
    await dialog.getByLabel("Definition", { exact: true }).fill("Our adaptive design material.");
    await dialog
      .getByLabel("Other spellings, one per line", { exact: true })
      .fill("team-glass\nтимгласс");
    await page.screenshot({ path: test.info().outputPath("dictionary-editor-1180.png") });
    await dialog.getByRole("button", { name: "Save term", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Teamglass", exact: true })).toBeVisible();
    await expect(dialog.getByText("Our adaptive design material.", { exact: true })).toBeVisible();
    await dialog.getByLabel("Search dictionary", { exact: true }).fill("missing");
    await expect(
      dialog.getByText("No matching terms. Clear the search or choose another category."),
    ).toBeVisible();
    await dialog.getByLabel("Search dictionary", { exact: true }).fill("");
    await page.screenshot({ path: test.info().outputPath("dictionary-local-1180.png") });
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Delete local term", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Teamglass", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await dialog.getByRole("button", { name: "Delete local term", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Teamglass", exact: true })).toHaveCount(0);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
