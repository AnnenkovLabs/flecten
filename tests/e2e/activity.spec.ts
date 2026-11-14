import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { AgentEvent } from "../../ui/src/lib/agent-protocol";
import type { AgentBudget } from "../../ui/src/lib/types";
import { type ElectronApplication, launchApp } from "./fixtures";

async function emit(app: ElectronApplication, events: AgentEvent[]): Promise<void> {
  await app.evaluate(({ BrowserWindow }, payload) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents;
    for (const event of payload) contents?.send("agent:event", event);
  }, events);
}

test("activity stays compact until inspected and failed actions remain accessible", async () => {
  const harness = await launchApp({ reply: "Проверка завершена." });
  const { page, app, cwd } = harness;
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const prompt = page.locator("#prompt");
    await expect(prompt).toBeVisible();
    await prompt.fill("Прочитай README.md");
    await prompt.press("Enter");
    await expect(page.getByRole("button", { name: "Остановка", exact: true })).toBeHidden();
    const run = page.locator(".run").first();
    const summary = run.locator("button.run-summary");
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await expect(run.locator(".run-details")).toBeHidden();
    await summary.click();
    await expect(run.locator(".run-details")).toBeVisible();
    const read = run.locator("button.action").filter({ hasText: "README.md" });
    await expect(read).toBeVisible();
    await read.click();
    await expect(run.getByRole("button", { name: "Открыть файл", exact: true })).toBeVisible();
    await summary.click();
    await expect(run.locator(".run-details")).toBeHidden();

    const sessions = await readdir(join(cwd, ".liquid/sessions"), { withFileTypes: true });
    const sessionId = sessions.find((entry) => entry.isDirectory())?.name;
    if (!sessionId) throw new Error("The completed fixture run did not create a session");
    await expect(page.locator(".main-head .state")).toHaveCount(0);
    await expect(page.locator(".main-head .crumbs")).toHaveCount(0);
    const calmBudget: AgentBudget = {
      limits: { tokens: 100_000, costUsd: 2 },
      spent: { tokens: 20_000, costUsd: 0.2, wallClockMs: 1000 },
      remaining: {},
    };
    await emit(app, [{ type: "budget", sessionId, budget: calmBudget }]);
    await expect(page.locator(".budget")).toHaveCount(0);
    const warningBudget = { ...calmBudget, spent: { ...calmBudget.spent, tokens: 85_000 } };
    await emit(app, [{ type: "budget", sessionId, budget: warningBudget }]);
    await expect(page.locator(".budget summary")).toHaveText("Лимит почти достигнут");
    await expect(page.locator(".budget-details")).toBeHidden();
    await page.locator(".budget summary").click();
    await expect(page.locator(".budget-details")).toBeVisible();
    await expect(page.locator(".budget .meter")).toHaveCount(1);
    await emit(app, [{ type: "budget", sessionId, budget: calmBudget }]);
    await expect(page.locator(".budget")).toHaveCount(0);
    const reasoning = Array.from(
      { length: 30 },
      (_, index) => `Рассуждение ${index + 1}: проверяю следующий участок проекта.`,
    ).join("\n\n");
    const calls: AgentEvent[] = Array.from({ length: 10 }, (_, index) => {
      const call = {
        id: `activity-${index}`,
        name: "read",
        args: { path: `src/file-${index}.ts` },
      };
      return [
        { type: "tool.started" as const, sessionId, call },
        {
          type: "tool.finished" as const,
          sessionId,
          call,
          result: { ok: true, output: `File ${index} contents`, durationMs: 10 },
        },
      ];
    }).flat();
    await emit(app, [
      {
        type: "session.started",
        sessionId,
        provider: "e2e",
        model: "e2e-model",
        prompt: "Проверь проект",
      },
      { type: "turn.started", sessionId, turn: 1 },
      { type: "reasoning.delta", sessionId, text: reasoning },
      ...calls,
    ]);

    const liveRun = page.locator(".run").last();
    const liveSummary = liveRun.locator("button.run-summary");
    await expect(liveSummary).toHaveAttribute("aria-expanded", "false");
    await expect(liveRun.locator(".run-preview button.action")).toHaveCount(1);
    await expect(liveRun.locator("button.action:visible")).toHaveCount(1);
    await expect(liveRun.locator(".run-details")).toBeHidden();
    expect((await liveRun.boundingBox())?.height).toBeLessThan(120);
    await liveSummary.click();
    const reasoningHead = liveRun.locator("button.reasoning-head");
    await expect(reasoningHead).toHaveAttribute("aria-expanded", "false");
    await expect(liveRun.locator(".reasoning-body")).toBeHidden();
    await reasoningHead.click();
    await expect(liveRun.locator(".reasoning-body")).toBeVisible();
    const viewport = liveRun.locator(".reasoning .viewport");
    expect((await viewport.boundingBox())?.height).toBeLessThanOrEqual(161);
    expect(await viewport.evaluate((node) => node.scrollHeight)).toBeGreaterThan(160);
    await emit(app, [
      {
        type: "message.finished",
        sessionId,
        text: "Проверка выполнена.",
        reasoning,
        toolCalls: [],
        summary: "<!doctype html><html><body><p>Проверено</p></body></html>",
      },
    ]);
    await expect(liveSummary).toHaveAttribute("aria-expanded", "true");
    await expect(liveRun.locator(".run-details")).toBeVisible();
    await liveSummary.click();
    await expect(liveRun.locator(".run-details")).toBeHidden();

    const failedCall = { id: "activity-failed", name: "bash", args: { command: "bun test" } };
    await emit(app, [
      { type: "tool.started", sessionId, call: failedCall },
      {
        type: "tool.finished",
        sessionId,
        call: failedCall,
        result: {
          ok: false,
          output: "",
          error: "Проверка не прошла: исправьте конфигурацию",
          durationMs: 20,
        },
      },
      {
        type: "session.finished",
        sessionId,
        result: {
          sessionId,
          pass: false,
          stopReason: "error",
          summary: "",
          turns: 1,
          usage: { input: 1, output: 1, cached: 0 },
        },
      },
    ]);
    await expect(liveSummary).toHaveAttribute("aria-expanded", "true");
    await expect(liveRun.locator(".error-text")).toBeVisible();
    await expect(liveRun.locator(".error-text")).toContainText("исправьте конфигурацию");
    expect(harness.consoleErrors).toEqual([]);
  } finally {
    await harness.close();
  }
});

