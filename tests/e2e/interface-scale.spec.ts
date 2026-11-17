import { expect, test } from "@playwright/test";
import { type AppHarness, environmentProblem, launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

const STORAGE_KEY = "flecten.interfaceScale";
const SIZES = [
  { width: 1480, height: 940 },
  { width: 1180, height: 640 },
] as const;

async function zoomFactor(h: AppHarness): Promise<number | undefined> {
  return h.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor(),
  );
}

async function setSize(h: AppHarness, size: { width: number; height: number }): Promise<void> {
  await h.app.evaluate(({ BrowserWindow }, dimensions) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(dimensions.width, dimensions.height);
  }, size);
  await h.page.setViewportSize(size);
  await h.page.evaluate(() => document.fonts.ready.then(() => true));
}

async function physicalLayout(h: AppHarness) {
  const factor = (await zoomFactor(h)) ?? 1;
  return h.page.evaluate((zoom) => {
    const thread = document.querySelector(".thread-inner");
    const composer = document.querySelector(".composer-stack");
    const input = document.querySelector("#prompt");
    if (!thread || !composer || !input) throw new Error("Chat layout is unavailable");
    const threadBounds = thread.getBoundingClientRect();
    const composerBounds = composer.getBoundingClientRect();
    return {
      threadWidth: threadBounds.width * zoom,
      composerWidth: composerBounds.width * zoom,
      inputFontSize: Number.parseFloat(getComputedStyle(input).fontSize) * zoom,
      composerRight: composerBounds.right * zoom,
      composerBottom: composerBounds.bottom * zoom,
      horizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, factor);
}

test("interface scale resizes the chat and persists with the window profile", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({ locale: "en", user: "Scale check" });
  try {
    const { page } = h;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("#prompt")).toBeVisible();
    await page.locator("#prompt").fill("Read README.md and show a short summary.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator("iframe.summary")).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();

    const dialog = page.locator("dialog.settings-dialog");
    const slider = dialog.getByRole("slider", { name: "Interface Scale", exact: true });
    const reset = dialog.getByRole("button", { name: "Reset to 100%", exact: true });

    for (const size of SIZES) {
      await setSize(h, size);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(slider).toHaveValue("100");
      await expect(slider).toHaveAttribute("min", "75");
      await expect(slider).toHaveAttribute("max", "125");
      await expect(slider).toHaveAttribute("step", "5");
      await expect(dialog.getByText("100%", { exact: true })).toBeVisible();
      await expect.poll(() => zoomFactor(h)).toBe(1);
      await hiddenScreenshot(
        h,
        test.info().outputPath(`settings-100-${size.width}x${size.height}.png`),
      );
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      const baseline = await physicalLayout(h);
      await hiddenScreenshot(
        h,
        test.info().outputPath(`chat-100-${size.width}x${size.height}.png`),
      );

      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(dialog).toHaveAttribute("aria-busy", "false");
      await slider.focus();
      await slider.press("Home");
      await expect(slider).toHaveValue("75");
      await slider.press("ArrowRight");
      await expect(slider).toHaveValue("80");
      await expect(dialog.getByText("80%", { exact: true })).toBeVisible();
      await expect.poll(() => zoomFactor(h)).toBeCloseTo(0.8, 5);
      await expect(reset).toBeEnabled();
      await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe("80");
      await hiddenScreenshot(
        h,
        test.info().outputPath(`settings-80-${size.width}x${size.height}.png`),
      );
      await dialog.getByRole("button", { name: "Close", exact: true }).click();

      const compact = await physicalLayout(h);
      expect(compact.threadWidth).toBeLessThan(baseline.threadWidth * 0.9);
      expect(compact.composerWidth).toBeLessThan(baseline.composerWidth * 0.9);
      expect(compact.inputFontSize / baseline.inputFontSize).toBeCloseTo(0.8, 2);
      expect(compact.composerRight).toBeLessThanOrEqual(size.width + 1);
      expect(compact.composerBottom).toBeLessThanOrEqual(size.height + 1);
      expect(compact.horizontalOverflow).toBeLessThanOrEqual(1);
      await expect(page.locator("#prompt")).toBeInViewport();
      await hiddenScreenshot(h, test.info().outputPath(`chat-80-${size.width}x${size.height}.png`));

      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(slider).toHaveValue("80");
      await reset.click();
      await expect(slider).toHaveValue("100");
      await expect.poll(() => zoomFactor(h)).toBe(1);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
    }

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(dialog).toHaveAttribute("aria-busy", "false");
    await slider.focus();
    await slider.press("Home");
    await slider.press("ArrowRight");
    await page.reload();
    await expect(page.locator("#prompt")).toBeVisible();
    await expect.poll(() => zoomFactor(h)).toBeCloseTo(0.8, 5);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(slider).toHaveValue("80");
    await reset.click();
    await expect.poll(() => zoomFactor(h)).toBe(1);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();

    await page.evaluate(() => {
      for (const value of [0, 74, 126, Number.NaN, Number.POSITIVE_INFINITY])
        window.desktop?.setInterfaceScale?.(value);
    });
    await expect.poll(() => zoomFactor(h)).toBe(1);
    for (const invalid of ["broken", "74", "126", "null"]) {
      await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
        key: STORAGE_KEY,
        value: invalid,
      });
      await page.reload();
      await expect(page.locator("#prompt")).toBeVisible();
      await expect.poll(() => zoomFactor(h)).toBe(1);
    }
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(slider).toHaveValue("100");
    expect(h.consoleErrors, h.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await h.close();
  }
});
