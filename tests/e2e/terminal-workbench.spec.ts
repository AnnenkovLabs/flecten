import { expect, test } from "@playwright/test";
import { launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

test("native multi-tab terminal works in IDE and Agent views with zero shortcut hijacking", async () => {
  const h = await launchApp({
    reply: "Ready.",
  });
  const { page, app } = h;
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => {
      localStorage.setItem("flecten.locale", "en");
    });
    await page.reload();
    await page.locator("#prompt").waitFor();

    // Open IDE and open the bottom terminal dock.
    await page.getByRole("button", { name: "IDE", exact: true }).click();
    await page.keyboard.press("ControlOrMeta+Backquote");
    await expect(page.locator(".ide-output")).toBeVisible();

    const firstHost = page.locator(".ide-output .term-viewport:not([hidden]) .terminal-host");
    await expect(firstHost).toBeVisible();
    await firstHost.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("printf 'TAB_ONE_NATIVE_OK\\n'");
    await page.keyboard.press("Enter");
    await expect(firstHost).toContainText("TAB_ONE_NATIVE_OK", { timeout: 10_000 });

    // Shell shortcuts must NOT trigger IDE Quick Open or New File while terminal is focused.
    await page.keyboard.press("Control+p");
    await expect(page.locator(".quick-open")).toHaveCount(0);

    // Create a second user terminal tab via the "+" button.
    await page.locator(".ide-output").getByRole("button", { name: "New terminal" }).click();
    await expect(page.locator(".ide-output .term-tab-row")).toHaveCount(2);

    const secondHost = page.locator(".ide-output .term-viewport:not([hidden]) .terminal-host");
    await secondHost.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("printf 'TAB_TWO_SEPARATE_OK\\n'");
    await page.keyboard.press("Enter");
    await expect(secondHost).toContainText("TAB_TWO_SEPARATE_OK", { timeout: 10_000 });

    // Switch back to first tab and verify its scrollback remained intact.
    await page.locator(".ide-output .term-tab-select").first().click();
    await expect(
      page.locator(".ide-output .term-viewport:not([hidden]) .terminal-host"),
    ).toContainText("TAB_ONE_NATIVE_OK");

    // Capture IDE multi-tab terminal at 1480x940 and 1180x640.
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]?.setContentSize(size[0], size[1]),
        [width, height] as const,
      );
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(150);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      await hiddenScreenshot(h, test.info().outputPath(`ide-terminal-${width}x${height}.png`));
    }

    // Open Find in terminal overlay and verify match counter.
    await page.locator(".ide-output").getByRole("button", { name: "Find in terminal" }).click();
    const findBox = page.locator(".ide-output .term-find input");
    await expect(findBox).toBeVisible();
    await findBox.fill("TAB_ONE_NATIVE_OK");
    await expect(page.locator(".ide-output .term-find-count")).toHaveText(/^[1-9]\d*\/[1-9]\d*$/);
    await findBox.press("Escape");
    await expect(findBox).toBeHidden();

    // Switch to Agent view, start a chat, and verify the Terminal panel shares the same live tabs.
    await page.getByRole("button", { name: "Agent", exact: true }).first().click();
    const prompt = page.locator("#prompt");
    await prompt.fill("Hello");
    await prompt.press("Enter");
    await expect(page.locator(".answer").last()).toBeVisible();
    await page.getByRole("tab", { name: "Terminal", exact: true }).click();
    await expect(page.locator("#pane-terminal .term-tab-row")).toHaveCount(2);

    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]?.setContentSize(size[0], size[1]),
        [width, height] as const,
      );
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(150);
      await hiddenScreenshot(h, test.info().outputPath(`agent-terminal-${width}x${height}.png`));
    }

    expect(h.consoleErrors).toEqual([]);
  } finally {
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) win.destroy();
      })
      .catch(() => undefined);
    await h.close();
  }
});
