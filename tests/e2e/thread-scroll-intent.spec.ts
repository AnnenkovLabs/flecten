import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { AgentEvent, AgentToolCall } from "../../ui/src/lib/types";
import { environmentProblem, launchApp, type Page } from "./fixtures";

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 4;
        const frame = () => {
          if (--frames === 0) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
  );
}

test("one upward gesture releases following through every response phase", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const reply = Array.from(
    { length: 35 },
    (_, index) =>
      `### Record ${index + 1}\n\nA detailed result that remains available while the agent works.`,
  ).join("\n\n");
  const h = await launchApp({
    reply,
    locale: "en",
    models: {
      "e2e-model": { name: "E2E Mock", context: 200_000, output: 4096, tools: true },
    },
  });
  try {
    const { page, app } = h;
    const thread = page.locator(".thread");
    const jump = page.locator("button.jump");
    const distance = () =>
      thread.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
    const emit = async (events: AgentEvent[]) => {
      await app.evaluate(({ BrowserWindow }, payload) => {
        for (const event of payload)
          BrowserWindow.getAllWindows()[0]?.webContents.send("agent:event", event);
      }, events);
    };
    const follow = async () => {
      if (await jump.isVisible()) await jump.click();
      else
        await thread.evaluate((node) => {
          node.scrollTop = node.scrollHeight;
          node.dispatchEvent(new Event("scroll"));
        });
      await settle(page);
      expect(await distance()).toBeLessThanOrEqual(2);
    };
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#prompt").fill("Keep the reading position");
    await page.locator("#prompt").press("Enter");
    await expect(page.locator(".answer").last()).toContainText("Record 35");
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
    const sessions = await readdir(join(h.cwd, ".liquid/sessions"), { withFileTypes: true });
    const sessionId = sessions.find((entry) => entry.isDirectory())?.name;
    if (!sessionId) throw new Error("The fixture did not create a session");
    const task = page.locator("button.task-row").filter({ hasText: "Keep the reading position" });

    for (const size of [
      { width: 1480, height: 940 },
      { width: 1180, height: 640 },
    ]) {
      // Navigation reloads the real stored fixture, independently of the injected live phases.
      await page.reload();
      await task.click();
      await expect(page.locator(".answer").last()).toContainText("Record 35");
      await app.evaluate(({ BrowserWindow }, dimensions) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(dimensions.width, dimensions.height);
      }, size);
      await page.setViewportSize(size);
      const upward = async (
        phase: string,
        updates: AgentEvent[] = [],
        mode: "wheel" | "scrollbar" | "queued" = "wheel",
      ) => {
        await follow();
        if (mode === "wheel") {
          await thread.hover();
          await page.mouse.wheel(0, -12);
        } else if (mode === "queued") {
          await thread.evaluate((node) => {
            // Hold the browser's first notification so resize sees the position first.
            node.addEventListener("scroll", (event) => event.stopImmediatePropagation(), {
              capture: true,
              once: true,
            });
            node.scrollTop -= 12;
          });
        } else {
          await thread.evaluate((node) => {
            node.scrollTop -= 12;
            node.dispatchEvent(new Event("scroll"));
          });
        }
        await emit(updates);
        // The real viewport resize path must not turn a reading gesture into following.
        await page.setViewportSize({
          ...size,
          height: page.viewportSize()?.height === size.height ? size.height - 1 : size.height,
        });
        await settle(page);
        expect(await distance(), `${phase}: the first upward gesture was undone`).toBeGreaterThan(
          8,
        );
        await expect(jump).toBeVisible();
        await page.screenshot({ path: test.info().outputPath(`${phase}-${size.width}.png`) });
      };

      await upward("completed", [], "scrollbar");
      const savedTop = await thread.evaluate((node) => node.scrollTop);
      await page.getByRole("button", { name: "New task", exact: true }).click();
      await task.click();
      await expect
        .poll(async () => Math.abs((await thread.evaluate((node) => node.scrollTop)) - savedTop))
        .toBeLessThan(3);
      await expect(jump).toBeVisible();
      await settle(page);
      await thread.evaluate((node) => {
        node.scrollTop += 6;
        node.dispatchEvent(new Event("scroll"));
      });
      await expect(jump).toHaveCount(0);
      await page.setViewportSize(size);
      await settle(page);
      expect(await distance()).toBeLessThanOrEqual(2);
      await follow();
      await upward("queued-scroll", [], "queued");

      const reasoning = "Checking the next part of the project. ";
      await emit([
        {
          type: "session.started",
          sessionId,
          provider: "e2e",
          model: "e2e-model",
          prompt: "Continue the review",
        },
        { type: "turn.started", sessionId, turn: 1 },
        { type: "reasoning.delta", sessionId, text: reasoning },
      ]);
      await upward("reasoning", [{ type: "reasoning.delta", sessionId, text: reasoning }]);

      await emit([
        { type: "tool_call.progress", sessionId, index: 0, name: "read", delta: '{"path":' },
      ]);
      await upward("tool-arguments", [
        { type: "tool_call.progress", sessionId, index: 0, delta: '"README.md"}' },
        {
          type: "tool_call.progress",
          sessionId,
          index: 1,
          name: "read",
          delta: '{"path":"next.md"}',
        },
      ]);
      const call: AgentToolCall = {
        id: `scroll-read-${size.width}`,
        name: "read",
        args: { path: "README.md" },
      };
      await emit([
        { type: "message.finished", sessionId, text: "", reasoning, toolCalls: [call] },
        { type: "tool.started", sessionId, call },
      ]);
      await upward("running-tool", [
        { type: "tool.output", sessionId, callId: call.id, text: "Another tool output line.\n" },
      ]);
      await emit([
        {
          type: "tool.finished",
          sessionId,
          call,
          result: { ok: true, output: "Read complete", durationMs: 10 },
        },
        { type: "turn.started", sessionId, turn: 2 },
        { type: "message.delta", sessionId, text: "A streamed answer begins.\n\n" },
      ]);
      const streamed =
        "A streamed answer begins.\n\nThe next paragraph arrives while reading earlier text.\n\nFollowing resumes after the explicit jump.\n\n";
      await upward("answer-stream", [
        {
          type: "message.delta",
          sessionId,
          text: "The next paragraph arrives while reading earlier text.\n\n",
        },
      ]);
      await follow();
      await emit([
        {
          type: "message.delta",
          sessionId,
          text: "Following resumes after the explicit jump.\n\n",
        },
      ]);
      await settle(page);
      expect(await distance()).toBeLessThanOrEqual(2);

      await upward("completion", [
        { type: "message.finished", sessionId, text: streamed, reasoning: "", toolCalls: [] },
        {
          type: "session.finished",
          sessionId,
          result: {
            sessionId,
            pass: false,
            stopReason: "end",
            summary: "",
            turns: 2,
            usage: { input: 0, output: 0, cached: 0 },
          },
        },
      ]);
      await upward("after-completion");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
