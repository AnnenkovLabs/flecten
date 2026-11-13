import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp } from "./fixtures";

test("a module supplies the entire harness, persists its feature, hot reloads and restores the native UI", async () => {
  const profile = await mkdtemp(join(tmpdir(), "flecten-module-interface-"));
  const h = await launchApp({
    userData: profile,
    locale: "en",
    reply: "Studio task completed.",
    models: {
      "e2e-model": {
        name: "E2E Mock",
        context: 128000,
        output: 4096,
        tools: true,
        reasoning: false,
      },
    },
  });
  try {
    const { page } = h;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    await dialog.getByRole("button", { name: "Modules", exact: true }).click();
    await dialog.getByRole("button", { name: "Installed", exact: false }).click();
    await dialog
      .getByLabel("Module folder", { exact: true })
      .fill(join(import.meta.dirname, "../../src/marketplace/modules/studio-harness"));
    await dialog.getByRole("button", { name: "Install from folder", exact: true }).click();
    await dialog.getByRole("button", { name: "Trust this version", exact: true }).click();
    await dialog.getByText("Contents and location", { exact: true }).click();
    await dialog.getByLabel("Reload local changes automatically", { exact: true }).check();
    await expect(
      dialog.getByLabel("Reload local changes automatically", { exact: true }),
    ).toBeChecked();
    await dialog.getByRole("button", { name: "Use module interface", exact: true }).click();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    const frame = page.frameLocator('iframe[title="Studio harness"]');
    await expect(
      frame.getByRole("heading", { name: "Your workspace, your way.", exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-harness-region="shell"]')).toBeHidden();
    const denied = await frame.locator("body").evaluate(async () => {
      const client = (
        window as unknown as {
          flecten: { harness: { request(command: unknown): Promise<unknown> } };
        }
      ).flecten;
      try {
        await client.harness.request({ type: "settings.save", config: {} });
        return "allowed";
      } catch (error) {
        return String(error);
      }
    });
    expect(denied).toContain("not granted");
    expect(
      await frame.locator("body").evaluate(() => {
        try {
          return !!parent.document;
        } catch {
          return false;
        }
      }),
    ).toBe(false);
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      ),
    ).toBe("#17191b");
    await frame.getByRole("button", { name: "Theme", exact: true }).click();
    await expect(frame.getByRole("button", { name: "Theme", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      ),
    ).toBe("#202122");
    await expect
      .poll(() =>
        frame
          .locator("body")
          .evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
          ),
      )
      .toBe("#202122");
    const prompt = "Make a plan for a small creative project.";
    await frame.getByLabel("Task", { exact: true }).fill(prompt);
    await frame.getByRole("button", { name: "Send task", exact: true }).click();
    await expect(frame.locator(".message.assistant").last()).toContainText(
      "Studio task completed.",
    );
    await frame
      .getByLabel("Working brief", { exact: true })
      .fill("A short trailer for a local game.");
    await frame.getByRole("button", { name: "Save brief", exact: true }).click();
    const permission = frame.getByRole("button", { name: "Allow once", exact: true });
    await expect(permission.or(frame.getByText("Brief saved", { exact: true }))).toBeVisible();
    if (await permission.isVisible()) await permission.click();
    await expect(frame.getByText("Brief saved", { exact: true })).toBeVisible();
    await frame.getByLabel("Task", { exact: true }).fill("Unsaved draft stays here");
    // A real polling response must not remount the custom shell.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const off = window.desktop?.agent?.onEvent((event) => {
            if (event.type === "response" && event.moduleState) {
              off?.();
              resolve();
            }
          });
        }),
    );
    await expect(frame.getByLabel("Task", { exact: true })).toHaveValue("Unsaved draft stays here");
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
      await expect(frame.getByRole("button", { name: "Send task", exact: true })).toBeVisible();
      expect(
        await frame.locator("body").evaluate((body) => body.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: test.info().outputPath(`studio-harness-${width}.png`) });
    }
    const root = join(h.cwd, ".liquid/modules/studio-harness");
    const html = await readFile(join(root, "studio.html"), "utf8");
    await writeFile(
      join(root, "studio.html"),
      html.replace("<strong>Studio</strong>", "<strong>Studio Reloaded</strong>"),
    );
    await expect(frame.locator("header strong")).toHaveText("Studio Reloaded");
    expect(await page.locator("style[data-module-overlay]").count()).toBe(0);
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      ),
    ).toBe("#17191b");
    await frame.getByRole("button", { name: "Load saved brief", exact: true }).click();
    await expect(frame.getByLabel("Working brief", { exact: true })).toHaveValue(
      "A short trailer for a local game.",
    );
    // Change the same contribution to a small widget at an explicit native UI address.
    const manifestPath = join(root, ".flecten-module/module.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.surfaces[0].entry = "badge.html";
    manifest.surfaces[0].placement = {
      selector: '[data-harness-region="header"]',
      position: "after",
    };
    await writeFile(
      join(root, "badge.html"),
      "<p>Module widget beside the native conversation</p>",
    );
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(page.locator('[data-harness-region="shell"]')).toBeVisible();
    await expect(
      frame.getByText("Module widget beside the native conversation", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Restore native interface", exact: true }).click();
    await expect(page.locator('iframe[title="Studio harness"]')).toHaveCount(0);
    await expect(
      page.getByRole("log", { name: "Task progress" }).getByText(prompt, { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      ),
    ).toBe("#171717");
    await page.getByRole("button", { name: "Resume module interfaces", exact: true }).click();
    await expect(
      frame.getByText("Module widget beside the native conversation", { exact: true }),
    ).toBeVisible();
    await frame.locator("body").click();
    // Native input does not wait for a CDP acknowledgement from the iframe it removes.
    await h.app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      contents?.sendInputEvent({
        type: "keyDown",
        keyCode: "F12",
        modifiers: ["control", "shift"],
      });
      contents?.sendInputEvent({ type: "keyUp", keyCode: "F12", modifiers: ["control", "shift"] });
    });
    await expect(page.locator('iframe[title="Studio harness"]')).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Resume module interfaces", exact: true }),
    ).toBeVisible();
    await expect(page.locator('iframe[title="Studio harness"]')).toHaveCount(0);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
    await rm(profile, { recursive: true, force: true });
  }
});
