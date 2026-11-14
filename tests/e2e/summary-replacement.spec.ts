import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { AgentEvent } from "../../ui/src/lib/types";
import { launchApp } from "./fixtures";

test("the summary frame replaces same-length, growing and shorter final HTML", async () => {
  const h = await launchApp({
    reply: "Ready.",
    locale: "en",
    models: { "e2e-model": { name: "E2E Mock", context: 131072, output: 4096, tools: true } },
  });
  try {
    const { page } = h;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#prompt").fill("Read README.md");
    await page.locator("#prompt").press("Enter");
    await expect(page.locator(".answer").last()).toContainText("Ready.");
    const sessions = await readdir(join(h.cwd, ".liquid/sessions"), { withFileTypes: true });
    const sessionId = sessions.find((entry) => entry.isDirectory())?.name;
    if (!sessionId) throw new Error("session missing");
    const emit = async (events: AgentEvent[]) => {
      await h.app.evaluate(({ BrowserWindow }, payload) => {
        for (const event of payload)
          BrowserWindow.getAllWindows()[0]?.webContents.send("agent:event", event);
      }, events);
    };
    const draft = "<h2>Draft</h2><p>Summary preview</p>";
    const final = "<h2>Final</h2><p>Summary checked</p>";
    expect(draft.length).toBe(final.length);
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const [html, text] of [
        [final, "FinalSummary checked"],
        [
          "<h2>Revised</h2><p>A longer replacement with a changed prefix</p>",
          "RevisedA longer replacement with a changed prefix",
        ],
        ["<h2>Done</h2>", "Done"],
      ] as const) {
        await emit([
          {
            type: "session.started",
            sessionId,
            provider: "e2e",
            model: "e2e-model",
            prompt: "Check summary",
          },
          { type: "message.delta", sessionId, text: `<summary>${draft}` },
        ]);
        const element = page.locator("iframe.summary").last();
        const frame = page.frameLocator("iframe.summary").last();
        await expect(frame.getByRole("heading", { name: "Draft", exact: true })).toBeVisible();
        const count = await page.locator("iframe.summary").count();
        await element.evaluate((node) => {
          node.dataset.testInstance = "same-frame";
        });
        if (html === final)
          await page.screenshot({ path: test.info().outputPath(`summary-draft-${width}.png`) });
        await emit([
          {
            type: "message.finished",
            sessionId,
            text: "",
            reasoning: "",
            toolCalls: [],
            summary: html,
          },
        ]);
        await expect(frame.locator("#summary-root")).toHaveText(text);
        await expect(element).toHaveAttribute("data-test-instance", "same-frame");
        await expect(page.locator("iframe.summary")).toHaveCount(count);
        await expect(element).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: test.info().outputPath(`summary-final-${width}.png`) });
    }
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
