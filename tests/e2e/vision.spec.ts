import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp } from "./fixtures";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("Ctrl+V inserts editable image atoms and vision settings reuse the searchable model picker", async () => {
  const h = await launchApp({
    locale: "en",
    models: {
      "e2e-model": { name: "Working model", vision: false, context: 32768, output: 4096 },
      eyes: { name: "Small vision", vision: true, tools: false, cost: { input: 0.1, output: 0.2 } },
      blind: { name: "Blind model", vision: false },
      disabled: { name: "Disabled vision", vision: true, disabled: true },
    },
  });
  const { page } = h;
  try {
    const prompt = page.locator("#prompt");
    await expect(prompt).toBeVisible();
    await prompt.fill("Inspect this ");
    await prompt.press("End");
    await h.app.evaluate(async ({ clipboard, ClipboardItem }, png) => {
      await clipboard.write([
        new ClipboardItem({
          "image/png": new Blob([Buffer.from(png, "base64")], { type: "image/png" }),
        }),
      ]);
    }, PNG);
    await prompt.press("ControlOrMeta+v");
    const image = prompt.locator('[data-kind="image"]');
    await expect(image).toHaveText("Image 1");
    await expect(image).toHaveAttribute("contenteditable", "false");
    await expect(page.locator(".attachment-strip")).toHaveCount(0);
    const path = await image.getAttribute("data-path");
    expect(path).toBeTruthy();
    if (!path) throw new Error("Image chip did not retain its path");
    expect(dirname(path)).toContain("flecten-images-");
    expect((await readFile(path)).subarray(0, 8)).toEqual(
      Buffer.from(PNG, "base64").subarray(0, 8),
    );
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    await prompt.press("ControlOrMeta+z");
    await expect(image).toHaveCount(0);
    await prompt.press("ControlOrMeta+Shift+z");
    await expect(image).toHaveCount(1);
    await prompt.press("End");
    await page.keyboard.type("and explain the error");
    await expect(prompt).toContainText("Image 1 and explain the error");

    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await h.app.evaluate(
        ({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
        },
        { width: width, height: height },
      );
      await page.setViewportSize({ width: width, height: height });
      await page.screenshot({ path: test.info().outputPath(`image-composer-${width}.png`) });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const settings = page.locator("dialog.settings-dialog");
      const vision = settings.locator(".vision-settings");
      await vision.scrollIntoViewIfNeeded();
      await vision.getByRole("button", { name: "Image description model", exact: true }).click();
      const picker = page.getByRole("dialog", { name: "Select model", exact: true });
      await expect(picker).toBeVisible();
      await picker.getByRole("combobox").fill("Small vision");
      await expect(picker.getByRole("option")).toHaveCount(1);
      const bounds = await picker.boundingBox();
      expect(bounds).not.toBeNull();
      if (!bounds) throw new Error("Vision picker has no bounds");
      expect(bounds.x).toBeGreaterThanOrEqual(7);
      expect(bounds.y).toBeGreaterThanOrEqual(7);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 7);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height - 7);
      await page.screenshot({ path: test.info().outputPath(`vision-settings-${width}.png`) });
      await picker.getByRole("combobox").fill("");
      await expect(picker.getByRole("option")).toHaveCount(1);
      await page.keyboard.press("Enter");
      await expect(
        vision.getByRole("button", { name: "Image description model", exact: true }),
      ).toHaveText("Small vision");
      if (width === 1480) {
        await settings.getByRole("button", { name: "Save", exact: true }).click();
        await expect(settings.getByText("Saved", { exact: true })).toBeVisible();
      } else
        await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      const config = JSON.parse(await readFile(join(h.cwd, "flecten.config.json"), "utf8"));
      expect(config.vision).toEqual({ provider: "e2e", model: "eyes" });
      await settings.getByRole("button", { name: "Close", exact: true }).click();
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(image).toHaveText("Image 1");
    await prompt.press("ControlOrMeta+a");
    await prompt.press("ControlOrMeta+c");
    await prompt.press("ControlOrMeta+v");
    await expect(image).toHaveCount(1);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(prompt).toHaveText("");
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden({
      timeout: 45000,
    });
    await prompt.press("ControlOrMeta+z");
    await expect(prompt).toHaveText("");
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
