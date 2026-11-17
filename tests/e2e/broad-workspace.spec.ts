import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

test("a broad folder shows a partial file index and offers a focused project folder", async () => {
  const h = await launchApp({ locale: "en" });
  try {
    const { page } = h;
    const dataset = join(h.cwd, "project-data");
    const project = join(h.cwd, "focused-project");
    await Promise.all([mkdir(dataset), mkdir(project)]);
    for (let start = 0; start < 5_001; start += 128) {
      await Promise.all(
        Array.from({ length: Math.min(128, 5_001 - start) }, (_, offset) =>
          writeFile(join(dataset, `record-${String(start + offset).padStart(5, "0")}.txt`), "data"),
        ),
      );
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("group", { name: "Work mode" })
      .getByRole("button", { name: "IDE", exact: true })
      .click();
    const notice = page.locator(".explorer .file-limit");
    await expect(notice).toContainText(
      "Only part of this folder is shown. Open a project folder to see its files.",
    );
    const choose = notice.getByRole("button", { name: "Open project folder", exact: true });
    await expect(choose).toBeEnabled();
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
      await expect(notice).toBeVisible();
      const geometry = await notice.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          horizontal: document.documentElement.scrollWidth - innerWidth,
          vertical: document.documentElement.scrollHeight - innerHeight,
          right: rect.right,
          bottom: rect.bottom,
          localOverflow: element.scrollWidth - element.clientWidth,
        };
      });
      expect(geometry.horizontal).toBeLessThanOrEqual(1);
      expect(geometry.vertical).toBeLessThanOrEqual(1);
      expect(geometry.localOverflow).toBeLessThanOrEqual(1);
      expect(geometry.right).toBeLessThanOrEqual(width);
      expect(geometry.bottom).toBeLessThanOrEqual(height);
      await hiddenScreenshot(h, test.info().outputPath(`broad-folder-${width}x${height}.png`));
    }
    await h.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, project);
    await choose.focus();
    await expect(choose).toBeFocused();
    await choose.press("Enter");
    const trust = page.getByRole("dialog", { name: "Do you trust this folder?" });
    await expect(trust).toContainText(project);
    await trust.getByRole("button", { name: "Trust folder", exact: true }).click();
    await expect(trust).toHaveCount(0);
    await expect(notice).toHaveCount(0);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
