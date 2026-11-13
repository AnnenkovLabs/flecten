import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Event } from "../../src/core/types";
import { environmentProblem, launchApp } from "./fixtures";

async function seedHistory(cwd: string): Promise<void> {
  const sessionId = "s_virtual_history";
  const ts = new Date().toISOString();
  const events: Event[] = [];
  for (let index = 0; index < 400; index += 1) {
    const marker = String(index).padStart(4, "0");
    events.push(
      {
        type: "session.started",
        sessionId,
        provider: "e2e",
        model: "e2e-model",
        prompt: index === 0 ? "Virtualized history" : `Review record ${marker}`,
      },
      {
        type: "message.finished",
        sessionId,
        text: `UNIQUE_ARCHIVE_${marker}\n\n${"Measured history content. ".repeat((index % 6) + 1)}`,
        reasoning: "",
        toolCalls: [],
      },
      {
        type: "session.finished",
        sessionId,
        result: {
          sessionId,
          pass: false,
          stopReason: "end",
          summary: "",
          turns: 1,
          usage: { input: 0, output: 0, cached: 0 },
        },
      },
    );
  }
  const root = join(cwd, ".liquid", "sessions");
  await mkdir(join(root, sessionId), { recursive: true });
  await writeFile(
    join(root, sessionId, "events.jsonl"),
    `${events.map((event, seq) => JSON.stringify({ seq: seq + 1, ts, schemaVersion: 1, sessionId, event })).join("\n")}\n`,
  );
  await writeFile(
    join(root, "index.json"),
    JSON.stringify({
      version: 2,
      sessions: [
        {
          id: sessionId,
          title: "Virtualized history",
          project: cwd,
          createdAt: ts,
          updatedAt: ts,
          stopReason: "end",
          messageCount: 800,
          lastPrompt: "Review record 0399",
        },
      ],
    }),
  );
}

async function anchor(page: Page): Promise<{ id: string; top: number }> {
  return page.locator(".thread").evaluate((scroller) => {
    const top = scroller.getBoundingClientRect().top;
    const row = [...scroller.querySelectorAll<HTMLElement>("[data-thread-key]")].find(
      (node) => node.getBoundingClientRect().bottom > top + 40,
    );
    if (!row) throw new Error("No mounted reading anchor");
    return { id: row.dataset.threadKey ?? "", top: row.getBoundingClientRect().top - top };
  });
}

test("long threads mount a bounded window while search, task restoration and follow remain usable", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({ reply: "Live appended answer", delayMs: 100 });
  try {
    await h.page.emulateMedia({ reducedMotion: "reduce" });
    await expect(h.page.locator("#prompt")).toBeVisible();
    await seedHistory(h.cwd);
    await h.page.reload();
    const task = h.page.locator("button.task-row").filter({ hasText: "Virtualized history" });
    await expect(task).toBeVisible();
    await task.click();
    await expect(h.page.locator(".answer").last()).toContainText("UNIQUE_ARCHIVE_0399");
    await expect.poll(() => h.page.locator(".thread-item").count()).toBeLessThanOrEqual(80);
    expect(await h.page.locator(".thread-spacer").count()).toBeGreaterThan(0);
    expect(await h.page.locator(".thread").evaluate((node) => node.scrollHeight)).toBeGreaterThan(
      50_000,
    );

    await h.page.keyboard.press("Control+f");
    await h.page
      .getByRole("textbox", { name: "Поиск по треду", exact: true })
      .fill("UNIQUE_ARCHIVE_0005");
    await expect(h.page.locator(".is-search-active")).toContainText("UNIQUE_ARCHIVE_0005");
    await expect(h.page.locator(".is-search-active")).toBeInViewport();
    await h.page.keyboard.press("Escape");
    const before = await anchor(h.page);
    await h.page.getByRole("button", { name: "Новая задача", exact: true }).click();
    await task.click();
    await expect.poll(async () => (await anchor(h.page)).id).toBe(before.id);
    await expect
      .poll(async () => Math.abs((await anchor(h.page)).top - before.top))
      .toBeLessThan(3);

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
      await expect.poll(() => h.page.locator(".thread-item").count()).toBeLessThanOrEqual(80);
      await h.page.screenshot({
        path: test.info().outputPath(`virtual-thread-${width}x${height}.png`),
        animations: "disabled",
      });
    }

    await h.page.getByRole("button", { name: "Вниз, к последнему сообщению", exact: true }).click();
    await h.page.locator("#prompt").fill("One more step");
    await h.page.locator("#prompt").press("Enter");
    await expect(h.page.locator(".answer").last()).toContainText("Live appended answer");
    await expect
      .poll(() =>
        h.page
          .locator(".thread")
          .evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight),
      )
      .toBeLessThanOrEqual(2);
    const stop = h.page.getByRole("button", { name: "Остановить", exact: true });
    if (await stop.isVisible()) await stop.click();
    await expect(stop).toBeHidden({ timeout: 3000 });
    await expect.poll(() => h.page.locator(".thread-item").count()).toBeLessThanOrEqual(80);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
