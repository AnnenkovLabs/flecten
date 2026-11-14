import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { AgentEvent, AgentReplay } from "../../ui/src/lib/agent-protocol";
import { environmentProblem, launchApp, type Page } from "./fixtures";

async function replay(page: Page, sessionId: string): Promise<AgentReplay> {
  return page.evaluate(async (id) => {
    const requestId = crypto.randomUUID();
    return new Promise<AgentReplay>((resolve, reject) => {
      const timer = setTimeout(() => {
        stop?.();
        reject(new Error("Run replay timed out"));
      }, 10_000);
      const stop = window.desktop?.agent?.onEvent((event: AgentEvent) => {
        if (event.type !== "response" || event.requestId !== requestId) return;
        clearTimeout(timer);
        stop?.();
        if (event.ok && event.replay) resolve(event.replay);
        else reject(new Error(event.error ?? "Run replay missing"));
      });
      window.desktop?.agent?.send({ type: "events.replay", sessionId: id, requestId });
    });
  }, sessionId);
}

test("chat navigation preserves elapsed work, idle streams keep ticking and completed times stay fixed", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({
    holdSummary: true,
    locale: "en",
    models: {
      "e2e-model": {
        name: "E2E Mock",
        context: 200_000,
        output: 4096,
        tools: true,
        reasoning: false,
      },
    },
  });
  try {
    const { page, app } = h;
    await page.emulateMedia({ reducedMotion: "reduce" });
    const prompt = page.locator("#prompt");
    await prompt.fill("Read README and keep the timer");
    await prompt.press("Enter");
    const pendingSummary = page.getByRole("status", { name: "Preparing summary", exact: true });
    await expect(pendingSummary).toBeVisible();

    const sessions = await readdir(join(h.cwd, ".liquid/sessions"), { withFileTypes: true });
    const sessionId = sessions.find((entry) => entry.isDirectory())?.name;
    if (!sessionId) throw new Error("The live run did not create a session");
    const initial = await replay(page, sessionId);
    const start = initial.events.find((event) => event.type === "session.started")?.timestamp;
    if (start === undefined) throw new Error("The live run has no original start time");
    const task = page
      .locator("button.task-row")
      .filter({ hasText: "Read README and keep the timer" });
    const summary = page.locator("button.run-summary").last();

    // Fix Date only: actual UI intervals still run while the provider stream is held.
    await page.clock.setFixedTime(start + 45_000);
    await expect(summary).toContainText("Working 45 sec");
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await expect(page.locator(".run-summary")).toHaveCount(0);
    await task.click();
    await expect(summary).toContainText("Working 45 sec");
    await page.clock.setFixedTime(start + 50_000);
    await expect(summary).toContainText("Working 50 sec");

    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height),
        { width, height },
      );
      await page.setViewportSize({ width, height });
      await page.locator(".thread").hover();
      await page.mouse.wheel(0, -2000);
      await expect(summary).toBeInViewport();
      await expect(summary).toContainText("Working 50 sec");
      expect(
        await page.locator(".thread").evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`run-timing-${width}x${height}.png`) });
    }

    // The sidecar uses its real clock, so return the renderer to that clock before finishing.
    await page.clock.setSystemTime(Date.now());
    await h.releaseSummary();
    await expect(pendingSummary).toHaveCount(0);
    await expect(summary).toContainText("Worked");
    const completed = await summary.innerText();
    await page.clock.setFixedTime(Date.now() + 3_600_000);
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await task.click();
    await expect(summary).toHaveText(completed);
    await page.reload();
    await task.click();
    await expect(summary).toHaveText(completed);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
