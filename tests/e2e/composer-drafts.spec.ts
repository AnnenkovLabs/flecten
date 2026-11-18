import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type AppHarness, environmentProblem, launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

const REPLY = "Draft test completed.";

async function expectDraft(page: Page, text: string): Promise<void> {
  await expect(page.locator("#prompt")).toBeVisible();
  // toHaveText normalizes whitespace; recovery must preserve the actual source text.
  await expect.poll(() => page.locator("#prompt").textContent()).toBe(text);
}

async function fillDraft(page: Page, text: string): Promise<void> {
  const prompt = page.locator("#prompt");
  await prompt.fill("");
  if (text)
    await prompt.evaluate((element, value) => {
      const data = new DataTransfer();
      data.setData("text/plain", value);
      element.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);
  await expectDraft(page, text);
}

async function newTask(page: Page): Promise<void> {
  await page.locator(".sidebar").getByRole("button", { name: "New task", exact: true }).click();
}

async function send(page: Page, text: string): Promise<void> {
  await fillDraft(page, text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".thread").first()).toContainText(REPLY);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
  await expectDraft(page, "");
}

async function chooseFolder(h: AppHarness, directory: string): Promise<void> {
  await h.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, directory);
  await h.page.locator(".ns-picker-trigger").click();
  await h.page.getByRole("button", { name: "Select folder", exact: true }).click();
  const trust = h.page.getByRole("dialog", { name: "Do you trust this folder?" });
  await expect(trust).toContainText(directory);
  await trust.getByRole("button", { name: "Trust folder", exact: true }).click();
  await expect(trust).toHaveCount(0);
  await expect(h.page.locator(".ns-picker-name")).toHaveText(basename(directory));
}

async function screenshots(h: AppHarness): Promise<void> {
  for (const size of [
    { width: 1480, height: 940 },
    { width: 1180, height: 640 },
  ]) {
    await h.app.evaluate(({ BrowserWindow }, dimensions) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setMinimumSize(0, 0);
      window?.setContentSize(dimensions.width, dimensions.height);
    }, size);
    await h.page.setViewportSize(size);
    expect(
      await h.page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await hiddenScreenshot(
      h,
      test.info().outputPath(`composer-draft-${size.width}x${size.height}.png`),
    );
  }
}

test("new-task and chat drafts retain exact text through navigation, reload and sending", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({ locale: "en", firstCalls: [], reply: REPLY });
  try {
    const { page } = h;
    const initial = "  Начало без отправки\n\nsecond line\t  ";
    await expectDraft(page, "");
    await fillDraft(page, initial);
    await page.reload();
    await expectDraft(page, initial);

    await send(page, "First draft chat");
    await fillDraft(page, "  Первый черновик\n\nwith spaces  ");
    await newTask(page);
    await expectDraft(page, "");
    await send(page, "Second draft chat");
    const second = "Второй черновик\nline two\n";
    await fillDraft(page, second);
    await newTask(page);
    const pending = " \n\t\n  ";
    await fillDraft(page, pending);

    await page.locator(".sidebar .task-row").filter({ hasText: "First draft chat" }).click();
    await expectDraft(page, "  Первый черновик\n\nwith spaces  ");
    await page.locator(".sidebar .task-row").filter({ hasText: "Second draft chat" }).click();
    await expectDraft(page, second);
    await page.reload();
    await expectDraft(page, second);
    await screenshots(h);
    await newTask(page);
    await expectDraft(page, pending);

    await page.locator(".sidebar .task-row").filter({ hasText: "Second draft chat" }).click();
    await expectDraft(page, second);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
    await expectDraft(page, "");
    await page.reload();
    await expectDraft(page, "");
    await newTask(page);
    await expectDraft(page, pending);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});

test("new-task drafts belong to their project, including work without a project", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const directory = await mkdtemp(join(tmpdir(), "flecten-draft-projects-"));
  const first = join(directory, "first-project");
  const second = join(directory, "second-project");
  await Promise.all([first, second].map((path) => mkdir(path)));
  const h = await launchApp({
    locale: "en",
    projectless: true,
    appProfile: true,
    firstCalls: [],
    reply: REPLY,
  });
  try {
    const { page } = h;
    await expectDraft(page, "");
    const noProject = "Без проекта\n  отдельный текст  ";
    await fillDraft(page, noProject);
    await chooseFolder(h, first);
    await expectDraft(page, "");
    const firstDraft = "Первый проект\n\nне отправлено";
    await fillDraft(page, firstDraft);
    await chooseFolder(h, second);
    await expectDraft(page, "");
    const secondDraft = "Second project\n  separate draft  ";
    await fillDraft(page, secondDraft);
    const sidebar = page.getByRole("complementary", { name: "Projects and tasks", exact: true });
    async function startInProject(path: string): Promise<void> {
      const name = basename(path);
      const folder = sidebar.getByRole("group", { name, exact: true });
      await folder.hover();
      await folder.getByRole("button", { name: `New task in ${name}`, exact: true }).click();
    }
    await startInProject(first);
    await expectDraft(page, firstDraft);
    await page.locator(".ns-picker-trigger").click();
    await page.getByRole("button", { name: "Without a project", exact: true }).click();
    await expectDraft(page, noProject);
    await page.reload();
    await expectDraft(page, noProject);
    await startInProject(second);
    await expectDraft(page, secondDraft);
    await page.reload();
    await expectDraft(page, secondDraft);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("saved text survives a renderer crash and immediate close with the same desktop profile", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const directory = await mkdtemp(join(tmpdir(), "flecten-draft-restart-"));
  const cwd = join(directory, "workspace");
  const userData = join(directory, "profile");
  await mkdir(cwd);
  const options = {
    cwd,
    userData,
    locale: "en" as const,
    projectless: true,
    appProfile: true,
    firstCalls: [],
    reply: REPLY,
  };
  let h: AppHarness | undefined;
  try {
    h = await launchApp(options);
    await expectDraft(h.page, "");
    const beforeCrash = "Сохранить при краше\n\n  verbatim  ";
    await fillDraft(h.page, beforeCrash);
    await expect
      .poll(() =>
        h?.page.evaluate(
          (text) =>
            Object.values(localStorage).some((value) => value.includes(JSON.stringify(text))),
          beforeCrash,
        ),
      )
      .toBe(true);
    const crashed = h.page.waitForEvent("crash");
    await h.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer(),
    );
    await crashed;
    await h.close();
    h = undefined;
    h = await launchApp(options);
    await expectDraft(h.page, beforeCrash);

    const beforeClose = "Самый последний ввод перед закрытием\n  без ожидания таймера  ";
    await fillDraft(h.page, beforeClose);
    await h.close();
    h = undefined;
    h = await launchApp(options);
    await expectDraft(h.page, beforeClose);
    await fillDraft(h.page, "");
    await h.page.reload();
    await expectDraft(h.page, "");
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
