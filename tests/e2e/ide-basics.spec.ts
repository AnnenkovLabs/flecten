import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp } from "./fixtures";

test("IDE supports everyday file, search, command, split and terminal workflows", async () => {
  const h = await launchApp();
  const { page, app, cwd } = h;
  try {
    await mkdir(join(cwd, "src"));
    await writeFile(
      join(cwd, "src/main.ts"),
      "export const answer = 42;\nexport const greeting = 'hello';\n",
    );
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout;
    };
    git("init");
    git("add", "src/main.ts");
    git("-c", "user.name=IDE Test", "-c", "user.email=ide@example.test", "commit", "-m", "initial");
    await page.evaluate(() => {
      localStorage.setItem("flecten.locale", "ru");
    });
    await page.reload();
    await page.getByRole("button", { name: "IDE", exact: true }).click();
    await page.locator('.explorer .entry[title="src"]').click();
    await page.locator('.explorer .entry[title="src/main.ts"]').click();
    const editor = page.locator(".editor-columns .cm-content:visible").first();
    await expect(editor).toContainText("answer = 42");
    await page.keyboard.press("ControlOrMeta+g");
    const go = page.getByRole("dialog", { name: "Перейти к строке" });
    await go.locator("input").fill("2:8");
    await go.locator("input").press("Enter");
    await expect(go).toBeHidden();
    await expect(page.locator(".ide-status")).toContainText(/2.*8/);
    await page.keyboard.press("ControlOrMeta+Shift+p");
    const palette = page.getByRole("dialog", { name: "Палитра команд" });
    await palette.getByRole("combobox").fill("Переносить длинные строки");
    await page.keyboard.press("Enter");
    await expect(palette).toBeHidden();
    await expect(page.locator(".cm-editor").first()).toHaveClass(/cm-editor/);
    await expect
      .poll(() =>
        page.evaluate(() => JSON.parse(localStorage.getItem("flecten.ide.layout") ?? "{}").wrap),
      )
      .toBe(true);

    await page.keyboard.press("ControlOrMeta+n");
    const create = page.getByRole("dialog", { name: "Создать файл", exact: true });
    await create.getByLabel("Путь от корня проекта").fill("src/new.ts");
    await create.getByRole("button", { name: "Создать файл", exact: true }).click();
    await expect(page.getByRole("tab", { name: "new.ts", exact: true })).toBeVisible();
    await editor.click();
    await page.keyboard.insertText("export const local = 'edited';\n");
    await page.keyboard.press("ControlOrMeta+Shift+s");
    await expect.poll(() => readFile(join(cwd, "src/new.ts"), "utf8")).toContain("edited");
    await page.locator('.explorer .entry[title="src/new.ts"]').click({ button: "right" });
    await page.locator(".file-menu button").filter({ hasText: "Переименовать" }).click();
    const rename = page.getByRole("dialog", { name: "Переименовать", exact: true });
    await rename.locator("input").fill("src/renamed.ts");
    await rename.getByRole("button", { name: "Переименовать", exact: true }).click();
    await expect(rename).toBeHidden();
    await expect(page.getByRole("tab", { name: "renamed.ts", exact: true })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Tab");
    await expect(page.getByRole("tab", { name: "main.ts", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("ControlOrMeta+Shift+Tab");
    await expect(page.getByRole("tab", { name: "renamed.ts", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.keyboard.press("ControlOrMeta+Shift+f");
    await page.getByLabel("Найти в файлах", { exact: true }).fill("greeting");
    await page.getByLabel("Найти в файлах", { exact: true }).press("Enter");
    await expect(page.locator(".search-summary")).toContainText("Совпадений: 1");
    await page.locator(".search-results details button").click();
    await expect(editor).toContainText("answer = 42");
    await expect(page.locator(".ide-status")).toContainText(/Стр.*2/);
    await page.getByText("Заменить в проекте", { exact: true }).click();
    await page.getByLabel("Заменить на", { exact: true }).fill("salutation");
    await page.getByRole("button", { name: "Предпросмотр замены", exact: true }).click();
    const replacement = page.getByRole("dialog", { name: "Предпросмотр замены" });
    await expect(replacement).toContainText("src/main.ts");
    await replacement.locator("button.apply").click();
    await expect(replacement).toBeHidden();
    await expect(editor).toContainText("salutation");
    await page.getByRole("tab", { name: "Контроль версий", exact: true }).click();
    await page.locator('.source-control .open-diff[title="src/main.ts"]').click();
    await expect(page.locator(".git-diff")).toContainText("+export const salutation");
    await page.getByRole("button", { name: "Добавить в коммит src/main.ts", exact: true }).click();
    await expect.poll(() => git("diff", "--cached", "--name-only")).toBe("src/main.ts\n");
    await page.getByRole("button", { name: "Убрать из коммита src/main.ts", exact: true }).click();
    await expect.poll(() => git("diff", "--cached", "--name-only")).toBe("");
    await page.getByRole("button", { name: "Открыть файл", exact: true }).click();
    await page.getByRole("button", { name: "Разделить редактор", exact: true }).click();
    await expect(page.locator(".editor-columns .cm-content:visible")).toHaveCount(2);
    await page.getByRole("tab", { name: "renamed.ts", exact: true }).click();
    await expect(page.locator(".editor-columns .cm-content:visible").nth(0)).toContainText(
      "edited",
    );
    await expect(page.locator(".editor-columns .cm-content:visible").nth(1)).toContainText(
      "salutation",
    );
    await page.locator(".editor-columns .cm-content:visible").nth(1).click();
    await page.keyboard.press("ControlOrMeta+g");
    await go.locator("input").fill("2:4");
    await go.locator("input").press("Enter");
    await expect(page.locator(".ide-status")).toContainText(/2.*4/);
    await expect(page.locator(".editor-columns .cm-content:visible").nth(0)).toContainText(
      "edited",
    );
    await page.getByRole("button", { name: "Закрыть разделённую панель", exact: true }).click();
    await page.keyboard.press("ControlOrMeta+w");
    await expect(page.getByRole("tab", { name: "renamed.ts", exact: true })).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+t");
    await expect(page.getByRole("tab", { name: "renamed.ts", exact: true })).toBeVisible();

    const separator = page.getByRole("separator", { name: "Ширина проводника" });
    const before = Number(await separator.getAttribute("aria-valuenow"));
    await separator.focus();
    await page.keyboard.press("ArrowRight");
    await expect(separator).toHaveAttribute("aria-valuenow", String(before + 16));
    await page.keyboard.press("ControlOrMeta+Backquote");
    const terminal = page.locator(".terminal-host .xterm-helper-textarea");
    await terminal.focus();
    await page.keyboard.type("printf 'IDE_UI_TERMINAL_OK\\n'");
    await page.keyboard.press("Enter");
    await expect(page.locator(".terminal-host")).toContainText("IDE_UI_TERMINAL_OK");
    await page.getByRole("button", { name: "Скрыть терминал", exact: true }).click();

    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]?.setContentSize(size[0], size[1]),
        [width, height] as const,
      );
      await page.setViewportSize({ width, height });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: test.info().outputPath(`ide-basics-${width}x${height}.png`) });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) win.destroy();
      })
      .catch(() => undefined);
    await h.close();
  }
});
