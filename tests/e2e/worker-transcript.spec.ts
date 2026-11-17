import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { WorkerSessionEvent } from "../../ui/src/lib/agent-protocol";
import type { AgentEvent, AgentToolCall } from "../../ui/src/lib/types";
import { environmentProblem, launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

test("Worker uses the agent transcript for thinking, writing and tools without another composer", async () => {
  test.skip(Boolean(environmentProblem()), environmentProblem());
  const h = await launchApp({ locale: "en", reply: "Ready for verification." });
  try {
    const { page, app } = h;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#prompt").fill("Inspect the Worker transcript");
    await page.locator("#prompt").press("Enter");
    await expect(page.locator("#pane-thread .run-check")).toBeVisible();
    const entries = await readdir(join(h.cwd, ".flecten/sessions"), { withFileTypes: true });
    const sessionId = entries.find((entry) => entry.isDirectory())?.name;
    if (!sessionId) throw new Error("No transcript fixture session");
    const workerId = `${sessionId}_worker`;
    const emit = (events: WorkerSessionEvent[]) =>
      app.evaluate(
        ({ BrowserWindow }, payload: AgentEvent[]) => {
          const contents = BrowserWindow.getAllWindows()[0]?.webContents;
          for (const event of payload) contents?.send("agent:event", event);
        },
        events.map((event) => ({ type: "worker.event" as const, sessionId, event })),
      );
    const shot = async (state: string) => {
      for (const [width, height] of [
        [1480, 940],
        [1180, 640],
      ] as const) {
        await app.evaluate(
          ({ BrowserWindow }, size) => {
            BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
          },
          { width, height },
        );
        await page.setViewportSize({ width, height });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(
          await page
            .locator("#pane-worker .thread")
            .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
        ).toBe(true);
        await hiddenScreenshot(h, test.info().outputPath(`worker-${state}-${width}.png`));
      }
    };
    await emit([
      {
        type: "session.started",
        sessionId: workerId,
        provider: "e2e",
        model: "e2e-model",
        prompt: "Inspect the project and describe the result.",
      },
      { type: "turn.started", sessionId: workerId, turn: 1 },
      {
        type: "reasoning.delta",
        sessionId: workerId,
        text: "I will compare the current implementation with the project guidance before making changes.",
      },
    ]);
    await page.getByRole("tab", { name: /^Worker activity/ }).click();
    const worker = page.locator("#pane-worker");
    await expect(worker.locator(".live-run")).toContainText("Thinking");
    await expect(worker.locator(".thread")).toHaveCount(1);
    await expect(worker.locator('#prompt, [contenteditable="true"]')).toHaveCount(0);
    await expect(page.locator("#prompt")).toHaveCount(1);
    await worker.locator(".run-summary").click();
    await worker.locator(".reasoning-head").click();
    await expect(worker.locator(".reasoning-body")).toContainText(
      "compare the current implementation",
    );
    await shot("thinking");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(1480, 940),
    );
    await page.setViewportSize({ width: 1480, height: 940 });
    await page.locator(".split-button").click();
    for (const target of [
      page.getByRole("tab", { name: /^Worker activity/ }),
      worker.getByRole("button", { name: "Stop Worker", exact: true }),
    ]) {
      await target.focus();
      await page.keyboard.press("Control+f");
      await expect(
        worker.getByRole("textbox", { name: "Search conversation", exact: true }),
      ).toBeFocused();
      await expect(page.locator("#pane-thread .thread-search")).toHaveCount(0);
      await worker.getByRole("button", { name: "Close search", exact: true }).click();
    }
    await page.locator("#prompt").focus();
    await page.keyboard.press("Control+f");
    await expect(
      page
        .locator("#pane-thread")
        .getByRole("textbox", { name: "Search conversation", exact: true }),
    ).toBeFocused();
    await page
      .locator("#pane-thread")
      .getByRole("button", { name: "Close search", exact: true })
      .click();
    await page.locator(".split-button").click();

    await emit([
      { type: "message.started", sessionId: workerId },
      {
        type: "message.delta",
        sessionId: workerId,
        text: "The project uses the existing agent transcript. I am checking its live states.",
      },
    ]);
    await expect(worker.locator(".live-run")).toContainText("Writing");
    await expect(worker.locator(".answer.is-streaming")).toContainText("checking its live states");
    await shot("writing");

    await emit([
      {
        type: "tool_call.progress",
        sessionId: workerId,
        index: 0,
        name: "bash",
        delta: '{"command":"bun run check"}',
      },
    ]);
    await expect(worker.locator(".live-run")).toContainText("Preparing a call");
    await expect(worker.locator(".calls")).toContainText("bun run check");
    const call: AgentToolCall = {
      id: "worker-ui-check",
      name: "bash",
      args: { command: "bun run check" },
    };
    await emit([
      {
        type: "message.finished",
        sessionId: workerId,
        text: "The project uses the existing agent transcript. I am checking its live states.",
        reasoning:
          "I will compare the current implementation with the project guidance before making changes.",
        toolCalls: [call],
      },
      { type: "tool.started", sessionId: workerId, call },
      {
        type: "tool.output",
        sessionId: workerId,
        callId: call.id,
        text: "Type checking in progress...\n",
      },
    ]);
    await expect(worker.locator(".live-run")).toContainText("Working");
    await expect(worker.locator("button.action:visible")).toContainText("bun run check");
    await worker.locator("button.action:visible").click();
    await expect(worker.locator(".detail")).toContainText("Type checking in progress");
    await expect(worker.locator(".calls")).toHaveCount(0);
    await shot("working");
    await emit([
      {
        type: "tool.finished",
        sessionId: workerId,
        call,
        result: { ok: true, output: "No errors found.", durationMs: 3200 },
      },
      { type: "turn.started", sessionId: workerId, turn: 2 },
      {
        type: "message.finished",
        sessionId: workerId,
        text: "The transcript shows reasoning, responses and tools in the same agent view.",
        reasoning: "",
        toolCalls: [],
      },
      {
        type: "session.finished",
        sessionId: workerId,
        result: {
          sessionId: workerId,
          stopReason: "end",
          summary: "The transcript shows reasoning, responses and tools in the same agent view.",
          turns: 1,
          pass: true,
          usage: { input: 10, output: 20, cached: 0 },
        },
      },
    ]);
    await expect(worker.locator(".live-run")).toHaveCount(0);
    await expect(worker.locator(".answer").last()).toContainText("same agent view");
    await expect(worker.getByRole("button", { name: "Stop Worker", exact: true })).toHaveCount(0);
    await shot("done");
    await app.evaluate(({ BrowserWindow }, parent) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("agent:event", {
        type: "worker.acceptance",
        sessionId: parent,
        acceptance: {
          taskId: "long-history",
          revision: 0,
          legacy: false,
          phase: "running",
          directions: [],
          assignment: {
            objective: "Inspect the complete project history and preserve the public API.\n".repeat(
              130,
            ),
            userConstraints: [],
            expectedOutputs: ["Verified transcript"],
            acceptanceCriteria: [
              {
                id: "history",
                description: "History stays readable",
                evidenceRequirement: "model_assertion",
              },
            ],
          },
          criteria: [{ id: "history", status: "open" }],
        },
      });
    }, sessionId);
    await emit([
      {
        type: "session.started",
        sessionId: workerId,
        provider: "e2e",
        model: "e2e-model",
        prompt: "Review the full history",
      },
      ...Array.from(
        { length: 80 },
        (_, index): WorkerSessionEvent => ({
          type: "message.finished",
          sessionId: workerId,
          text: `History entry ${index}. The recorded step remains available.`,
          reasoning: "",
          toolCalls: [],
        }),
      ),
    ]);
    const acceptance = worker.locator(".worker-acceptance summary");
    await acceptance.scrollIntoViewIfNeeded();
    await acceptance.click();
    await worker.locator(".thread").evaluate((scroller) => {
      const header = scroller.querySelector<HTMLElement>(".thread-header");
      if (!header) throw new Error("Missing transcript header");
      scroller.scrollTop +=
        header.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top;
      scroller.dispatchEvent(new Event("scroll"));
    });
    await expect(
      worker
        .locator(".msg.user .bubble")
        .filter({ hasText: "Inspect the project and describe the result." }),
    ).toBeInViewport();
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
