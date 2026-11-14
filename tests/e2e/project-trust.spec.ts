import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp, repoRoot } from "./fixtures";

test("project trust appears on entry, confirms refusal and can be changed before activating a module", async () => {
  const path = join(repoRoot, "src/marketplace/modules/better-trailer");
  const revision = execFileSync(
    "bun",
    [
      "-e",
      "import { readModule } from './src/modules/package'; console.log((await readModule(process.argv[1])).revision)",
      path,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  ).trim();
  const h = await launchApp({
    locale: "en",
    projectTrust: "unknown",
    modules: { dirs: [path], trusted: { [path]: revision } },
    firstCalls: [{ name: "module", arguments: { operation: "activate", name: "better-trailer" } }],
    reply: "The module is ready after your approval.",
  });
  try {
    const { page } = h;
    const trust = page.getByRole("dialog", { name: "Do you trust this folder?" });
    await expect(trust).toBeVisible();
    await expect(trust).toContainText(h.cwd);
    await page.keyboard.press("Escape");
    await expect(trust).toBeVisible();
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
      await expect(trust.getByRole("button", { name: "Trust folder", exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: test.info().outputPath(`project-trust-${width}.png`) });
    }
    await trust.getByRole("button", { name: "Do not trust", exact: true }).click();
    const confirmation = page.getByRole("dialog", {
      name: "Continue without trusting this folder?",
    });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Continue without trust", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await page.reload();
    await expect(page.locator("#prompt")).toBeVisible();
    await expect(page.locator("dialog.project-trust")).toHaveCount(0);
    await page.locator(".project-select").first().click({ button: "right" });
    await page.getByRole("button", { name: "Change project trust", exact: true }).click();
    await expect(trust).toBeVisible();
    await trust.getByRole("button", { name: "Trust folder", exact: true }).click();
    await expect(trust).toHaveCount(0);
    await page.locator("#prompt").fill("Activate the better-trailer module");
    await page.locator("#prompt").press("Enter");
    await expect(page.getByRole("tab", { name: "Trailer timeline", exact: true })).toBeVisible();
    await expect(page.locator(".thread")).toContainText("The module is ready after your approval.");
    await expect(page.getByRole("region", { name: "Permission: module", exact: true })).toHaveCount(
      0,
    );
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});

test("adding a folder in IDE mode keeps the fullscreen trust dialog visible and dismissible", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flecten-ide-trust-"));
  const h = await launchApp({ locale: "en", projectless: true, appProfile: true });
  try {
    const { page } = h;
    await expect(page.getByText("No project selected", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "IDE", exact: true }).click();
    await h.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, directory);
    await page.getByRole("button", { name: "Open project folder", exact: true }).click();
    const trust = page.getByRole("dialog", { name: "Do you trust this folder?" });
    await expect(trust).toBeVisible();
    await expect(trust).toContainText(directory);
    await expect(page.locator(".sidebar")).not.toBeVisible();
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
      const bounds = await trust.boundingBox();
      expect(bounds).toEqual({ x: 0, y: 0, width, height });
      await expect(trust.getByRole("button", { name: "Trust folder", exact: true })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`ide-project-trust-${width}.png`) });
    }
    await trust.getByRole("button", { name: "Close", exact: true }).click();
    await expect(trust).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Open project folder", exact: true }),
    ).toBeEnabled();
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
    await rm(directory, { recursive: true, force: true });
  }
});
