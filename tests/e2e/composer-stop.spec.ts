import { expect, type Page, test } from "@playwright/test";
import { launchApp } from "./fixtures";

const models = {
  "e2e-model": {
    name: "E2E Mock",
    context: 200_000,
    output: 4096,
    tools: true,
    reasoning: false,
  },
};

async function aligned(page: Page) {
  const boxes = await page.locator(".composer:visible").evaluate((composer) => {
    const rect = (selector: string) => {
      const element = selector === ".composer" ? composer : composer.querySelector(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      composer: rect(".composer"),
      prompt: rect("#prompt"),
      bar: rect(".composer-bar"),
      actions: rect(".composer-actions"),
      voice: rect(".voice"),
    };
  });
  expect(boxes.bar.x - boxes.composer.x).toBe(12);
  expect(boxes.composer.x + boxes.composer.width - boxes.actions.x - boxes.actions.width).toBe(12);
  expect(boxes.voice.y).toBe(boxes.actions.y);
  expect(boxes.actions.y + boxes.actions.height).toBeLessThanOrEqual(
    boxes.composer.y + boxes.composer.height - 12,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  return boxes;
}

test("composer shares send and stop, splits drafts and supports graceful then force stop", async () => {
  const h = await launchApp({ holdSummary: true, models });
  const { page, app } = h;
  try {
    const prompt = page.locator("#prompt");
    await prompt.fill("Проверь README.md");
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(page.getByRole("status", { name: "Готовим сводку" })).toBeVisible();
    const actions = page.getByRole("group", { name: "Действия агента" });
    await expect(actions.getByRole("button")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Отправить", exact: true })).toHaveCount(0);
    await expect(page.locator(".composer-stop-slot")).toHaveCount(0);
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, [w, h]) => {
          BrowserWindow.getAllWindows()[0]?.setContentSize(w ?? 0, h ?? 0);
        },
        [width, height],
      );
      await page.setViewportSize({ width, height });
      await prompt.fill("");
      const empty = await aligned(page);
      await page.screenshot({ path: `.liquid/composer-review/stop-empty-${width}.png` });
      await prompt.fill("Следующая инструкция агенту");
      await expect(actions.getByRole("button")).toHaveCount(3);
      const draft = await aligned(page);
      expect(draft.prompt).toEqual(empty.prompt);
      expect(draft.bar).toEqual(empty.bar);
      const buttons = await actions.getByRole("button").evaluateAll((elements) =>
        elements.map((element) => {
          const { x, width } = element.getBoundingClientRect();
          return { x, width };
        }),
      );
      expect(buttons[1]?.x).toBe((buttons[0]?.x ?? 0) + (buttons[0]?.width ?? 0));
      expect(buttons[2]?.x).toBe((buttons[1]?.x ?? 0) + (buttons[1]?.width ?? 0));
      await page.screenshot({ path: `.liquid/composer-review/stop-draft-${width}.png` });
    }
    await actions.getByRole("button", { name: "Добавить в очередь", exact: true }).click();
    await expect(prompt).toHaveText("");
    await expect(page.getByRole("region", { name: "Очередь сообщений" })).toContainText(
      "Следующая инструкция агенту",
    );
    await prompt.fill("Новая корректировка");
    await actions.getByRole("button", { name: "Уточнить сейчас", exact: true }).click();
    await expect(page.getByRole("region", { name: "Очередь сообщений" })).toContainText(
      "Новая корректировка",
    );
    await actions.getByRole("button", { name: "Остановка", exact: true }).click();
    const force = actions.getByRole("button", { name: "Остановить принудительно", exact: true });
    await expect(force).toBeEnabled();
    await expect(force).toHaveClass(/is-stopping/);
    await expect(page.getByRole("status", { name: "Готовим сводку" })).toBeVisible();
    await prompt.fill("Черновик сохраняется при остановке");
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, [w, h]) => {
          BrowserWindow.getAllWindows()[0]?.setContentSize(w ?? 0, h ?? 0);
        },
        [width, height],
      );
      await page.setViewportSize({ width, height });
      await force.hover();
      await force.focus();
      await aligned(page);
      await page.screenshot({ path: `.liquid/composer-review/stop-requested-${width}.png` });
    }
    await page.reload();
    await expect(force).toBeEnabled();
    await prompt.fill("Черновик сохраняется при остановке");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await force.click();
    await expect(actions).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeEnabled();
    await expect(prompt).toHaveText("Черновик сохраняется при остановке");
    await page.screenshot({ path: ".liquid/composer-review/stopped-1180.png" });
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});

test("graceful stop completes the held model response without draining queue", async () => {
  const h = await launchApp({ holdSummary: true, models });
  try {
    const prompt = h.page.locator("#prompt");
    await prompt.fill("Проверь README.md");
    await prompt.press("Enter");
    await expect(h.page.getByRole("status", { name: "Готовим сводку" })).toBeVisible();
    await prompt.fill("Оставь на потом");
    await h.page.getByRole("button", { name: "Добавить в очередь", exact: true }).click();
    await h.page.getByRole("button", { name: "Остановка", exact: true }).click();
    await expect(
      h.page.getByRole("button", { name: "Остановить принудительно", exact: true }),
    ).toBeEnabled();
    await h.releaseSummary();
    await expect(h.page.getByRole("group", { name: "Действия агента" })).toHaveCount(0);
    await expect(h.page.locator("iframe.summary")).toBeVisible();
    await expect(h.page.getByRole("region", { name: "Очередь сообщений" })).toContainText(
      "Оставь на потом",
    );
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});

test("three-part composer stays available with an idle Talker and a running Worker", async () => {
  const h = await launchApp({ conversation: true });
  try {
    const { page, app } = h;
    const prompt = page.locator("#prompt:visible");
    await prompt.fill("Проверь проект, сохрани API");
    await prompt.press("Enter");
    await expect(page.locator(".thread .tool-mirror")).toHaveCount(4);
    await expect(page.locator(".answer").last()).toContainText("Можем общаться во время работы.");
    const actions = page.getByRole("group", { name: "Действия агента" });
    await expect(actions.getByRole("button")).toHaveCount(1);
    await prompt.fill("Черновик для работающего агента");
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
        },
        { width, height },
      );
      await page.setViewportSize({ width, height });
      await expect(actions.getByRole("button")).toHaveCount(3);
      for (const name of ["Остановка", "Добавить в очередь", "Уточнить сейчас"]) {
        await expect(actions.getByRole("button", { name, exact: true })).toBeEnabled();
      }
      await aligned(page);
      await page.screenshot({ path: test.info().outputPath(`worker-actions-${width}.png`) });
      await page.getByRole("button", { name: "IDE", exact: true }).click();
      await expect(page.locator("#ide-agent")).toBeVisible();
      await expect(actions.getByRole("button")).toHaveCount(3);
      await expect(prompt).toHaveText("Черновик для работающего агента");
      await page.screenshot({ path: test.info().outputPath(`ide-worker-actions-${width}.png`) });
      await page
        .locator(".mode-switch")
        .getByRole("button", { name: "Агент", exact: true })
        .click();
    }
    await actions.getByRole("button", { name: "Остановка", exact: true }).click();
    const force = actions.getByRole("button", { name: "Остановить принудительно", exact: true });
    await expect(force).toBeEnabled();
    await expect(force).toHaveClass(/is-stopping/);
    await force.click();
    await expect(actions).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeEnabled();
    await expect(prompt).toHaveText("Черновик для работающего агента");
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
