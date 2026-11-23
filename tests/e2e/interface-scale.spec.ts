import { expect, test } from "@playwright/test";
import { type AppHarness, environmentProblem, launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

const SCALE_STORAGE_KEY = "flecten.interfaceScale";
const APPEARANCE_STORAGE_KEY = "flecten.appearance";
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

async function openAppearance(page: AppHarness["page"]): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.locator("dialog.settings-dialog");
  await expect(dialog).toHaveAttribute("aria-busy", "false");
  await dialog.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
}

async function physicalLayout(h: AppHarness) {
  const factor = (await zoomFactor(h)) ?? 1;
  return h.page.evaluate((zoom) => {
    const thread = document.querySelector(".thread-inner");
    const composer = document.querySelector(".composer-stack");
    const input = document.querySelector("#prompt");
    const summaryFrame = document.querySelector<HTMLIFrameElement>("iframe.summary");
    if (!thread || !composer || !input || !summaryFrame) {
      throw new Error("Chat layout is unavailable");
    }
    const threadBounds = thread.getBoundingClientRect();
    const composerBounds = composer.getBoundingClientRect();
    const summaryBounds = summaryFrame.getBoundingClientRect();
    return {
      threadWidth: threadBounds.width * zoom,
      composerWidth: composerBounds.width * zoom,
      inputFontSize: Number.parseFloat(getComputedStyle(input).fontSize) * zoom,
      summaryHeight: summaryBounds.height * zoom,
      composerRight: composerBounds.right * zoom,
      composerBottom: composerBounds.bottom * zoom,
      horizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, factor);
}

test("Appearance tab scales interface, text, HTML summaries, and chat width", async () => {
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
    const interfaceSlider = dialog.getByRole("slider", { name: "Interface scale", exact: true });
    const interfaceReset = dialog.getByRole("button", {
      name: "Reset Interface scale to 100%",
      exact: true,
    });
    const textSlider = dialog.getByRole("slider", { name: "Text scale", exact: true });
    const summarySlider = dialog.getByRole("slider", { name: "HTML summary scale", exact: true });
    const chatWidthSlider = dialog.getByRole("slider", { name: "Chat width", exact: true });
    const resetAll = dialog.getByRole("button", { name: "Reset all", exact: true });

    // Confirm Interface scale moved out of General into Appearance.
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(dialog).toHaveAttribute("aria-busy", "false");
    await expect(interfaceSlider).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();

    for (const size of SIZES) {
      await setSize(h, size);
      await openAppearance(page);
      await expect(interfaceSlider).toHaveValue("100");
      await expect(interfaceSlider).toHaveAttribute("min", "75");
      await expect(interfaceSlider).toHaveAttribute("max", "125");
      await expect(interfaceSlider).toHaveAttribute("step", "5");
      await expect(textSlider).toHaveValue("100");
      await expect(summarySlider).toHaveValue("100");
      await expect(chatWidthSlider).toHaveValue("780");
      await expect(resetAll).toBeDisabled();
      await expect.poll(() => zoomFactor(h)).toBe(1);
      await hiddenScreenshot(
        h,
        test.info().outputPath(`appearance-100-${size.width}x${size.height}.png`),
      );
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      const baseline = await physicalLayout(h);
      await hiddenScreenshot(
        h,
        test.info().outputPath(`chat-100-${size.width}x${size.height}.png`),
      );

      await openAppearance(page);
      await interfaceSlider.focus();
      await interfaceSlider.press("Home");
      await expect(interfaceSlider).toHaveValue("75");
      await interfaceSlider.press("ArrowRight");
      await expect(interfaceSlider).toHaveValue("80");
      await expect(dialog.getByText("80%", { exact: true })).toBeVisible();
      await expect.poll(() => zoomFactor(h)).toBeCloseTo(0.8, 5);
      await expect(interfaceReset).toBeEnabled();
      await expect(resetAll).toBeEnabled();
      await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      expect(await page.evaluate((key) => localStorage.getItem(key), SCALE_STORAGE_KEY)).toBe("80");
      await hiddenScreenshot(
        h,
        test.info().outputPath(`appearance-80-${size.width}x${size.height}.png`),
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

      await openAppearance(page);
      await expect(interfaceSlider).toHaveValue("80");
      await interfaceReset.click();
      await expect(interfaceSlider).toHaveValue("100");
      await expect.poll(() => zoomFactor(h)).toBe(1);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
    }

    // Verify text scale, HTML summary scale, and chat width live effects and persistence.
    await setSize(h, SIZES[0]);
    const defaultLayout = await physicalLayout(h);
    await openAppearance(page);
    await textSlider.focus();
    for (let step = 0; step < 5; step += 1) await textSlider.press("ArrowRight");
    await expect(textSlider).toHaveValue("125");

    await summarySlider.focus();
    for (let step = 0; step < 6; step += 1) await summarySlider.press("ArrowRight");
    await expect(summarySlider).toHaveValue("130");

    await chatWidthSlider.focus();
    for (let step = 0; step < 8; step += 1) await chatWidthSlider.press("ArrowRight");
    await expect(chatWidthSlider).toHaveValue("940");

    await dialog.getByRole("button", { name: "Close", exact: true }).click();

    await expect
      .poll(async () => (await physicalLayout(h)).summaryHeight)
      .toBeGreaterThan(defaultLayout.summaryHeight * 1.1);
    const scaledLayout = await physicalLayout(h);
    expect(scaledLayout.inputFontSize / defaultLayout.inputFontSize).toBeCloseTo(1.25, 2);
    expect(scaledLayout.threadWidth).toBeGreaterThan(defaultLayout.threadWidth + 100);
    await hiddenScreenshot(h, test.info().outputPath("chat-scaled-1480x940.png"));

    await page.reload();
    await expect(page.locator("#prompt")).toBeVisible();
    await expect(page.locator("iframe.summary")).toBeVisible();
    const persisted = JSON.parse(
      (await page.evaluate((key) => localStorage.getItem(key), APPEARANCE_STORAGE_KEY)) ?? "{}",
    );
    expect(persisted).toEqual({ textScale: 125, summaryScale: 130, chatWidth: 940 });
    await openAppearance(page);
    await expect(textSlider).toHaveValue("125");
    await expect(summarySlider).toHaveValue("130");
    await expect(chatWidthSlider).toHaveValue("940");
    await resetAll.click();
    await expect(textSlider).toHaveValue("100");
    await expect(summarySlider).toHaveValue("100");
    await expect(chatWidthSlider).toHaveValue("780");
    await expect(resetAll).toBeDisabled();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();

    // Verify invalid values in storage or bridge never break zoom.
    await page.evaluate(() => {
      for (const value of [0, 74, 126, Number.NaN, Number.POSITIVE_INFINITY])
        window.desktop?.setInterfaceScale?.(value);
    });
    await expect.poll(() => zoomFactor(h)).toBe(1);
    for (const invalid of ["broken", "74", "126", "null"]) {
      await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
        key: SCALE_STORAGE_KEY,
        value: invalid,
      });
      await page.reload();
      await expect(page.locator("#prompt")).toBeVisible();
      await expect.poll(() => zoomFactor(h)).toBe(1);
    }
    await openAppearance(page);
    await expect(interfaceSlider).toHaveValue("100");
    expect(h.consoleErrors, h.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await h.close();
  }
});
