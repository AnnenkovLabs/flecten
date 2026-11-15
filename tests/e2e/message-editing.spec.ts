import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { Event } from "../../src/core/types";
import type { ModelInfo } from "../../ui/src/lib/types";
import { type AppHarness, environmentProblem, launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

const FIRST = "First instruction: keep this message unchanged.";
const SECOND = "Second instruction: use the original direction.";
const THIRD = "Third instruction: this belongs to the original continuation.";
const REVISED = "  Revised middle instruction.\nKeep the exact spaces and line break.  ";
const FOLLOW_UP = "Follow-up instruction: this belongs to the revised continuation.";
const NESTED = "Nested revision: continue this direction instead.";
const DRAFT = "Unsent follow-up draft must survive editing history.";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const REPLACEMENT_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const MODELS: Record<string, ModelInfo> = {
  "e2e-model": {
    name: "Initial model",
    context: 200_000,
    output: 4096,
    tools: true,
    vision: true,
    reasoning: true,
    reasoningLevels: ["low", "medium", "high"],
  },
  "revision-model": {
    name: "Revision model",
    context: 200_000,
    output: 4096,
    tools: true,
    vision: true,
    reasoning: true,
    reasoningLevels: ["low", "medium", "high"],
  },
};
const SIZES = [
  { width: 1480, height: 940 },
  { width: 1180, height: 640 },
] as const;

function message(page: Page, text: string): Locator {
  return page.locator(".msg.user").filter({ has: page.locator(".bubble", { hasText: text }) });
}

async function messages(page: Page, expected: string[]): Promise<void> {
  const bubbles = page.locator(".thread .msg.user .bubble");
  await expect(bubbles).toHaveText(expected);
  expect(await bubbles.evaluateAll((nodes) => nodes.map((node) => node.textContent))).toEqual(
    expected,
  );
}

async function settled(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Edit message", exact: true }).last(),
  ).toBeEnabled();
}

async function send(page: Page, text: string): Promise<void> {
  await page.locator("#prompt").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await settled(page);
}

async function noOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth > innerWidth,
      vertical: document.documentElement.scrollHeight > innerHeight,
    })),
  ).toEqual({ horizontal: false, vertical: false });
}

async function savedEvents(h: AppHarness): Promise<Event[]> {
  const entries = await readdir(join(h.cwd, ".liquid/sessions"), { withFileTypes: true });
  const session = entries.find((entry) => entry.isDirectory());
  if (!session) throw new Error("No saved conversation");
  const text = await readFile(
    join(h.cwd, ".liquid/sessions", session.name, "events.jsonl"),
    "utf8",
  );
  return text
    .trim()
    .split("\n")
    .map((line) => (JSON.parse(line) as { event: Event }).event);
}

async function selectRevisionModel(page: Page): Promise<void> {
  await expect(page.locator(".model-button")).toBeEnabled();
  await page.locator(".model-button").click();
  const picker = page.getByRole("dialog", { name: "Select model", exact: true });
  await picker.getByRole("combobox").fill("Revision model");
  await picker.getByRole("option").filter({ hasText: "Revision model" }).click();
  await expect(page.locator(".model-button")).toContainText("Revision model");
  const effort = page.getByRole("button", { name: /^Model reasoning level:/ });
  await expect(effort).toBeEnabled();
  await effort.click();
  await page
    .getByRole("listbox", { name: "Model reasoning level", exact: true })
    .getByRole("option", { name: "high", exact: true })
    .click();
  await expect(effort).toContainText("high");
}

async function pasteImage(h: AppHarness, png = PNG): Promise<void> {
  await h.app.evaluate(async ({ clipboard, ClipboardItem }, bytes) => {
    await clipboard.write([
      new ClipboardItem({
        "image/png": new Blob([Buffer.from(bytes, "base64")], { type: "image/png" }),
      }),
    ]);
  }, png);
  await h.page.locator("#prompt").press("ControlOrMeta+v");
  await expect(h.page.locator('#prompt [data-kind="image"]')).toHaveCount(1);
}

