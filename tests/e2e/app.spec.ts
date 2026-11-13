import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp, README_MARKER } from "./fixtures";

const PROMPT = "Прочитай README.md и покажи краткий итог.";

function skipIfUnavailable(): void {
  const problem = environmentProblem();
  if (!problem) return;
  console.warn(`[e2e] skipped: ${problem}`);
  test.skip(true, problem);
}

async function expectSummaryFrame(page: Page): Promise<void> {
  const frame = page.locator("iframe.summary").last();
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("src", /^liquid-summary:\/\//);
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(frame).toHaveAttribute("title");
  expect(await frame.getAttribute("srcdoc")).toBeNull();
}

test("opens the new session screen, runs a tool and renders the HTML summary", async () => {
  skipIfUnavailable();
  const harness = await launchApp();

  try {
    const { page } = harness;

    await expect(page.locator('section[aria-label="Новая сессия"]')).toBeVisible();
    await page.locator("#prompt").fill(PROMPT);
    await page.getByRole("button", { name: "Отправить", exact: true }).click();

    const runSummary = page.locator("button.run-summary").first();
    await expect(runSummary).toBeVisible();

    await expectSummaryFrame(page);
    await expect(
      page.frameLocator("iframe.summary").getByRole("heading", { name: "README прочитан" }),
    ).toBeVisible();
    const summaryFrame = page.frameLocator("iframe.summary");
    await expect(summaryFrame.getByText("JS работает")).toBeVisible();
    await summaryFrame.getByRole("tab", { name: "Второй" }).click();
    await expect(summaryFrame.getByText("Второй раздел")).toBeVisible();
    await expect(summaryFrame.getByText("Первый раздел")).toBeHidden();
    await expect(page.locator(".thread-inner")).not.toContainText("<summary>");

    await expect(page.getByRole("button", { name: "Остановить" })).toBeHidden({ timeout: 45_000 });
    await expect(page.locator(".run-details").first()).toHaveAttribute("hidden", "");

    const toolRow = page.locator("button.action").filter({ hasText: "Прочитал README.md" });
    for (let attempt = 0; attempt < 3 && !(await toolRow.isVisible()); attempt += 1) {
      await runSummary.click();
      await page.waitForTimeout(300);
    }
    await expect(toolRow).toBeVisible();
    await toolRow.click();
    await expect(toolRow).toHaveAttribute("aria-expanded", "true");

    const output = page
      .locator(".detail-section")
      .filter({ hasText: "Вывод" })
      .locator("pre.code")
      .first();
    await expect(output).toContainText(README_MARKER);

    // The card opens the file it read in the built-in viewer; Escape closes it.
    await page.getByRole("button", { name: "Открыть файл" }).first().click();
    const viewer = page.locator("dialog.viewer");
    await expect(viewer.locator("pre.code")).toContainText(README_MARKER);
    await expect(viewer.locator("h2")).toHaveText("README.md");
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();

    // The taskbar and the window switcher name the open task.
    await expect(page).toHaveTitle(`${PROMPT} · Flecten`);
    const osTitle = await harness.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getTitle(),
    );
    expect(osTitle).toBe(`${PROMPT} · Flecten`);

    expect(harness.consoleErrors, harness.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await harness.close();
  }
});

test("shows a skeleton while the summary html is streaming", async () => {
  skipIfUnavailable();
  const harness = await launchApp({ chunkMs: 20, holdSummary: true });

  try {
    const { page } = harness;

    await expect(page.locator('section[aria-label="Новая сессия"]')).toBeVisible();
    await page.locator("#prompt").fill(PROMPT);
    await page.getByRole("button", { name: "Отправить", exact: true }).click();

    const skeleton = page.getByRole("status", { name: "Сводка собирается" });
    await expect(skeleton).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".thread-inner")).not.toContainText("<summary>");

    await harness.releaseSummary();
    const frame = page.frameLocator("iframe.summary");
    await expect(page.locator("iframe.summary")).toBeVisible({ timeout: 20_000 });
    await expect(skeleton).toBeHidden();
    await expect(frame.getByRole("heading", { name: "README прочитан" })).toBeVisible();
    await expect(page.locator(".thread-inner")).not.toContainText("<summary>");

    expect(harness.consoleErrors, harness.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await harness.close();
  }
});

