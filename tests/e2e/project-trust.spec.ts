import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp, repoRoot } from "./fixtures";

test("an existing module asks for project trust visibly and continues the waiting activation", async () => {
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
    modules: { dirs: [path], trusted: { [path]: revision } },
    firstCalls: [{ name: "module", arguments: { operation: "activate", name: "better-trailer" } }],
    reply: "The module is ready after your approval.",
  });
  try {
    const { page } = h;
    await page.locator("#prompt").fill("Activate the better-trailer module");
    await page.locator("#prompt").press("Enter");
    const approval = page.getByRole("region", { name: "Permission: module", exact: true });
    await expect(approval.getByText("Trust project?", { exact: true })).toBeVisible();
    await expect(approval).toContainText(h.cwd);
    await expect(approval).toContainText(
      "Configured modules, MCP servers and hooks can run with your account permissions.",
    );
    await expect(page.getByRole("tab", { name: "Trailer timeline", exact: true })).toHaveCount(0);
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
      await expect(
        approval.getByRole("button", { name: "Trust and continue", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: test.info().outputPath(`project-trust-${width}.png`) });
    }
    await approval.getByRole("button", { name: "Trust and continue", exact: true }).click();
    await expect(approval.getByText("Project trusted", { exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Trailer timeline", exact: true })).toBeVisible();
    await expect(page.locator(".thread")).toContainText("The module is ready after your approval.");
    await expect(
      page.getByText("Accept project trust before activating modules", { exact: false }),
    ).toHaveCount(0);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