async function pasteText(h: AppHarness, text: string): Promise<void> {
  await h.page.locator("#prompt").fill("");
  await h.app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);
  await h.page.locator("#prompt").press("ControlOrMeta+v");
  await expect.poll(() => promptSource(h.page)).toBe(text);
}

async function attachFile(h: AppHarness, name: string): Promise<void> {
  await h.app.evaluate(
    ({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    },
    join(h.cwd, name),
  );
  await h.page.getByRole("button", { name: "Attach files", exact: true }).click();
  await expect(h.page.getByRole("list", { name: "Attachments", exact: true })).toContainText(name);
}

async function promptSource(page: Page): Promise<string> {
  return page.locator("#prompt").evaluate((editor) => {
    const paragraph = editor.querySelector("p");
    if (!paragraph) throw new Error("The composer paragraph is missing");
    return Array.from(paragraph.childNodes)
      .map((node) =>
        node instanceof HTMLElement && node.hasAttribute("data-mention")
          ? `@${node.dataset.path}`
          : (node.textContent ?? ""),
      )
      .join("");
  });
}

async function screenshots(h: AppHarness, state: string): Promise<void> {
  for (const size of SIZES) {
    await h.app.evaluate(({ BrowserWindow }, dimensions) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(dimensions.width, dimensions.height);
    }, size);
    await h.page.setViewportSize(size);
    if (process.env.FLECTEN_E2E_PRIVATE_DISPLAY === "1")
      await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.showInactive());
    await h.page.evaluate(() => document.fonts.ready.then(() => true));
    await noOverflow(h.page);
    if (state === "editor") {
      await expect(h.page.locator("#prompt")).toBeInViewport();
      await expect(h.page.locator("#prompt")).toHaveAttribute("contenteditable", "true");
      await expect(h.page.locator(".composer-edit-header")).toContainText("Editing message");
      await expect(h.page.locator("textarea")).toHaveCount(0);
      expect(
        await h.page
          .locator(".composer.is-editing")
          .evaluate((node) => getComputedStyle(node).boxShadow),
      ).not.toBe("none");
      await expect(
        h.page.getByRole("button", { name: "Save & send", exact: true }),
      ).toBeInViewport();
    }
    await hiddenScreenshot(h, test.info().outputPath(`${state}-${size.width}x${size.height}.png`));
  }
  if (process.env.FLECTEN_E2E_PRIVATE_DISPLAY === "1")
    await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.showInactive());
}

