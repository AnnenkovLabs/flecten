import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { AgentEvent } from "../../ui/src/lib/types";
import { environmentProblem, launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

async function refreshStatus(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const bridge = window.desktop?.agent;
        if (!bridge) return reject(new Error("Missing agent bridge"));
        const timer = setTimeout(() => {
          stop();
          reject(new Error("No refreshed status"));
        }, 10_000);
        const stop = bridge.onEvent((event) => {
          if (event.type !== "status") return;
          clearTimeout(timer);
          stop();
          resolve();
        });
        bridge.send({ type: "status" });
      }),
  );
}

async function selectModel(page: Page, name: string): Promise<void> {
  await page.locator(".model-button").click();
  const picker = page.getByRole("dialog", { name: "Select model" });
  await picker.getByRole("combobox").fill(name);
  await picker.getByRole("combobox").press("Enter");
  await expect(page.locator(".model-button")).toHaveText(name);
  await refreshStatus(page);
  await expect(page.locator(".model-button")).toHaveText(name);
}

async function send(page: Page, text: string): Promise<void> {
  await page.locator("#prompt").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".msg.user .bubble").last()).toHaveText(text);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
  await expect(page.locator(".model-button")).toBeEnabled();
}

for (const conversation of [false, true]) {
  test(`composer model selection survives status, navigation and reload (conversation=${conversation})`, async () => {
    const problem = environmentProblem();
    test.skip(Boolean(problem), problem);
    const h = await launchApp({
      locale: "en",
      conversation,
      firstCalls: [],
      reply: "Done.",
      models: {
        "e2e-model": { name: "Default model", context: 128000, output: 4096, tools: true },
        "chat-a": { name: "Chat A model", context: 64000, output: 2048, tools: true },
        "chat-b": { name: "Chat B model", context: 32000, output: 1024, tools: true },
      },
    });
    try {
      const { page } = h;
      await h.app.evaluate(({ BrowserWindow }) => {
        if (process.env.FLECTEN_E2E_PRIVATE_DISPLAY !== "1") return;
        BrowserWindow.getAllWindows()[0]?.restore();
        BrowserWindow.getAllWindows()[0]?.showInactive();
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator(".model-button")).toHaveText("Default model");
      await send(page, "First chat original message");
      await selectModel(page, "Chat A model");
      await send(page, "First chat changed model");
      await page.getByRole("button", { name: "New task", exact: true }).click();
      await expect(page.locator(".model-button")).toHaveText("Default model");
      await selectModel(page, "Chat B model");
      await send(page, "Second chat message");
      await page.locator(".task-row").filter({ hasText: "First chat original message" }).click();
      await expect(page.locator(".model-button")).toHaveText("Chat A model");
      await refreshStatus(page);
      await expect(page.locator(".model-button")).toHaveText("Chat A model");
      await page.reload();
      await page.locator(".task-row").filter({ hasText: "Second chat message" }).click();
      await expect(page.locator(".model-button")).toHaveText("Chat B model");
      // The selectable tooltip from the previous row can cover this button.
      await page
        .locator(".task-row")
        .filter({ hasText: "First chat original message" })
        .press("Enter");
      await expect(page.locator(".model-button")).toHaveText("Chat A model");
      for (const [width, height] of [
        [1480, 940],
        [1180, 640],
      ] as const) {
        await h.app.evaluate(
          ({ BrowserWindow }, size) => {
            const window = BrowserWindow.getAllWindows()[0];
            window?.setMinimumSize(0, 0);
            window?.setContentSize(size.width, size.height);
          },
          { width, height },
        );
        await page.setViewportSize({ width, height });
        await hiddenScreenshot(h, test.info().outputPath(`chat-model-${width}x${height}.png`));
      }
      const entries = await readdir(join(h.cwd, ".flecten/sessions"), { withFileTypes: true });
      const runs: Array<Extract<AgentEvent, { type: "session.started" }>> = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const source = await readFile(
          join(h.cwd, ".flecten/sessions", entry.name, "events.jsonl"),
          "utf8",
        );
        for (const line of source.trim().split("\n")) {
          const { event } = JSON.parse(line) as { event: AgentEvent };
          if (event.type === "session.started") runs.push(event);
        }
      }
      expect(runs.find((event) => event.prompt === "First chat changed model")?.model).toBe(
        "chat-a",
      );
      expect(runs.find((event) => event.prompt === "Second chat message")?.model).toBe("chat-b");
      if (conversation)
        expect(runs.find((event) => event.prompt === "Second chat message")?.role).toBe("talker");
      expect(h.consoleErrors).toEqual([]);
    } finally {
      await h.close();
    }
  });
}
