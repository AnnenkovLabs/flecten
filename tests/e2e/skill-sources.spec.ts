import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";

test("skill sources can be selected, saved and discarded at both window sizes", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp();
  try {
    const { page } = h;
    for (const [directory, name] of [
      [".claude", "claude-example"],
      [".agents", "agents-example"],
    ] as const) {
      const path = join(h.cwd, directory, "skills", name);
      await mkdir(path, { recursive: true });
      await writeFile(
        join(path, "SKILL.md"),
        `---\nname: ${name}\ndescription: Example helper\n---\nHelp.\n`,
      );
    }
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await page.getByRole("button", { name: "Навыки", exact: true }).click();
    const section = page.locator('section[aria-labelledby="settings-skills"]');
    const sources = section.locator(".st-group").getByRole("checkbox");
    const loadedSkill = (name: string) =>
      section.locator(".st-details > summary").filter({ hasText: name });
    await expect(sources).toHaveCount(6);
    for (const checkbox of await sources.all()) await checkbox.uncheck();
    await expect(section.getByText("Все источники отключены.", { exact: false })).toBeVisible();
    await section.getByRole("checkbox", { name: "~/.agents/skills", exact: true }).check();
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
    const saved = JSON.parse(await readFile(join(h.cwd, "flecten.config.json"), "utf8"));
    expect(saved.skills.sources).toEqual(["user-agents"]);
    await expect(loadedSkill("claude-example")).toHaveCount(0);
    await expect(loadedSkill("agents-example")).toHaveCount(0);

    await section.getByRole("checkbox", { name: ".agents/skills", exact: true }).check();
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(loadedSkill("agents-example")).toBeVisible();
    await expect(loadedSkill("claude-example")).toHaveCount(0);

    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await h.app.evaluate(
        ({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0]?.setContentSize(size[0], size[1]);
        },
        [width, height] as const,
      );
      await page.setViewportSize({ width, height });
      await section.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.liquid/skills-preview/after-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const save = page.getByRole("button", { name: "Сохранить", exact: true });
      await expect(save).toBeVisible();
      for (const checkbox of await sources.all()) {
        await checkbox.scrollIntoViewIfNeeded();
        const box = await checkbox.locator("..").boundingBox();
        if (!box) throw new Error("Source checkbox has no visible bounds");
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    const claude = section.getByRole("checkbox", { name: ".claude/skills", exact: true });
    await claude.focus();
    await page.keyboard.press("Space");
    await expect(claude).toBeChecked();
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.getByRole("button", { name: "Не сохранять", exact: true }).click();
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await page.getByRole("button", { name: "Навыки", exact: true }).click();
    await expect(claude).not.toBeChecked();
    await expect(
      section.getByRole("checkbox", { name: "~/.agents/skills", exact: true }),
    ).toBeChecked();
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