test("editing a past message preserves switchable continuations and nested revisions after reload", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({
    locale: "en",
    models: MODELS,
    reply: "A short completed answer.\n<summary><p>Ready to continue.</p></summary>",
  });
  const { page } = h;
  try {
    await h.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.restore();
      if (process.env.FLECTEN_E2E_PRIVATE_DISPLAY === "1") window?.showInactive();
      else window?.hide();
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("#prompt")).toBeVisible();
    await send(page, FIRST);
    await send(page, SECOND);
    await send(page, THIRD);
    await messages(page, [FIRST, SECOND, THIRD]);
    await screenshots(h, "before-edit");

    await page.locator("#prompt").fill(DRAFT);
    await message(page, SECOND).getByRole("button", { name: "Edit message", exact: true }).click();
    const editor = page.locator("#prompt");
    const save = page.getByRole("button", { name: "Save & send", exact: true });
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText(SECOND);
    await expect(page.locator(".composer-edit-header")).toContainText("Editing message");
    await expect(page.locator("textarea")).toHaveCount(0);
    await editor.fill("   ");
    await expect(save).toBeDisabled();
    await editor.fill("Discard this draft.");
    await editor.press("Escape");
    await expect(page.locator(".composer-edit-header")).toHaveCount(0);
    await expect(editor).toHaveText(DRAFT);
    await messages(page, [FIRST, SECOND, THIRD]);

    await message(page, SECOND).getByRole("button", { name: "Edit message", exact: true }).click();
    await editor.fill("Discard through Cancel too.");
    await page
      .locator(".composer-edit-header")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(page.locator(".composer-edit-header")).toHaveCount(0);
    await expect(editor).toHaveText(DRAFT);
    await message(page, SECOND).getByRole("button", { name: "Edit message", exact: true }).click();
    await pasteText(h, REVISED);
    await selectRevisionModel(page);
    await expect(page.getByRole("button", { name: "Attach files", exact: true })).toBeEnabled();
    await screenshots(h, "editor");
    await save.click();
    await expect(page.locator(".composer-edit-header")).toHaveCount(0);
    await settled(page);
    await expect(editor).toHaveText(DRAFT);
    await messages(page, [FIRST, REVISED]);
    await expect
      .poll(async () =>
        (await savedEvents(h)).findLast(
          (event) => event.type === "session.started" && event.prompt === REVISED,
        ),
      )
      .toMatchObject({ model: "revision-model", reasoning: "high" });
    const middle = message(page, REVISED);
    await expect(middle.locator(".version-count")).toHaveText("2/2");
    await expect(middle.getByRole("button", { name: "Next version", exact: true })).toBeDisabled();
    await screenshots(h, "revised-branch");

    await send(page, FOLLOW_UP);
    await messages(page, [FIRST, REVISED, FOLLOW_UP]);
    await middle.getByRole("button", { name: "Previous version", exact: true }).click();
    await messages(page, [FIRST, SECOND, THIRD]);
    const original = message(page, SECOND);
    await expect(original.locator(".version-count")).toHaveText("1/2");
    await expect(
      original.getByRole("button", { name: "Previous version", exact: true }),
    ).toBeDisabled();
    await screenshots(h, "original-branch");
    await original.getByRole("button", { name: "Next version", exact: true }).click();
    await messages(page, [FIRST, REVISED, FOLLOW_UP]);

    await message(page, FOLLOW_UP)
      .getByRole("button", { name: "Edit message", exact: true })
      .click();
    await editor.fill(NESTED);
    await editor.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    await expect(page.locator(".composer-edit-header")).toHaveCount(0);
    await settled(page);
    await messages(page, [FIRST, REVISED, NESTED]);
    await expect(message(page, NESTED).locator(".version-count")).toHaveText("2/2");

    await middle.getByRole("button", { name: "Previous version", exact: true }).click();
    await messages(page, [FIRST, SECOND, THIRD]);
    await original.getByRole("button", { name: "Next version", exact: true }).click();
    await messages(page, [FIRST, REVISED, NESTED]);

    await page.reload();
    const task = page.locator("button.task-row").filter({ hasText: FIRST });
    await expect(task).toBeVisible();
    await task.click();
    await messages(page, [FIRST, REVISED, NESTED]);
    await settled(page);
    await expect(middle.locator(".version-count")).toHaveText("2/2");
    await expect(message(page, NESTED).locator(".version-count")).toHaveText("2/2");
    await message(page, NESTED)
      .getByRole("button", { name: "Previous version", exact: true })
      .click();
    await messages(page, [FIRST, REVISED, FOLLOW_UP]);
    await message(page, FOLLOW_UP)
      .getByRole("button", { name: "Next version", exact: true })
      .click();
    await messages(page, [FIRST, REVISED, NESTED]);
    await noOverflow(page);
    expect(h.consoleErrors, h.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await h.close();
  }
});

