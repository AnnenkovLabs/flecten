import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator, test } from "@playwright/test";
import { type AppHarness, environmentProblem, launchApp } from "./fixtures";

async function snapshots(h: AppHarness, name: string, anchor?: Locator): Promise<void> {
  for (const [width, height] of [
    [1480, 940],
    [1180, 640],
  ] as const) {
    await h.app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height),
      { width, height },
    );
    await h.page.setViewportSize({ width, height });
    await h.page.evaluate(() => document.fonts.ready);
    await anchor?.scrollIntoViewIfNeeded();
    expect(await h.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await h.page.screenshot({
      path: test.info().outputPath(`${name}-${width}x${height}.png`),
      animations: "disabled",
    });
  }
}

test("hooks support unsaved tests, ordering, persistence and real activity", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({
    locale: "en",
    models: { "e2e-model": { name: "E2E Mock", context: 262144, output: 4096, tools: true } },
  });
  try {
    const { page } = h;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    await dialog.getByRole("button", { name: "Hooks", exact: true }).click();
    await expect(dialog.getByText("Connect your workflow", { exact: true })).toBeVisible();
    await snapshots(h, "hooks-empty");
    await dialog.getByRole("button", { name: "Add hook", exact: true }).click();
    const editor = dialog.locator(".hook-editor");
    await expect(editor.getByLabel("Name", { exact: true })).toBeFocused();
    await editor.getByLabel("Name", { exact: true }).fill("Check source files");
    await editor.getByLabel("Command", { exact: true }).fill("printf 'Formatting complete\\n'");
    await expect(editor.getByLabel("Response format")).toHaveValue("text");
    await dialog.locator("#settings-hooks").scrollIntoViewIfNeeded();
    await snapshots(h, "hooks-editor", editor.getByLabel("Command", { exact: true }));
    await editor.locator("summary").filter({ hasText: "Conditions" }).click();
    await editor.getByLabel("Tool name", { exact: true }).fill("write");
    await editor.getByLabel("Path prefix", { exact: true }).fill("src");
    await editor.locator("summary").filter({ hasText: "Test hook" }).click();
    await editor.getByLabel("Example path", { exact: true }).fill("src/app.ts");
    await editor.getByRole("button", { name: "Run test", exact: true }).click();
    await expect(editor.getByText("Hook passed", { exact: true })).toBeVisible();
    const initial = JSON.parse(await readFile(join(h.cwd, "flecten.config.json"), "utf8"));
    expect(initial.hooks?.preToolUse ?? []).toEqual([]);
    await editor.getByLabel("Example path", { exact: true }).fill("docs/guide.md");
    await editor.getByRole("button", { name: "Run test", exact: true }).click();
    await expect(editor.getByText("Conditions did not match", { exact: true })).toBeVisible();
    await editor.getByLabel("Example path", { exact: true }).fill("src/app.ts");
    await editor.getByLabel("Response format").selectOption("json");
    await editor
      .getByLabel("Command", { exact: true })
      .fill(`printf '%s' '{"decision":"deny","reason":"Use the reviewed source path"}'`);
    await editor.getByRole("button", { name: "Run test", exact: true }).click();
    await expect(editor.getByText("Action blocked", { exact: true })).toBeVisible();
    await expect(editor.getByText("Use the reviewed source path", { exact: true })).toBeVisible();
    await snapshots(h, "hooks-draft-denied");
    await dialog.getByRole("button", { name: "Duplicate", exact: true }).click();
    await editor.getByLabel("Name", { exact: true }).fill("Notify run start");
    await dialog.getByRole("button", { name: "Move up", exact: true }).click();
    await expect(dialog.locator(".hook-identity strong").first()).toHaveText("Notify run start");
    await editor.getByLabel("When", { exact: true }).selectOption("sessionStart");
    await expect(editor.getByLabel("When", { exact: true })).toBeFocused();
    await editor.getByLabel("Command", { exact: true }).fill("printf 'Starting workflow\\n'");
    await editor.getByLabel("Response format").selectOption("text");
    // Copied conditions stay visible until the user explicitly clears them.
    await editor.getByLabel("Tool name", { exact: true }).fill("");
    await editor.getByLabel("Path prefix", { exact: true }).fill("");
    await dialog.getByRole("button", { name: "Duplicate", exact: true }).click();
    await editor.getByLabel("Name", { exact: true }).fill("Temporary copy");
    await dialog.getByRole("button", { name: "Delete hook", exact: true }).click();
    const confirmation = dialog.getByRole("group", { name: "Delete hook", exact: true });
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Temporary copy");
    await dialog.getByRole("button", { name: "Delete hook", exact: true }).click();
    await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      dialog.locator(".hook-select").filter({ hasText: "Check source files" }),
    ).toBeFocused();
    await expect(dialog.locator(".hook-identity strong")).toHaveText([
      "Notify run start",
      "Check source files",
    ]);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByText("Saved", { exact: true })).toBeVisible();
    const saved = JSON.parse(await readFile(join(h.cwd, "flecten.config.json"), "utf8"));
    expect(saved.hooks.sessionStart[0]).toMatchObject({
      name: "Notify run start",
      responseFormat: "text",
    });
    expect(saved.hooks.preToolUse[0]).toMatchObject({
      name: "Check source files",
      matcher: { tool: "write", pathPrefix: "src" },
    });
    expect(saved.hooks.sessionStart[0].id).not.toBe(saved.hooks.preToolUse[0].id);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator("#prompt").fill("Read README.md");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator("iframe.summary")).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await dialog.getByRole("button", { name: "Hooks", exact: true }).click();
    await dialog.locator(".hook-history > summary").click();
    const history = dialog.locator(".hook-history");
    await expect(history.locator(".run-title strong")).toHaveText(["Notify run start"]);
    await history.locator(".hook-history-run > summary").click();
    await expect(history.getByText("Starting workflow", { exact: true })).toBeVisible();
    await snapshots(h, "hooks-activity", history.getByText("Starting workflow", { exact: true }));
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await page.locator(".task-row").filter({ hasText: "Read README.md" }).click();
    await expect(page.locator("iframe.summary")).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await dialog.getByRole("button", { name: "Hooks", exact: true }).click();
    await dialog.locator(".hook-history > summary").click();
    await expect(history.locator(".run-title strong")).toHaveText(["Notify run start"]);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
