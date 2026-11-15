import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

test("projectless entry, remembered folders and sessions survive navigation and sidebar removal", async () => {
  const first = await mkdtemp(join(tmpdir(), "flecten-project-one-"));
  const second = await mkdtemp(join(tmpdir(), "flecten-project-two-"));
  const h = await launchApp({
    locale: "en",
    projectless: true,
    appProfile: true,
    reply: "Task completed.",
  });
  try {
    const { page } = h;
    await expect(
      page.locator(".sidebar").getByRole("button", { name: "Add folder", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("No project selected", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Add a folder to work on a project. You can also start a task without one."),
    ).toBeVisible();
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
      await hiddenScreenshot(h, test.info().outputPath(`projectless-${width}.png`));
    }
    await page.locator("#prompt").fill("Task without a project");
    await page.locator("#prompt").press("Enter");
    await expect(page.locator(".thread")).toContainText("Task completed.");
    for (const [directory, prompt] of [
      [first, "Task in first project"],
      [second, "Task in second project"],
    ] as const) {
      await h.app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      }, directory);
      await page.locator(".sidebar").getByRole("button", { name: "New task", exact: true }).click();
      await page.locator(".ns-picker-trigger").click();
      await page.getByRole("button", { name: "Select folder", exact: true }).click();
      const trust = page.getByRole("dialog", { name: "Do you trust this folder?" });
      await expect(trust).toContainText(directory);
      await trust.getByRole("button", { name: "Trust folder", exact: true }).click();
      await expect(trust).toHaveCount(0);
      await page.locator("#prompt").fill(prompt as string);
      await page.locator("#prompt").press("Enter");
      await expect(page.locator(".thread")).toContainText("Task completed.");
    }
    await expect(page.locator(".sidebar .task-title")).toHaveCount(3);
    await page.getByRole("button", { name: "Task in first project, done", exact: true }).click();
    await expect(page.locator(".thread")).toContainText("Task in first project");
    await expect(page.locator(".sidebar .task-title")).toHaveCount(3);
    await page.reload();
    await expect(page.locator(".sidebar .task-title")).toHaveCount(3);
    await expect(page.locator("dialog.project-trust")).toHaveCount(0);
    await page
      .locator(".project-select")
      .filter({ hasText: basename(first) })
      .click({ button: "right" });
    await page.getByRole("button", { name: "Remove from sidebar", exact: true }).click();
    await expect(page.getByText("No project selected", { exact: true })).toBeVisible();
    await expect(page.locator(".sidebar .task-title")).toHaveCount(2);
    expect(existsSync(join(first, ".liquid/sessions"))).toBe(true);
    expect(existsSync(join(first, "flecten.config.json"))).toBe(false);
    expect(existsSync(join(second, "flecten.config.json"))).toBe(false);
    expect(h.consoleErrors).toEqual([]);
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
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      await hiddenScreenshot(h, test.info().outputPath(`project-navigation-${width}.png`));
    }
  } finally {
    await h.close();
    await Promise.all([first, second].map((path) => rm(path, { recursive: true, force: true })));
  }
});