test("main composer edits can remove saved attachments and replace them with files and a pasted screenshot", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({ locale: "en", models: MODELS });
  const { page } = h;
  try {
    await h.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.restore();
      if (process.env.FLECTEN_E2E_PRIVATE_DISPLAY === "1") window?.showInactive();
      else window?.hide();
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const prompt = page.locator("#prompt");
    await expect(prompt).toBeVisible();
    await writeFile(join(h.cwd, "original-notes.txt"), "original-edit-attachment-content");
    await writeFile(join(h.cwd, "replacement-notes.txt"), "replacement-edit-attachment-content");
    await writeFile(join(h.cwd, "unsent-notes.txt"), "unsent-draft-attachment-content");
    await prompt.fill("Inspect the original attachments ");
    await attachFile(h, "original-notes.txt");
    await prompt.press("End");
    await pasteImage(h);
    const originalText = await promptSource(page);
    if (!originalText) throw new Error("The original attachment message is empty");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await settled(page);
    const originalEvent = (await savedEvents(h)).findLast(
      (event) => event.type === "session.started" && event.prompt === originalText,
    );
    if (originalEvent?.type !== "session.started")
      throw new Error("The original attachment message was not saved");
    await prompt.fill(DRAFT);
    await attachFile(h, "unsent-notes.txt");
    await message(page, originalText)
      .getByRole("button", { name: "Edit message", exact: true })
      .click();
    const list = page.getByRole("list", { name: "Attachments", exact: true });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list).toContainText("original-notes.txt");
    await expect(list).not.toContainText("unsent-notes.txt");
    await expect(
      page.getByRole("button", { name: "Remove original-notes.txt", exact: true }),
    ).toBeEnabled();
    await page
      .locator(".composer-edit-header")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(prompt).toHaveText(DRAFT);
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list).toContainText("unsent-notes.txt");

    await message(page, originalText)
      .getByRole("button", { name: "Edit message", exact: true })
      .click();
    await list.getByRole("button").first().click();
    await list.getByRole("button").first().click();
    await expect(list).toHaveCount(0);
    await prompt.fill("Inspect the replacement attachments ");
    await attachFile(h, "replacement-notes.txt");
    await prompt.press("End");
    await pasteImage(h, REPLACEMENT_PNG);
    await selectRevisionModel(page);
    const revisedText = await promptSource(page);
    if (!revisedText) throw new Error("The replacement attachment message is empty");
    await screenshots(h, "editor");
    await page.getByRole("button", { name: "Save & send", exact: true }).click();
    await expect(page.locator(".composer-edit-header")).toHaveCount(0);
    await settled(page);
    await messages(page, [revisedText]);
    await expect(prompt).toHaveText(DRAFT);
    await expect(list).toContainText("unsent-notes.txt");
    await expect
      .poll(async () =>
        (await savedEvents(h)).findLast(
          (event) => event.type === "session.started" && event.prompt === revisedText,
        ),
      )
      .toMatchObject({ model: "revision-model", reasoning: "high" });
    const saved = (await savedEvents(h)).findLast(
      (event) => event.type === "session.started" && event.prompt === revisedText,
    );
    if (saved?.type !== "session.started")
      throw new Error("The revised attachment message was not saved");
    expect(saved.attachmentSnapshot?.media).toHaveLength(1);
    expect(saved.attachmentSnapshot?.media[0]?.id).not.toBe(
      originalEvent.attachmentSnapshot?.media[0]?.id,
    );
    const blocks = saved.attachmentSnapshot?.blocks.join("\n");
    expect(blocks).toContain("replacement-edit-attachment-content");
    expect(blocks).not.toContain("original-edit-attachment-content");
    expect(blocks).not.toContain("unsent-draft-attachment-content");
    await message(page, revisedText)
      .getByRole("button", { name: "Edit message", exact: true })
      .click();
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list).toContainText("replacement-notes.txt");
    await expect(list).not.toContainText("original-notes.txt");
    await prompt.press("Escape");
    await expect(prompt).toHaveText(DRAFT);
    await message(page, revisedText)
      .getByRole("button", { name: "Previous version", exact: true })
      .click();
    await messages(page, [originalText]);
    await message(page, originalText)
      .getByRole("button", { name: "Edit message", exact: true })
      .click();
    await expect(list).toContainText("original-notes.txt");
    await expect(list).not.toContainText("replacement-notes.txt");
    await screenshots(h, "original-editor");
    await noOverflow(page);
    expect(h.consoleErrors, h.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await h.close();
  }
});
