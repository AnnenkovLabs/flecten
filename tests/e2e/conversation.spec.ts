import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";

test("every Worker call appears in the conversation and Worker tab, progress is Markdown, and only the final summary is HTML", async () => {
  test.skip(Boolean(environmentProblem()), environmentProblem());
  const h = await launchApp({ conversation: null });
  try {
    const { page } = h;
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    const conversation = dialog.getByRole("checkbox", {
      name: "Отделить общение от выполнения",
      includeHidden: true,
    });
    await expect(conversation).toBeChecked();
    await expect(conversation).toBeHidden();
    await dialog.locator("summary").filter({ hasText: "Дополнительные параметры" }).click();
    await expect(conversation).toBeVisible();
    await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.locator("#prompt").fill("Проверь проект, сохрани API");
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    const workerTab = page.getByRole("tab", { name: /^Действия Worker/ });
    const conversationTab = page.getByRole("tab", { name: "Диалог", exact: true });
    const activity = page
      .locator("#pane-worker")
      .getByRole("region", { name: "Действия Worker", includeHidden: true });
    await expect(page.locator(".thread .tool-mirror")).toHaveCount(4);
    const intro = page.locator(".answer").filter({ hasText: "Сначала проверю документацию." });
    const progress = page
      .locator(".answer")
      .filter({ hasText: "Документация прочитана. Теперь сверю реализацию." });
    await expect(intro).toHaveCount(1);
    await expect(progress).toHaveCount(1);
    const order = () =>
      page.locator(".thread-item").evaluateAll((nodes) =>
        nodes.flatMap((node) => {
          const answer = node.querySelector(".answer");
          if (answer) {
            return [
              Array.from(answer.querySelectorAll(".markdown"), (part) =>
                part.textContent?.trim(),
              ).join("\n"),
            ];
          }
          const tool = node.querySelector(".tool-mirror button.action");
          return tool ? [tool.textContent?.trim() ?? ""] : [];
        }),
      );
    const initialOrder = await order();
    const position = (part: string) => initialOrder.findIndex((text) => text.includes(part));
    expect(position("Сначала проверю")).toBeLessThan(position("README.md"));
    expect(position("*.md")).toBeLessThan(position("Документация прочитана"));
    expect(position("Документация прочитана")).toBeLessThan(position("WORKER_STREAM_BEGIN"));
    const gap = await page
      .locator(".thread .tool-mirror .action-line")
      .evaluateAll(
        (nodes) =>
          (nodes[1]?.getBoundingClientRect().top ?? 0) -
          (nodes[0]?.getBoundingClientRect().bottom ?? 0),
      );
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(4);
    await expect(workerTab).toBeVisible();
    await expect(activity).toBeHidden();
    await expect(page.locator(".thread .worker-activity")).toHaveCount(0);
    const actions = page.getByRole("group", { name: "Действия агента" });
    await expect(actions.getByRole("button")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Отправить", exact: true })).toHaveCount(0);
    await expect(page.locator(".summary-frame")).toHaveCount(0);
    await expect(page.locator(".answer-actions")).toHaveCount(0);
    await expect(page.locator(".answer-foot")).toHaveCount(0);
    await expect(intro).toHaveCount(1);
    await expect(progress).toHaveCount(1);
    await page.locator("#prompt").fill("Ты можешь отвечать, пока идёт проверка?");
    await expect(actions.getByRole("button")).toHaveCount(3);
    await actions.getByRole("button", { name: "Уточнить сейчас", exact: true }).click();
    await expect(page.locator(".answer").last()).toContainText("Можем общаться во время работы.");
    await expect(actions.getByRole("button")).toHaveCount(1);
    await expect(page.locator(".summary-frame")).toHaveCount(0);
    await expect(page.locator(".answer-actions")).toHaveCount(0);
    await expect(page.locator(".answer-foot")).toHaveCount(0);
    const mirror = page.locator(".thread .tool-mirror").filter({ hasText: "WORKER_STREAM_BEGIN" });
    await expect(mirror).toBeVisible();
    await mirror.locator("button.action").click();
    await expect(mirror.locator(".detail")).toContainText("WORKER_LIVE_OUTPUT");
    await expect(mirror.locator(".action-cancel")).toBeEnabled();
    const reference = await mirror.getAttribute("data-tool-reference");
    await workerTab.click();
    await expect(activity).toBeVisible();
    await expect(activity.locator("button.action")).toHaveCount(4);
    await expect(
      activity.getByRole("button", { name: "Остановить Worker", exact: true }),
    ).toBeVisible();
    const source = activity.locator(".action-item").filter({ hasText: "WORKER_STREAM_BEGIN" });
    await source.locator("button.action").click();
    await expect(source.locator(".detail")).toContainText("WORKER_LIVE_OUTPUT");
    await conversationTab.click();
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await h.app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height),
        { width, height },
      );
      await page.setViewportSize({ width, height });
      await mirror.scrollIntoViewIfNeeded();
      expect(
        await page
          .locator(".thread")
          .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      await mirror.locator("button.action").click();
      await progress.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: test.info().outputPath(`conversation-${width}.png`),
        animations: "disabled",
      });
      await mirror.locator("button.action").click();
      await workerTab.click();
      await expect(source.locator(".detail")).toBeVisible();
      expect(
        await page
          .locator("#pane-worker")
          .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: test.info().outputPath(`worker-${width}.png`),
        animations: "disabled",
      });
      if (width === 1480) {
        await page.locator(".split-button").click();
        await expect(mirror).toBeVisible();
        await expect(activity).toBeVisible();
        await page.locator(".split-button").click();
      }
      await conversationTab.click();
    }
    await writeFile(join(h.cwd, "worker-release"), "go");
    await expect(
      activity.getByRole("button", { name: "Остановить Worker", exact: true }),
    ).toHaveCount(0);
    await expect(mirror.locator(".detail")).toContainText("WORKER_STREAM_END");
    await expect(mirror.locator(".action-cancel")).toBeDisabled();
    await page.getByRole("button", { name: "Вниз, к последнему сообщению", exact: true }).click();
    await expect(page.locator(".summary-frame")).toHaveCount(1);
    await expect(page.locator(".thread .tool-mirror")).toHaveCount(5);
    const workerId = (await readdir(join(h.cwd, ".liquid/sessions"))).find((id) =>
      id.endsWith("_worker"),
    );
    expect(workerId).toBeDefined();
    if (!workerId) throw new Error("Worker session archive was not created");
    const pages = join(h.cwd, ".liquid/sessions", workerId, "pages");
    expect(await readFile(join(pages, "1.md"), "utf8")).toContain(
      "Preserve the requested public API",
    );
    expect(await readFile(join(pages, "1.transcript.md"), "utf8")).toContain("WORKER_STREAM_END");
    const summaryAnswer = page.locator(".answer").filter({ has: page.locator(".summary-frame") });
    await expect(page.locator(".answer-actions")).toHaveCount(1);
    await expect(page.locator(".answer-foot")).toHaveCount(1);
    await expect(summaryAnswer.locator(".answer-time")).toBeVisible();
    await expect(
      summaryAnswer.getByRole("button", { name: "Скопировать ответ", exact: true }),
    ).toBeVisible();
    await expect(
      summaryAnswer.getByRole("button", { name: "Повторить", exact: true }),
    ).toBeVisible();
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await h.app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height),
        { width, height },
      );
      await page.setViewportSize({ width, height });
      await summaryAnswer.locator(".answer-actions").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: test.info().outputPath(`summary-actions-${width}.png`),
        animations: "disabled",
      });
    }
    await expect(intro).toHaveCount(1);
    await expect(progress).toHaveCount(1);
    const completedOrder = await order();
    await page.reload();
    // Reopen the stored task from the sidebar if the reloaded idle window is on the start screen.
    const task = page
      .locator("button.task-row")
      .filter({ hasText: "Проверь проект, сохрани API" })
      .first();
    await expect(task).toBeVisible();
    await task.click();
    await expect(page.locator(`[data-tool-reference="${reference}"]`).first()).toBeVisible();
    await expect(page.locator(".thread .tool-mirror")).toHaveCount(5);
    await expect(page.locator(".summary-frame")).toHaveCount(1);
    await expect(page.locator(".answer-actions")).toHaveCount(1);
    await expect(page.locator(".answer-foot")).toHaveCount(1);
    expect(await order()).toEqual(completedOrder);
    await expect(
      page
        .locator(".msg.user .bubble")
        .filter({ hasText: "Ты можешь отвечать, пока идёт проверка?" }),
    ).toHaveCount(1);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