test("settings navigation fades the section without moving its text", async () => {
  const harness = await launchApp();
  const { page } = harness;
  try {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(page.locator("#prompt")).toBeVisible();
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Настройки", exact: true });
    await expect(settings.locator(".main-scroll")).toBeVisible();
    // Inspect the real animation at its midpoint without racing its 140 ms lifetime.
    await settings.locator(".main-scroll").evaluate((node) => {
      const animate = node.animate.bind(node);
      node.animate = (keyframes, options) => {
        const animation = animate(keyframes, options);
        animation.pause();
        animation.currentTime = 70;
        return animation;
      };
    });
    await settings.getByRole("button", { name: "Разрешения", exact: true }).click();
    const motion = await settings.locator(".main-scroll").evaluate((node) => {
      const animation = node.getAnimations()[0];
      const effect = animation?.effect;
      if (!animation || !(effect instanceof KeyframeEffect)) return null;
      animation.pause();
      animation.currentTime = 70;
      const style = getComputedStyle(node);
      return {
        duration: effect.getTiming().duration,
        easing: effect.getTiming().easing,
        frames: effect.getKeyframes().map((frame) => Object.keys(frame)),
        transform: style.transform,
        scale: style.scale,
        opacity: Number(style.opacity),
      };
    });
    expect(motion).not.toBeNull();
    expect(motion?.duration).toBe(140);
    expect(motion?.easing).toBe("cubic-bezier(0.32, 0.72, 0, 1)");
    for (const frame of motion?.frames ?? []) {
      expect(frame).toContain("opacity");
      expect(frame).not.toContain("transform");
      expect(frame).not.toContain("scale");
    }
    expect(motion?.transform).toBe("none");
    expect(motion?.scale).toBe("none");
    expect(motion?.opacity).toBeGreaterThanOrEqual(0.45);
    expect(motion?.opacity).toBeLessThanOrEqual(1);
    expect(harness.consoleErrors).toEqual([]);
  } finally {
    await harness.close();
  }
});
