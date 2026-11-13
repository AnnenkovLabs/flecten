import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { type ElectronApplication, environmentProblem, launchApp } from "./fixtures";

function skipIfUnavailable(): void {
  const problem = environmentProblem();
  if (!problem) return;
  console.warn(`[e2e] skipped: ${problem}`);
  test.skip(true, problem);
}

/** Hands the window an event as if the core had sent it. */
async function agentEvent(app: ElectronApplication, event: Record<string, unknown>): Promise<void> {
  await app.evaluate(({ BrowserWindow }, payload) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("agent:event", payload);
  }, event);
}

/** A notice sits fully above or fully below the composer, never on it. */
async function expectClearOfComposer(page: Page, notice: Locator): Promise<"above" | "below"> {
  const box = await notice.boundingBox();
  const composer = await page.locator("form.composer").boundingBox();
  if (!box || !composer) throw new Error("notice or composer is not on screen");
  if (box.y + box.height <= composer.y) return "above";
  expect(box.y).toBeGreaterThanOrEqual(composer.y + composer.height);
  return "below";
}

test("temporary notices stay clear of the composer and pause while being read", async () => {
  skipIfUnavailable();
  const harness = await launchApp();

  try {
    const { app, page } = harness;
    await expect(page.locator('section[aria-label="Новая сессия"]')).toBeVisible();

    await agentEvent(app, {
      type: "error",
      code: "provider_failed",
      sessionId: "s_background",
      message: "ключ не подошёл",
    });
    const error = page.locator(".toast.is-error");
    await expect(error).toContainText("ключ не подошёл");
    await agentEvent(app, { type: "sessions.interrupted", interrupted: ["s_a"], resumed: ["s_a"] });
    const info = page.locator(".toast:not(.is-error)");
    await expect(info).toContainText("Продолжаю прерванные задачи: 1");
    // The start screen keeps its greeting and project in view: notices rise from the bottom.
    expect(await expectClearOfComposer(page, error)).toBe("below");
    expect(await expectClearOfComposer(page, info)).toBe("below");

    await error.hover();
    await page.waitForTimeout(6_200);
    await expect(error).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(info).toHaveCount(0, { timeout: 8_000 });
    await expect(error).toHaveCount(0, { timeout: 8_000 });

    // In a task the notice rises above the docked composer as well.
    await page.locator("#prompt").fill("Прочитай README.md и покажи краткий итог.");
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(page.getByRole("button", { name: "Остановить" })).toBeHidden({ timeout: 45_000 });
    await agentEvent(app, {
      type: "error",
      code: "provider_failed",
      sessionId: "s_background",
      message: "лимит исчерпан",
    });
    await expect(error).toContainText("лимит исчерпан");
    expect(await expectClearOfComposer(page, error)).toBe("above");

    expect(harness.consoleErrors, harness.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await harness.close();
  }
});

test("a second window on the same project says why and does not restart its core", async () => {
  skipIfUnavailable();
  const first = await launchApp();

  try {
    await expect(first.page.locator('section[aria-label="Новая сессия"]')).toBeVisible();
    await expect.poll(() => existsSync(join(first.cwd, ".liquid", "sidecar.lock"))).toBe(true);

    const second = await launchApp({ cwd: first.cwd });
    try {
      const card = second.page
        .locator(".error-card")
        .filter({ hasText: "Проект уже открыт в другом окне Flecten" });
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.locator("summary").click();
      await expect(card.locator("pre")).toContainText("sidecar.lock");

      // No restart loop: no «Перезапускаю ядро», no second card.
      await second.page.waitForTimeout(2_500);
      await expect(second.page.locator(".toast")).toHaveCount(0);
      await expect(second.page.locator(".error-card")).toHaveCount(1);
      expect(second.consoleErrors, second.consoleErrors.join("\n")).toEqual([]);
    } finally {
      await second.close();
    }
  } finally {
    await first.close();
  }
});
