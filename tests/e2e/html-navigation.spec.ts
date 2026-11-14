import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { SummaryHtmlStream } from "../../ui/src/lib/markdown/summary-tokenizer";
import { environmentProblem, launchApp, README_MARKER } from "./fixtures";

test("model HTML opens real harness menus, panels and files through buttons and links", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const example = await readFile(
    new URL("../../examples/html-outputs/harness-navigation.html", import.meta.url),
    "utf8",
  );
  const harness = await launchApp({
    reply: `<summary>${example}</summary>`,
    models: { "e2e-model": { name: "HTML model", context: 128000, output: 8192, tools: true } },
  });
  try {
    const { page } = harness;
    await page
      .locator("#prompt")
      .fill("Объясни, где подключить инструменты и посмотреть результат");
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    const frame = page.frameLocator("iframe.summary");
    await expect(frame.getByRole("heading", { name: "Подключение инструментов" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Остановка", exact: true })).toBeHidden();

    // An action forged by a different source cannot control the summary's host.
    await page.evaluate(() =>
      window.postMessage(
        {
          type: "liquid-summary",
          version: 1,
          kind: "action",
          action: "navigate",
          payload: "flecten://settings/mcp",
        },
        "*",
      ),
    );
    await expect(page.locator("dialog.settings-dialog")).toHaveCount(0);
    await frame.locator("#summary-root").evaluate(() => {
      for (const payload of ["flecten://run?command=echo", "flecten://settings/unknown"]) {
        parent.postMessage(
          { type: "liquid-summary", version: 1, kind: "action", action: "navigate", payload },
          "*",
        );
      }
    });
    await expect(page.locator("#tab-thread")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("dialog.settings-dialog")).toHaveCount(0);

    await frame.getByRole("link", { name: "Проверить права" }).focus();
    await frame.getByRole("link", { name: "Проверить права" }).press("Enter");
    await expect(page.locator('.section-nav [aria-current="true"]')).toHaveText("Разрешения");
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.settings-dialog")).toHaveCount(0);

    await frame.getByRole("link", { name: "Открыть README.md" }).click();
    await expect(page.locator("dialog.viewer pre.code")).toContainText(README_MARKER);
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.viewer")).toHaveCount(0);

    await frame.getByRole("link", { name: "выбрать модель" }).click();
    await expect(page.getByRole("combobox", { name: "Поиск модели или провайдера" })).toBeVisible();
    await page.keyboard.press("Escape");
    await frame.getByRole("button", { name: "Копировать путь" }).click();
    expect(await harness.app.evaluate(({ clipboard }) => clipboard.readText())).toBe("README.md");
    await page.getByRole("button", { name: "Скрыть уведомление" }).click();

    for (const [name, panel] of [
      ["Открыть изменения", "changes"],
      ["История изменений", "history"],
      ["Терминал", "terminal"],
    ] as const) {
      await frame.getByRole("link", { name, exact: true }).click();
      await expect(page.locator(`#tab-${panel}`)).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(`#pane-${panel}`)).toBeVisible();
      await page.locator("#tab-thread").click();
    }

    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ]) {
      await harness.app.evaluate(
        ({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0]?.setContentSize(size[0] ?? 0, size[1] ?? 0);
        },
        [width ?? 0, height ?? 0],
      );
      await page.setViewportSize({ width: width ?? 0, height: height ?? 0 });
      await frame
        .getByRole("heading", { name: "Подключение инструментов" })
        .scrollIntoViewIfNeeded();
      expect(
        await frame
          .locator("#summary-root")
          .evaluate(
            (element) =>
              element.ownerDocument.documentElement.scrollWidth <=
              element.ownerDocument.documentElement.clientWidth,
          ),
      ).toBe(true);
      await page.screenshot({
        path: `.liquid/html-navigation/${width}x${height}.png`,
        animations: "disabled",
      });
      await frame.getByRole("button", { name: "Настроить MCP" }).click();
      await expect(page.locator('.section-nav [aria-current="true"]')).toHaveText("MCP");
      await page.screenshot({
        path: `.liquid/html-navigation/mcp-${width}x${height}.png`,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
    }

    // Streamed scripts stay inert until completion and execute only once.
    const tokens = new SummaryHtmlStream().push(
      "<script>globalThis.streamingRuns = (globalThis.streamingRuns ?? 0) + 1;</script>",
    );
    await page.locator("iframe.summary").evaluate((element, tokens) => {
      for (const message of [{ kind: "reset" }, { kind: "append", tokens }]) {
        (element as HTMLIFrameElement).contentWindow?.postMessage(
          { type: "liquid-summary", version: 1, ...message },
          "*",
        );
      }
    }, tokens);
    const script = frame.locator("#summary-root script");
    await expect(script).toHaveAttribute("type", "application/x-liquid-pending");
    const runs = () =>
      script.evaluate(
        () => (globalThis as unknown as { streamingRuns?: number }).streamingRuns ?? 0,
      );
    expect(await runs()).toBe(0);
    await page.locator("iframe.summary").evaluate((element) => {
      const target = (element as HTMLIFrameElement).contentWindow;
      const finish = { type: "liquid-summary", version: 1, kind: "finish" };
      target?.postMessage(finish, "*");
      target?.postMessage(finish, "*");
    });
    await expect.poll(runs).toBe(1);
    expect(harness.consoleErrors, harness.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await harness.close();
  }
});
