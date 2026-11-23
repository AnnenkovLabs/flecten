import { expect, test } from "@playwright/test";
import { launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

test("composer Up/Down prompt history recalls prompts with 3D directional motion blur and honors reduced motion", async () => {
  const harness = await launchApp();
  const { page, app } = harness;
  try {
    const prompt = page.locator("#prompt");
    await expect(prompt).toBeVisible();

    const firstLine1 = "Первый промпт для проверки истории";
    const firstLine2 = "вторая строка промпта";
    const first = `${firstLine1}\n${firstLine2}`;
    const second = "Второй промпт с проверкой переключения";

    await prompt.click();
    await page.keyboard.type(firstLine1);
    await prompt.press("Shift+Enter");
    await page.keyboard.type(firstLine2);
    await prompt.press("Enter");
    await expect(page.getByRole("button", { name: "Остановка", exact: true })).toBeHidden({
      timeout: 45000,
    });
    await expect(page.locator(".answer").last()).toBeVisible();

    await prompt.fill(second);
    await prompt.press("Enter");
    await expect(page.getByRole("button", { name: "Остановка", exact: true })).toBeHidden({
      timeout: 45000,
    });
    await expect(page.locator(".msg.user")).toHaveCount(2);

    // Type an unsent draft so we verify it is stashed on ArrowUp and restored on ArrowDown.
    const draft = "Незаконченный черновик";
    await prompt.fill(draft);

    // Inspect at 1480x940 first, including a mid-flight frame showing 3D tilt + vertical motion blur.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1480, 940);
    });
    await page.setViewportSize({ width: 1480, height: 940 });
    await prompt.focus();

    const beforeBox = await page.locator("form.composer").boundingBox();
    await prompt.press("ArrowUp");
    const midRoll = await page.evaluate(() => {
      const stage = document.querySelector(".prompt-stage");
      const editor = document.querySelector<HTMLElement>("#prompt");
      const ghost = document.querySelector<HTMLElement>(".prompt-roll-ghost");
      const blurs = [...document.querySelectorAll(".prompt-motion-svg feGaussianBlur")].map((el) =>
        el.getAttribute("stdDeviation"),
      );
      return {
        rolling: stage?.classList.contains("is-rolling") ?? false,
        hasGhost: Boolean(ghost),
        ghostPosition: ghost ? getComputedStyle(ghost).position : "",
        editorTransform: editor?.style.transform ?? "",
        editorFilter: editor?.style.filter ?? "",
        blurs,
      };
    });
    const duringBox = await page.locator("form.composer").boundingBox();
    expect(midRoll.rolling).toBe(true);
    expect(midRoll.hasGhost).toBe(true);
    expect(midRoll.ghostPosition).toBe("absolute");
    expect(Math.abs((duringBox?.height ?? 0) - (beforeBox?.height ?? 0))).toBeLessThanOrEqual(2);
    expect(midRoll.editorTransform).toContain("perspective(");
    expect(midRoll.editorTransform).toContain("rotateX(");
    expect(midRoll.editorFilter).toContain("-prompt-blur-in");
    expect(midRoll.blurs.some((value) => value !== null && value !== "0 0")).toBe(true);
    await page.waitForTimeout(25);
    await hiddenScreenshot(harness, test.info().outputPath("history-roll-1480.png"));

    await expect(prompt).toHaveText(second);
    await expect(page.locator(".prompt-stage.is-rolling")).toHaveCount(0);
    await expect(page.locator(".prompt-roll-ghost")).toHaveCount(0);
    await hiddenScreenshot(harness, test.info().outputPath("history-settled-1480.png"));

    // Step further back to the multiline prompt, then step forward back to the stashed draft.
    await prompt.press("ArrowUp");
    await expect(prompt).toHaveText(first);

    await prompt.press("ArrowDown");
    await expect(prompt).toHaveText(second);

    await prompt.press("ArrowDown");
    await expect(prompt).toHaveText(draft);

    // Verify 1180x640 layout and mid-flight transition as well.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 640);
    });
    await page.setViewportSize({ width: 1180, height: 640 });
    await prompt.press("ArrowUp");
    await hiddenScreenshot(harness, test.info().outputPath("history-roll-1180.png"));
    await expect(page.locator(".prompt-stage.is-rolling")).toHaveCount(0);
    await expect(prompt).toHaveText(second);
    await hiddenScreenshot(harness, test.info().outputPath("history-settled-1180.png"));

    // Verify prefers-reduced-motion swaps immediately without motion blur or ghost layer.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await prompt.press("ArrowUp");
    const reduced = await page.evaluate(() => ({
      rolling: document.querySelector(".prompt-stage")?.classList.contains("is-rolling") ?? false,
      hasGhost: Boolean(document.querySelector(".prompt-roll-ghost")),
    }));
    expect(reduced.rolling).toBe(false);
    expect(reduced.hasGhost).toBe(false);
    await expect(prompt).toHaveText(first);

    // Editing a recalled prompt detaches from history so ArrowDown does not discard edits.
    await page.keyboard.type("!");
    await prompt.press("ArrowDown");
    await expect(prompt).toHaveText(`${first}!`);

    expect(harness.consoleErrors, harness.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await harness.close();
  }
});
