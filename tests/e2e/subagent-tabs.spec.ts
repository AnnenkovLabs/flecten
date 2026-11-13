import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp } from "./fixtures";

test("five named children have live tabs and survive parent stop with independent cancellation", async () => {
  const harness = await launchApp({
    models: {
      "e2e-model": {
        name: "E2E Mock",
        context: 131072,
        output: 4096,
        tools: true,
        reasoning: false,
      },
    },
    holdSummary: true,
    firstCalls: Array.from({ length: 5 }, () => ({
      name: "task",
      arguments: {
        agent: "explore",
        prompt:
          "Read README.md and acknowledge readiness. Do not modify files or invent findings. Return the required role report.",
      },
    })),
  });
  const { app, page } = harness;
  const out = join(process.cwd(), ".liquid/tool-ux");
  await mkdir(out, { recursive: true });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(1480, 940),
    );
    await page.setViewportSize({ width: 1480, height: 940 });
    await page.locator("#prompt").fill("Подготовь пять субагентов");
    await page.locator("#prompt").press("Enter");
    const tabs = page.locator('[role="tab"][data-tab^="subagent:"]');
    await expect(tabs).toHaveCount(5);
    const names = ["Milo", "Lumi", "Pip", "Kiki", "Nori"];
    for (const [i, name] of names.entries()) {
      await expect(tabs.nth(i)).toContainText(name);
      await expect(tabs.nth(i).locator(".subagent-avatar")).toHaveCount(1);
    }
    const colors = await tabs
      .locator(".subagent-avatar")
      .evaluateAll((icons) =>
        icons.map((icon) => getComputedStyle(icon).getPropertyValue("--avatar-body")),
      );
    expect(new Set(colors).size).toBe(5);
    await page.locator(".run-summary").click();
    await expect(page.locator(".run-details .action-content.is-subagent:visible")).toHaveCount(5);
    await page.locator(".run-summary").click();
    await expect(page.locator(".run-preview .action-content.is-subagent:visible")).toHaveCount(5);
    for (const row of await page.locator(".run-preview .action-content:visible").all())
      await expect(row).not.toContainText("Read README.md and acknowledge");
    await page.screenshot({ path: join(out, "subagents-compact-1480.png") });
    await tabs.nth(1).click();
    await expect(page.locator(".subagent-head")).toContainText("Lumi");
    await expect(page.locator(".subagent-pane")).toContainText("README.md");
    const firstTab = page.getByRole("tab", { name: "Диалог", exact: true });
    await firstTab.click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".composer-bar button.stop")).toHaveCount(0);
    await tabs.nth(0).click();
    await expect(page.locator(".subagent-head")).toContainText("Выполняется");
    await page.locator(".stop-child").click();
    await expect(page.locator(".subagent-head")).toContainText("Остановлено");
    await tabs.nth(1).click();
    await expect(page.locator(".subagent-head")).toContainText("Выполняется");
    await page.screenshot({ path: join(out, "subagent-live-1480.png") });
    await harness.releaseSummary();
    await expect(page.locator(".subagent-head")).toContainText("Готово");
    await expect(page.locator(".subagent-pane")).toContainText("Готов к работе");
    await expect(page.locator(".child-error")).toHaveCount(0);
    await expect(page.locator(".subagent-pane .assignment").first()).not.toHaveAttribute(
      "open",
      "",
    );
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, [w, h]) =>
          BrowserWindow.getAllWindows()[0]?.setContentSize(w ?? 0, h ?? 0),
        [width, height],
      );
      await page.setViewportSize({ width, height });
      await tabs.nth(4).click();
      await tabs.nth(4).focus();
      await tabs.nth(4).press("ArrowLeft");
      await expect(tabs.nth(3)).toHaveAttribute("aria-selected", "true");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const pane = await page.locator(".subagent-pane").boundingBox();
      expect(pane && pane.width > 600).toBe(true);
      await page.screenshot({ path: join(out, `subagent-tab-${width}.png`) });
    }
    await page.reload();
    await page.locator(".task-row").filter({ hasText: "Подготовь пять субагентов" }).click();
    await expect(page.locator('[role="tab"][data-tab^="subagent:"]')).toHaveCount(5);
    await page.getByRole("tab", { name: /Lumi/ }).click();
    await expect(page.locator(".subagent-head")).toContainText("Готово");
    await expect(page.locator(".subagent-pane")).toContainText("Готов к работе");
    expect(harness.consoleErrors).toEqual([]);
  } finally {
    await harness.close();
  }
});
