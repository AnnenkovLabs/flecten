import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { type ElectronApplication, launchApp, type Page } from "./fixtures";

const SOURCE = "export const answer: number = 42;\n";
const EDITED = "export const answer: number = 43;\n";
const EXTERNAL = "export const answer: number = 99;\n";
const AGENT_FILE = `export interface GreetingOptions {
  name: string;
  language: "en" | "ru";
}

const messages = {
  en: "Hello from the agent",
  ru: "Привет от агента",
} satisfies Record<GreetingOptions["language"], string>;

export function greet(options: GreetingOptions): string {
  const message = messages[options.language];
  return message + ", " + options.name;
}

export function greetings(names: string[]): string[] {
  return names.map((name) => greet({ name, language: "en" }));
}

export const preview = greetings(["Alex", "Sam"]);
`;

async function resize(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size: number[]) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size[0] ?? 0, size[1] ?? 0);
    },
    [width, height],
  );
  await page.setViewportSize({ width, height });
}

async function replaceEditor(page: Page, text: string): Promise<void> {
  await page.locator(".ide .cm-content:visible").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

async function checkGeometry(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const main = document.querySelector(".ide-main")?.getBoundingClientRect();
    const island = document.querySelector(".agent-island")?.getBoundingClientRect();
    const editor = document.querySelector(".editor-surface")?.getBoundingClientRect();
    const left = document.querySelector(".ide-changes");
    const panel = left?.checkVisibility() ? left.getBoundingClientRect() : null;
    const agent = document.querySelector(".agent-sidebar")?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      verticalOverflow: document.documentElement.scrollHeight - window.innerHeight,
      main: main && { left: main.left, right: main.right, width: main.width },
      island: island && { left: island.left, right: island.right, bottom: island.bottom },
      editor: editor && { left: editor.left, right: editor.right, width: editor.width },
      panel: panel && { left: panel.left, right: panel.right, width: panel.width },
      agent: agent && { left: agent.left, right: agent.right, width: agent.width },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.verticalOverflow).toBeLessThanOrEqual(1);
  expect(geometry.main?.width).toBeGreaterThan(400);
  expect(geometry.editor?.width).toBeGreaterThan(400);
  expect(geometry.island?.left).toBeGreaterThanOrEqual(geometry.main?.left ?? 0);
  expect(geometry.island?.right).toBeLessThanOrEqual((geometry.main?.right ?? 0) + 1);
  expect(geometry.island?.bottom).toBeLessThanOrEqual(geometry.viewport.height);
  if (geometry.panel) {
    expect(geometry.panel.width).toBeGreaterThanOrEqual(180);
    expect(geometry.panel.right).toBeLessThanOrEqual(geometry.viewport.width + 1);
    expect(geometry.panel.right).toBeLessThanOrEqual((geometry.editor?.left ?? 0) + 1);
  }
  if (geometry.agent) {
    expect(geometry.agent.width).toBeGreaterThanOrEqual(300);
    expect(geometry.agent.right).toBeLessThanOrEqual(geometry.viewport.width + 1);
    expect(geometry.agent.left).toBeGreaterThanOrEqual((geometry.editor?.right ?? 0) - 1);
  }
}

async function checkModeMotion(page: Page): Promise<void> {
  const motion = await page.evaluate(() => {
    const pill = document.querySelector(".mode-switch .pill");
    const editor = document.querySelector(".editor-surface");
    const positionProperties = [
      "transform",
      "translate",
      "scale",
      "left",
      "top",
      "height",
      "width",
    ];
    const positional =
      editor?.getAnimations({ subtree: true }).filter((animation) => {
        if (!(animation.effect instanceof KeyframeEffect)) return false;
        return animation.effect
          .getKeyframes()
          .some((frame) => positionProperties.some((property) => property in frame));
      }).length ?? 0;
    return {
      transition: pill ? getComputedStyle(pill).transitionDuration : "0s",
      properties: pill ? getComputedStyle(pill).transitionProperty : "none",
      positional,
    };
  });
  expect(motion.transition.split(",").some((duration) => Number.parseFloat(duration) > 0)).toBe(
    true,
  );
  expect(motion.properties).toContain("transform");
  expect(motion.positional).toBe(0);
}

