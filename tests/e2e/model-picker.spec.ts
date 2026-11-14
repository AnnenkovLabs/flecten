import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { type AppHarness, launchApp } from "./fixtures";

test("provider disclosure persists across restarts, search reveals matches and model capabilities", async () => {
  const directory = mkdtempSync(join(tmpdir(), "flecten-model-picker-"));
  const cwd = join(directory, "project");
  const userData = join(directory, "profile");
  mkdirSync(cwd);
  writeFileSync(
    join(cwd, "flecten.config.json"),
    JSON.stringify({
      useDefaults: false,
      provider: "primary",
      model: "reasoner",
      providers: {
        primary: {
          name: "Основной провайдер",
          protocol: "openai-chat",
          baseUrl: "http://127.0.0.1:1/v1",
          models: {
            reasoner: {
              name: "Reasoner",
              context: 200000,
              reasoning: true,
              vision: true,
              tools: true,
            },
            media: { name: "Media", context: 1000000, audio: true, pdf: true, tools: true },
            ...Object.fromEntries(
              Array.from({ length: 10 }, (_, index) => [
                `model-${index}`,
                { name: `Модель с длинным названием ${index}`, tools: true },
              ]),
            ),
          },
        },
        secondary: {
          name: "Второй провайдер",
          protocol: "openai-chat",
          baseUrl: "http://127.0.0.1:1/v1",
          models: { alternate: { name: "Alternate", context: 32000, tools: true } },
        },
      },
      catalog: { autoRefresh: false },
    }),
  );
  let harness: AppHarness | undefined;
  try {
    harness = await launchApp({ cwd, userData });
    const { app, page } = harness;
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await app.evaluate(({ app: electronApp }) => electronApp.getPath("userData"))).toBe(
      userData,
    );
    await expect(page.locator("#prompt")).toBeVisible();
    // Malformed persisted data must not break opening or navigation.
    await page.evaluate(() =>
      localStorage.setItem("liquid.models.collapsedProviders", "[null, 3]"),
    );
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
      await page.locator(".model-button").click();
      const picker = page.getByRole("dialog", { name: "Выбор модели" });
      const primary = picker.getByRole("button", { name: "Основной провайдер" });
      const secondary = picker.getByRole("button", { name: "Второй провайдер" });
      const search = picker.getByRole("combobox");
      await expect(primary).toHaveAttribute("aria-expanded", "true");
      const searchBounds = await picker.locator(".search").boundingBox();
      const headingBounds = await primary.boundingBox();
      expect(headingBounds?.y).toBeCloseTo((searchBounds?.y ?? 0) + (searchBounds?.height ?? 0), 0);
      await expect(picker.getByRole("option", { name: "Reasoner", exact: false })).toContainText(
        "Reasoner",
      );
      const reasoning = picker.getByRole("option").filter({ hasText: "Reasoner" });
      await expect(reasoning.locator('[title="Рассуждения"]')).toBeVisible();
      await expect(reasoning.locator('[title="Изображения"]')).toBeVisible();
      const media = picker.getByRole("option").filter({ hasText: "Media" });
      await expect(media.locator('[title="PDF"]')).toBeVisible();
      await expect(media.locator('[title="Аудио"]')).toBeVisible();
      await expect(picker.locator(".row-context")).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`expanded-${width}.png`) });

      await search.press("Tab");
      await expect(primary).toBeFocused();
      await primary.press("Enter");
      await expect(primary).toHaveAttribute("aria-expanded", "false");
      await expect(picker.getByRole("option")).toHaveCount(1);
      // All-collapsed state remains navigable; Enter in search selects nothing.
      await secondary.click();
      await search.focus();
      await search.press("ArrowDown");
      await search.press("Enter");
      await expect(picker).toBeVisible();
      await expect(search).not.toHaveAttribute("aria-activedescendant");
      await secondary.click();
      await page.screenshot({ path: test.info().outputPath(`collapsed-${width}.png`) });

      await search.fill("Reasoner");
      await expect(primary).toHaveAttribute("aria-expanded", "true");
      await expect(picker.getByRole("option")).toHaveCount(1);
      await search.fill("");
      await expect(primary).toHaveAttribute("aria-expanded", "false");
      await expect(picker.getByRole("option")).toHaveCount(1);
      // Collapsed groups do not participate in Arrow/Enter model selection.
      await search.press("ArrowDown");
      await search.press("Enter");
      await expect(page.locator(".model-button")).toHaveText("Alternate");
      await expect(page.locator(".model-button")).toBeFocused();
      if (width === 1480) {
        await page.locator(".model-button").click();
        await primary.click();
        await search.fill("Reasoner");
        await search.press("Enter");
        await expect(page.locator(".model-button")).toHaveText("Reasoner");
      }
    }
    expect(harness.consoleErrors).toEqual([]);
    await harness.close();
    harness = await launchApp({ cwd, userData });
    await expect(harness.page.locator("#prompt")).toBeVisible();
    await harness.page.locator(".model-button").click();
    const picker = harness.page.getByRole("dialog", { name: "Выбор модели" });
    await expect(picker.getByRole("button", { name: "Основной провайдер" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(picker.getByRole("button", { name: "Второй провайдер" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(picker.getByRole("option")).toHaveCount(1);
    await picker.getByRole("combobox").fill("Reasoner");
    await picker.getByRole("combobox").press("Enter");
    await expect(harness.page.locator(".model-button")).toHaveText("Reasoner");
    expect(harness.consoleErrors).toEqual([]);
  } finally {
    await harness?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
