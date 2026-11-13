import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { AgentEvent, AgentToolCall } from "../../ui/src/lib/types";
import { launchApp } from "./fixtures";

test("tools explain their purpose and subagents show tasks and readable reports", async () => {
  const harness = await launchApp({
    reply: "Готово.",
    models: {
      "e2e-model": {
        name: "E2E Mock",
        context: 131072,
        output: 4096,
        tools: true,
        reasoning: false,
      },
    },
  });
  const { app, page, cwd } = harness;
  const out = join(process.cwd(), ".liquid/tool-ux");
  await mkdir(out, { recursive: true });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(1480, 940),
    );
    await page.setViewportSize({ width: 1480, height: 940 });
    await page.locator("#prompt").fill("Сделай работу инструментов понятной");
    await page.locator("#prompt").press("Enter");
    await expect(page.locator(".run-check")).toBeVisible();
    for (const dismiss of await page.locator(".toast-dismiss").all()) await dismiss.click();
    const entries = await readdir(join(cwd, ".liquid/sessions"), { withFileTypes: true });
    const sessionId = entries.find((entry) => entry.isDirectory())?.name;
    if (!sessionId) throw new Error("No fixture session");
    const emit = async (events: AgentEvent[]) =>
      app.evaluate(({ BrowserWindow }, payload) => {
        const contents = BrowserWindow.getAllWindows()[0]?.webContents;
        for (const event of payload) contents?.send("agent:event", event);
      }, events);
    const call: AgentToolCall = {
      id: "ux-researcher",
      name: "task",
      args: {
        agent: "explore",
        prompt:
          "Найди, почему субагент отображается как task. Проверь поток событий и предложи исправление.",
      },
    };
    const web: AgentToolCall = {
      id: "ux-web",
      name: "web_search",
      args: { query: "Svelte 5 accessible disclosure patterns" },
    };
    await emit([
      {
        type: "session.started",
        sessionId,
        provider: "e2e",
        model: "e2e-model",
        prompt: "Проверь инструменты",
      },
      { type: "turn.started", sessionId, turn: 1 },
      { type: "message.finished", sessionId, text: "", reasoning: "", toolCalls: [call, web] },
      { type: "tool.started", sessionId, call },
      { type: "tool.started", sessionId, call: web },
      {
        type: "tool.finished",
        sessionId,
        call: web,
        result: {
          ok: true,
          output: "Найдены примеры доступных раскрываемых блоков.",
          durationMs: 320,
        },
      },
    ]);
    const run = page.locator(".run").last();
    const subagent = run
      .locator("button.action:visible")
      .filter({ hasText: "Субагент: Исследователь" });
    await expect(subagent).toBeVisible();
    await expect(subagent).toContainText("Выполняется");
    await expect(run.locator(".run-preview .action")).toHaveCount(2);
    await subagent.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, "running-1480.png") });
    await run.locator(".run-summary").click();
    await subagent.focus();
    await subagent.press("Enter");
    await expect(run.getByText("Порученное задание", { exact: true })).toBeVisible();
    await run.locator(".delegation > details summary").first().click();
    await expect(run.locator(".delegation")).toContainText("Здесь появится его отчёт");
    await expect(run.locator(".technical .code").first()).toBeHidden();
    const resultData = {
      kind: "subagent",
      agent: "explore",
      data: {
        summary: "Причина найдена: общий обработчик показывал внутреннее имя инструмента.",
        findings: ["Вызову task нужна карточка субагента с ролью, заданием и результатом."],
        files: ["ui/src/lib/agent.ts"],
        openQuestions: [],
      },
    };
    await emit([
      {
        type: "tool.finished",
        sessionId,
        call,
        result: {
          ok: true,
          output: JSON.stringify(resultData.data),
          data: resultData,
          durationMs: 2400,
        },
      },
    ]);
    await expect(run.locator(".delegation")).toContainText("Причина найдена");
    await expect(subagent).toContainText("Готово");
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]?.setContentSize(size[0] ?? 0, size[1] ?? 0),
        [width, height],
      );
      await page.setViewportSize({ width, height });
      await subagent.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(out, `after-${width}.png`) });
      if (width === 1180) {
        await run
          .locator(".delegation")
          .getByText("ui/src/lib/agent.ts", { exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(out, "report-1180.png") });
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const button = await subagent.boundingBox();
      expect(button && button.x + button.width <= width).toBe(true);
    }
    await run.locator(".technical summary").first().click();
    await expect(run.locator(".technical .code").first()).toBeVisible();
    const failed: AgentToolCall = {
      id: "ux-failed",
      name: "task",
      args: { agent: "review", prompt: "Проверь изменения" },
    };
    await emit([
      { type: "tool.started", sessionId, call: failed },
      {
        type: "tool.finished",
        sessionId,
        call: failed,
        result: {
          ok: false,
          output: "",
          error: "Сервис недоступен. Проверьте подключение и повторите запрос.",
        },
      },
    ]);
    await expect(run.locator(".error-text")).toBeVisible();
    await expect(run.locator(".is-failed .action-state")).toHaveText("Ошибка");
    await page.screenshot({ path: join(out, "failed-1180.png") });
    expect(harness.consoleErrors).toEqual([]);
  } finally {
    await harness.close();
  }
});