test("IDE edits real files safely, preserves work between modes and reviews agent changes", async () => {
  // The fixture passes this to its local provider; the agent executes a real write tool.
  const previousCalls = process.env.E2E_MOCK_CALLS;
  process.env.E2E_MOCK_CALLS = JSON.stringify([
    { name: "write", arguments: { path: "src/agent-created.ts", content: AGENT_FILE } },
  ]);
  let harness: Awaited<ReturnType<typeof launchApp>>;
  try {
    harness = await launchApp({ reply: "<summary>Создан src/agent-created.ts.</summary>" });
  } finally {
    if (previousCalls === undefined) delete process.env.E2E_MOCK_CALLS;
    else process.env.E2E_MOCK_CALLS = previousCalls;
  }
  const { app, page, cwd } = harness;
  const sourcePath = join(cwd, "src/main.ts");
  try {
    await page.evaluate(() => localStorage.setItem("flecten.locale", "ru"));
    await page.reload();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(sourcePath, SOURCE);
    await resize(app, page, 1480, 940);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const modes = page.getByRole("group", { name: "Режим работы" });
    const agentMode = modes.getByRole("button", { name: "Агент", exact: true });
    const ideMode = modes.getByRole("button", { name: "IDE", exact: true });
    const agentPrompt = page.locator(".thread-surface #prompt");
    const draft = "Черновик останется при переходе в IDE";
    await expect(agentMode).toHaveAttribute("aria-pressed", "true");
    await agentPrompt.fill(draft);
    await ideMode.click();
    await expect(ideMode).toHaveAttribute("aria-pressed", "true");
    const agentSidebar = page.getByRole("complementary", { name: "Агент", exact: true });
    await expect(agentSidebar).toBeVisible();
    await expect(page.getByRole("tab", { name: "Файлы", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("complementary", { name: "Файлы проекта" })).toBeVisible();
    await page.locator('.explorer .entry[title="src"]').click();
    await page.locator('.explorer .entry[title="src/main.ts"]').click();
    const editor = page.locator(".ide .cm-content:visible");
    await expect(editor).toHaveText(SOURCE.trim());
    await replaceEditor(page, EDITED);
    await expect(page.locator(".editor-tabs .dirty")).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(() => readFile(sourcePath, "utf8")).toBe(EDITED);
    await expect(page.locator(".editor-tabs .dirty")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editor).toHaveText(SOURCE.trim());
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(editor).toHaveText(EDITED.trim());

    await page.keyboard.press("ControlOrMeta+p");
    const quickOpen = page.getByRole("dialog", { name: "Открыть файл", exact: true });
    await expect(quickOpen).toBeVisible();
    await quickOpen.getByRole("combobox", { name: "Имя файла" }).fill("README.md");
    await page.keyboard.press("Enter");
    await expect(quickOpen).toBeHidden();
    await expect(page.getByRole("tab", { name: "README.md", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "main.ts", exact: true }).click();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editor).toHaveText(SOURCE.trim());
    await page.getByRole("button", { name: "Закрыть src/main.ts", exact: true }).click();
    const discard = page.getByRole("dialog", { name: "Сохранить изменения?", exact: true });
    await expect(discard).toBeVisible();
    await expect(discard.getByRole("button", { name: "Отмена", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(discard).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Закрыть src/main.ts", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Закрыть src/main.ts", exact: true }).click();
    await discard.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(editor).toHaveText(SOURCE.trim());
    await page.getByRole("button", { name: "Закрыть src/main.ts", exact: true }).click();
    await discard.getByRole("button", { name: "Не сохранять", exact: true }).click();
    await expect(page.getByRole("tab", { name: "main.ts", exact: true })).toHaveCount(0);
    expect(await readFile(sourcePath, "utf8")).toBe(EDITED);

    await page.locator('.explorer .entry[title="src/main.ts"]').click();
    await expect(editor).toHaveText(EDITED.trim());
    await replaceEditor(page, "export const answer: number = 77;\n");
    await writeFile(sourcePath, EXTERNAL);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.locator(".document-view [role=alert]")).toBeVisible();
    expect(await readFile(sourcePath, "utf8")).toBe(EXTERNAL);
    await expect(editor).toHaveText("export const answer: number = 77;");
    await page.getByRole("button", { name: "Загрузить с диска заново", exact: true }).click();
    await discard.getByRole("button", { name: "Не сохранять", exact: true }).click();
    await expect(editor).toHaveText(EXTERNAL.trim());

    await agentMode.click();
    await expect(agentPrompt).toHaveText(draft);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await ideMode.click();
    await checkModeMotion(page);
    await expect(editor).toHaveText(EXTERNAL.trim());
    await expect(agentSidebar).toBeVisible();
    await page.getByRole("button", { name: "Скрыть агента", exact: true }).click();
    await expect(agentSidebar).toBeHidden();
    await page.locator(".island-toggle").click();
    await expect(agentSidebar).toBeVisible();
    const sidebarPrompt = page.locator(".agent-sidebar #prompt");
    await expect(sidebarPrompt).toHaveText(draft);
    await sidebarPrompt.fill("Создай src/agent-created.ts с приветствием");
    await sidebarPrompt.press("Enter");
    await expect
      .poll(() => readFile(join(cwd, "src/agent-created.ts"), "utf8").catch(() => ""))
      .toBe(AGENT_FILE);
    await expect(page.getByRole("button", { name: "Остановить агента", exact: true })).toBeHidden();
    await page.getByRole("tab", { name: "Изменения агента", exact: true }).click();
    const changes = page.getByRole("complementary", { name: "Изменения агента" });
    await expect(changes).toBeVisible();
    await changes.locator('button[title="src/agent-created.ts"]').click();
    await expect(
      page.getByRole("region", { name: "Изменения в файле", exact: true }),
    ).toContainText("Hello from the agent");
    await checkGeometry(page);
    await page.screenshot({ path: test.info().outputPath("ide-changes-1480x940.png") });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(ideMode).toHaveAttribute("aria-pressed", "true");
    expect(
      await page
        .locator(".mode-switch .pill")
        .evaluate((pill) => getComputedStyle(pill).transitionProperty),
    ).not.toContain("transform");
    await resize(app, page, 1180, 640);
    await checkGeometry(page);
    await page.screenshot({ path: test.info().outputPath("ide-changes-1180x640.png") });
    await page.getByRole("button", { name: "Редактировать файл", exact: true }).click();
    await expect(editor).toContainText("export interface GreetingOptions");
    await expect(editor).toContainText("Hello from the agent");
    await checkGeometry(page);
    await page.screenshot({ path: test.info().outputPath("ide-editor-1180x640.png") });
    await resize(app, page, 1480, 940);
    await page.screenshot({ path: test.info().outputPath("ide-editor-1480x940.png") });
    await page.getByRole("button", { name: "Скрыть изменения", exact: true }).click();
    await expect(changes).toBeHidden();
    await expect(page.getByRole("tab", { name: "Файлы", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await checkGeometry(page);
    expect(harness.consoleErrors).toEqual([]);
  } finally {
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      })
      .catch(() => undefined);
    await harness.close();
  }
});
