import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Event } from "../../src/core/types";
import { environmentProblem, launchApp } from "./fixtures";

const SESSION_ID = "s_tool_history";
const TURNS = 1200;
const ANSWER = "Large chat restored completely";

async function seedHistory(cwd: string): Promise<void> {
  const timestamp = Date.now() - 60_000;
  const ts = new Date(timestamp).toISOString();
  const events: Event[] = [
    {
      type: "session.started",
      sessionId: SESSION_ID,
      provider: "e2e",
      model: "e2e-model",
      prompt: "Tool-heavy history",
    },
  ];
  for (let turn = 1; turn <= TURNS; turn += 1) {
    const call = { id: `read-${turn}`, name: "read", args: { path: `src/file-${turn}.ts` } };
    events.push(
      { type: "turn.started", sessionId: SESSION_ID, turn },
      {
        type: "message.finished",
        sessionId: SESSION_ID,
        text: "",
        reasoning: `Inspect file ${turn}. ${"Check the implementation and its callers. ".repeat(8)}`,
        toolCalls: [call],
      },
      { type: "tool.started", sessionId: SESSION_ID, call },
      {
        type: "tool.finished",
        sessionId: SESSION_ID,
        call,
        result: { ok: true, output: "export const verified = true;\n".repeat(32), durationMs: 1 },
      },
    );
  }
  events.push(
    { type: "message.finished", sessionId: SESSION_ID, text: ANSWER, reasoning: "", toolCalls: [] },
    {
      type: "session.finished",
      sessionId: SESSION_ID,
      result: {
        sessionId: SESSION_ID,
        pass: true,
        stopReason: "end",
        summary: ANSWER,
        turns: TURNS,
        usage: { input: 0, output: 0, cached: 0 },
      },
    },
  );
  const root = join(cwd, ".flecten", "sessions");
  await mkdir(join(root, SESSION_ID), { recursive: true });
  await writeFile(
    join(root, SESSION_ID, "events.jsonl"),
    `${events.map((event, seq) => JSON.stringify({ seq: seq + 1, ts: new Date(timestamp + seq).toISOString(), schemaVersion: 1, sessionId: SESSION_ID, event })).join("\n")}\n`,
  );
  await writeFile(
    join(root, "index.json"),
    JSON.stringify({
      version: 2,
      sessions: [
        {
          id: SESSION_ID,
          title: "Tool-heavy history",
          project: cwd,
          createdAt: ts,
          updatedAt: ts,
          stopReason: "end",
          messageCount: 2,
          lastPrompt: "Tool-heavy history",
        },
      ],
    }),
  );
}

test("switching a tool-heavy chat keeps the renderer responsive", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp();
  try {
    await h.page.emulateMedia({ reducedMotion: "reduce" });
    await expect(h.page.locator("#prompt")).toBeVisible();
    await seedHistory(h.cwd);
    await h.page.reload();
    const task = h.page.locator("button.task-row").filter({ hasText: "Tool-heavy history" });
    await expect(task).toBeVisible();
    const profiler = await h.page.context().newCDPSession(h.page);
    await profiler.send("Profiler.enable");
    await profiler.send("Profiler.start");
    const probe = await h.page.evaluateHandle(() => {
      const durations: number[] = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) durations.push(entry.duration);
      });
      observer.observe({ type: "longtask" });
      return { observer, durations, started: performance.now() };
    });
    await task.dispatchEvent("click");
    await expect(h.page.locator(".answer").last()).toContainText(ANSWER, { timeout: 60_000 });
    const measurements = await probe.evaluate(({ observer, durations, started }) => {
      for (const entry of observer.takeRecords()) durations.push(entry.duration);
      observer.disconnect();
      return { openMs: performance.now() - started, longestTaskMs: Math.max(0, ...durations) };
    });
    const profile = await profiler.send("Profiler.stop");
    await writeFile(
      test.info().outputPath("chat-switch.cpuprofile"),
      JSON.stringify(profile.profile),
    );
    console.log("chat switch performance", measurements);
    await h.page.locator("#prompt").fill("Composer stays usable");
    await expect(h.page.locator("#prompt")).toContainText("Composer stays usable");
    await expect(h.page.locator(".run-summary")).toContainText(
      new Intl.NumberFormat("ru").format(TURNS),
    );
    await expect(h.page.locator(".run-details .turn")).toHaveCount(0);
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
      await h.page.screenshot({
        path: test.info().outputPath(`large-chat-${width}x${height}.png`),
        animations: "disabled",
      });
    }
    await h.page.getByRole("button", { name: "Новая задача", exact: true }).dispatchEvent("click");
    await expect(h.page.locator(".run-summary")).toHaveCount(0);
    await task.dispatchEvent("click");
    await expect(h.page.locator(".answer").last()).toContainText(ANSWER);
    await expect(h.page.locator("#prompt")).toContainText("Composer stays usable");
    await expect(h.page.locator(".run-details .turn")).toHaveCount(0);

    // Lazy mounting must keep every historical call accessible and preserve nested disclosure state.
    const summary = h.page.locator(".run-summary");
    await summary.dispatchEvent("click");
    await expect(h.page.locator(".run-details .turn")).toHaveCount(TURNS);
    const lastTurn = h.page.locator(".run-details .turn").last();
    await lastTurn.locator(".reasoning-head").dispatchEvent("click");
    await expect(lastTurn.locator(".reasoning-body")).toContainText(`Inspect file ${TURNS}.`);
    await lastTurn.locator(".action").dispatchEvent("click");
    await expect(lastTurn.locator(".action-detail")).toBeVisible();
    await expect(lastTurn.locator(".action-detail")).toContainText("export const verified = true;");
    await summary.dispatchEvent("click");
    await expect(h.page.locator(".run-details")).toBeHidden();
    await summary.dispatchEvent("click");
    await expect(lastTurn.locator(".action-detail")).toBeVisible();
    expect(h.consoleErrors).toEqual([]);
    expect(measurements.openMs).toBeLessThan(4000);
    expect(measurements.longestTaskMs).toBeLessThan(1000);
  } finally {
    await h.close();
  }
});