test("queues a message during a run and finishes it", async () => {
  skipIfUnavailable();
  const harness = await launchApp({ delayMs: 4000 });

  try {
    const { page } = harness;

    await expect(page.locator('section[aria-label="Новая сессия"]')).toBeVisible();
    await page.locator("#prompt").fill(PROMPT);
    await page.getByRole("button", { name: "Отправить", exact: true }).click();

    await expect(page.getByRole("button", { name: "Остановить" })).toBeVisible();
    await page.locator("#prompt").fill("Добавь в очередь ещё один шаг");
    await page.getByRole("button", { name: "В очередь", exact: true }).click();

    const queueTray = page.locator('section[aria-label="Очередь сообщений"]');
    await expect(queueTray).toBeVisible();
    await expect(queueTray).toContainText("Добавь в очередь ещё один шаг");

    await expect(queueTray).toBeHidden({ timeout: 45_000 });
    await expect(page.getByRole("button", { name: "Остановить" })).toBeHidden({ timeout: 45_000 });
    await expect(page.locator(".live-run")).toBeHidden();
    await expect(page.locator("button.run-summary").first()).toBeVisible();
    await expectSummaryFrame(page);
    await expect(page.locator("iframe.summary")).toHaveCount(2);
    await expect(
      page.locator(".msg.user .bubble").filter({ hasText: "Добавь в очередь ещё один шаг" }),
    ).toHaveCount(1);

    expect(harness.consoleErrors, harness.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await harness.close();
  }
});

const CODE_AND_DIAGRAM = [
  "Вот пример и схема.",
  "",
  "```ts",
  "export const sum = (a: number, b: number): number => a + b;",
  "```",
  "",
  "```mermaid",
  "graph TD",
  "  A[Запрос] --> B{Есть кеш?}",
  "  B -- да --> C[Ответ из кеша]",
  "  B -- нет --> D[Провайдер]",
  "```",
].join("\n");

test("labels and copies code fences and draws mermaid diagrams with their text", async () => {
  skipIfUnavailable();
  const harness = await launchApp({ reply: CODE_AND_DIAGRAM });

  try {
    const { page } = harness;
    await page.locator("#prompt").fill("Покажи код и схему");
    await page.getByRole("button", { name: "Отправить", exact: true }).click();

    const diagram = page.locator(".mermaid-diagram svg");
    await expect(diagram).toBeVisible({ timeout: 30_000 });
    // Labels survive sanitizing: without them the diagram is a set of empty boxes.
    for (const label of ["Запрос", "Есть кеш?", "Ответ из кеша", "Провайдер", "да", "нет"]) {
      await expect(diagram).toContainText(label);
    }
    await expect(page.locator(".mermaid-canvas")).toHaveAttribute(
      "aria-label",
      "Диаграмма Mermaid, исходник ниже",
    );
    const block = page
      .locator(".code-block")
      .filter({ has: page.locator(".code-lang", { hasText: "ts" }) });
    const copy = block.locator("button.code-copy");
    await expect(copy).toHaveAccessibleName("Копировать код: ts");
    await copy.click();
    // Code blocks share the same 1.4 s copy feedback as other surfaces.
    await expect(copy).toHaveAccessibleName("Код скопирован");
    await expect(copy).toHaveClass(/is-copied/);
    expect(await harness.app.evaluate(({ clipboard }) => clipboard.readText())).toContain(
      "export const sum",
    );

    expect(harness.consoleErrors, harness.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await harness.close();
  }
});
