import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp } from "./fixtures";

test("install a module, let the agent activate it, and use its custom UI with the compiled SDK runtime", async () => {
  const h = await launchApp({
    locale: "en",
    models: {
      "e2e-model": {
        name: "E2E Mock",
        context: 128000,
        output: 4096,
        tools: true,
        reasoning: false,
      },
    },
    firstCalls: [{ name: "module", arguments: { operation: "activate", name: "better-trailer" } }],
    reply: "The trailer timeline is ready.",
  });
  try {
    const { page } = h;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    await dialog.getByRole("button", { name: "Modules", exact: true }).click();
    await dialog.getByRole("button", { name: "Installed", exact: false }).click();
    await expect(
      dialog.getByText("No modules installed. Add a module folder to get started."),
    ).toBeVisible();
    await dialog
      .getByLabel("Module folder", { exact: true })
      .fill(join(import.meta.dirname, "../../src/marketplace/modules/better-trailer"));
    await dialog.getByRole("button", { name: "Install from folder", exact: true }).click();
    await expect(
      dialog.getByRole("heading", { name: "better-trailer", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Trust this version", exact: true }).click();
    await expect(dialog.getByText("On demand", { exact: true })).toBeVisible();
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
      await expect(dialog.getByRole("button", { name: "Disable", exact: true })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`modules-settings-${width}.png`) });
    }
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    const prompt = page.locator("#prompt");
    await prompt.fill("Use the better-trailer module to inspect a trailer timeline");
    await prompt.press("Enter");
    const tab = page.getByRole("tab", { name: "Trailer timeline", exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    const frame = page.frameLocator('iframe[title="Trailer timeline"]');
    await expect(
      frame.getByRole("heading", { name: "Trailer timeline", exact: true }),
    ).toBeVisible();
    await frame.getByLabel("Duration, seconds").fill("15");
    await frame.getByRole("button", { name: "Calculate timeline", exact: true }).click();
    await page.getByRole("button", { name: "Allow once", exact: true }).click();
    await expect(frame.locator("output")).toHaveText("360 frames · 15 seconds");
    // Polling unchanged state must preserve the document and the user's form values.
    expect(
      await page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            const unsubscribe = window.desktop?.agent?.onEvent((event) => {
              if (event.type === "response" && event.moduleState) {
                unsubscribe?.();
                clearTimeout(timer);
                resolve(true);
              }
            });
            const timer = setTimeout(() => {
              unsubscribe?.();
              resolve(false);
            }, 5000);
          }),
      ),
    ).toBe(true);
    await expect(frame.getByLabel("Duration, seconds")).toHaveValue("15");
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
      await expect(frame.getByRole("table")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      expect(
        await frame.locator("body").evaluate((body) => body.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: test.info().outputPath(`module-timeline-${width}.png`) });
    }
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await dialog.getByRole("button", { name: "Modules", exact: true }).click();
    await dialog.getByRole("button", { name: "Installed", exact: false }).click();
    await dialog
      .getByLabel("Module folder", { exact: true })
      .fill(join(import.meta.dirname, "../../src/marketplace/modules/sqlite-journal"));
    await dialog.getByRole("button", { name: "Install from folder", exact: true }).click();
    const journal = dialog
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: "sqlite-journal", exact: true }) });
    await expect(
      journal.getByText("Native module code runs with the permissions of the agent process.", {
        exact: false,
      }),
    ).toBeVisible();
    await journal.getByRole("button", { name: "Trust this version", exact: true }).click();
    await expect(journal.getByText("Project service", { exact: true })).toBeVisible();
    await journal.getByText("Contents and location", { exact: true }).click();
    await expect(journal.getByText("replace: harness.storage@1", { exact: true })).toBeVisible();
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
      await journal.scrollIntoViewIfNeeded();
      await expect(journal.getByRole("button", { name: "Disable", exact: true })).toBeVisible();
      expect(
        await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: test.info().outputPath(`module-platform-${width}.png`) });
    }
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await tab.focus();
    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: "Conversation", exact: true })).toBeFocused();
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
