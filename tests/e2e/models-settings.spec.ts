import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { chooseSelect, selectOptions } from "./custom-select";
import { launchApp } from "./fixtures";

async function choose(page: Page, role: string, model: string): Promise<void> {
  await page.locator(".models-settings").getByRole("button", { name: role, exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Select model", exact: true });
  await picker.getByRole("combobox").fill(model);
  await expect(picker.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
}

test("model defaults save independently, survive toggles and reopen, and discard safely", async () => {
  const h = await launchApp({
    locale: "en",
    models: {
      "e2e-model": {
        name: "Initial model",
        context: 32768,
        output: 4096,
        tools: true,
        reasoning: false,
      },
      primary: {
        name: "Primary universal",
        tools: true,
        reasoning: true,
        reasoningLevels: ["minimal", "medium", "high"],
      },
      talker: {
        name: "Conversation model",
        tools: true,
        reasoning: true,
        reasoningLevels: ["low", "high"],
        variants: { careful: { name: "Careful" }, deep: { name: "Deep", reasoning: "high" } },
      },
      switching: {
        name: "Switchable reasoning",
        tools: true,
        reasoning: true,
        reasoningMode: "toggle",
      },
      worker: {
        name: "Task execution",
        tools: true,
        reasoning: true,
        reasoningLevels: ["low", "high", "xhigh"],
      },
      research: {
        name: "Research model",
        tools: true,
        reasoning: true,
        reasoningLevels: ["low", "medium"],
      },
      review: {
        name: "Review model",
        tools: true,
        reasoning: true,
        reasoningLevels: ["high", "max"],
      },
      eyes: {
        name: "Image only",
        vision: true,
        tools: false,
        reasoning: true,
        reasoningLevels: ["low", "high"],
        variants: { detailed: { name: "Detailed" } },
      },
      disabled: { name: "Disabled model", tools: true, disabled: true },
    },
  });
  const { page } = h;
  const configPath = join(h.cwd, "flecten.config.json");
  try {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    await dialog.getByRole("button", { name: "Models", exact: true }).click();
    await expect(dialog.locator("#settings-models")).toBeVisible();
    await expect(dialog.getByText("Reasoning level", { exact: true })).toHaveCount(7);
    await expect(
      dialog.getByLabel("Default main model: Model reasoning level", { exact: true }),
    ).toBeDisabled();
    await expect(dialog.getByLabel("Explore: Model reasoning level", { exact: true })).toHaveText(
      "Select a model first",
    );
    const toggle = dialog.getByRole("checkbox", { name: "Separate conversation from execution" });
    await expect(toggle).not.toBeChecked();
    await expect(dialog.getByRole("button", { name: "Talker model", exact: true })).toBeDisabled();
    await toggle.check();
    await dialog.getByRole("button", { name: "Default main model", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Select model", exact: true });
    await expect(picker.getByRole("option").filter({ hasText: "Image only" })).toHaveCount(0);
    await expect(picker.getByRole("option").filter({ hasText: "Disabled model" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await choose(page, "Default main model", "Primary universal");
    await chooseSelect(
      dialog.getByLabel("Default main model: Model reasoning level", { exact: true }),
      "minimal",
    );
    await expect(
      dialog.getByLabel("Worker model: Model reasoning level", { exact: true }),
    ).toHaveAttribute("value", "minimal");
    await chooseSelect(
      dialog.getByLabel("Worker model: Model reasoning level", { exact: true }),
      "high",
    );
    await expect(dialog.getByRole("button", { name: "Worker model", exact: true })).toHaveText(
      "Primary universal",
    );
    await expect(
      dialog.getByLabel("Talker model: Model reasoning level", { exact: true }),
    ).toHaveAttribute("value", "");
    await choose(page, "Talker model", "Switchable reasoning");
    const talkerReasoning = dialog.getByLabel("Talker model: Model reasoning level", {
      exact: true,
    });
    await expect(await selectOptions(talkerReasoning)).toHaveText([
      "Default: no reasoning",
      "Off",
      "Enabled",
    ]);
    await page.keyboard.press("Escape");
    await chooseSelect(talkerReasoning, "medium");
    await expect(talkerReasoning).toHaveAttribute("value", "medium");
    await choose(page, "Talker model", "Conversation model");
    await chooseSelect(
      dialog.getByLabel("Talker model: Model reasoning level", { exact: true }),
      "low",
    );
    await chooseSelect(dialog.getByLabel("Talker model: Model variant", { exact: true }), "deep");
    await expect(talkerReasoning).toBeDisabled();
    await expect(talkerReasoning).toHaveAttribute("value", "high");
    await chooseSelect(
      dialog.getByLabel("Talker model: Model variant", { exact: true }),
      "careful",
    );
    await expect(talkerReasoning).toBeEnabled();
    await expect(talkerReasoning).toHaveAttribute("value", "low");
    await choose(page, "Worker model", "Task execution");
    await chooseSelect(
      dialog.getByLabel("Worker model: Model reasoning level", { exact: true }),
      "high",
    );
    await choose(page, "Explore", "Research model");
    await chooseSelect(
      dialog.getByLabel("Explore: Model reasoning level", { exact: true }),
      "medium",
    );
    await choose(page, "Implement", "Task execution");
    await chooseSelect(
      dialog.getByLabel("Implement: Model reasoning level", { exact: true }),
      "xhigh",
    );
    await choose(page, "Review", "Review model");
    await chooseSelect(dialog.getByLabel("Review: Model reasoning level", { exact: true }), "max");
    await choose(page, "Image description model", "Image only");
    await chooseSelect(
      dialog.getByLabel("Image description model: Model reasoning level", { exact: true }),
      "high",
    );
    await chooseSelect(
      dialog.getByLabel("Image description model: Model variant", { exact: true }),
      "detailed",
    );
    await dialog
      .locator(".vision-settings")
      .getByRole("button", { name: "Auto", exact: true })
      .click();
    await expect(
      dialog.getByLabel("Image description model: Model reasoning level", { exact: true }),
    ).toBeDisabled();
    await choose(page, "Image description model", "Image only");
    await chooseSelect(
      dialog.getByLabel("Image description model: Model reasoning level", { exact: true }),
      "high",
    );
    await chooseSelect(
      dialog.getByLabel("Image description model: Model variant", { exact: true }),
      "detailed",
    );
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByText("Saved", { exact: true })).toBeVisible();
    const saved = JSON.parse(await readFile(configPath, "utf8"));
    expect(saved.provider).toBe("e2e");
    expect(saved.model).toBe("primary");
    expect(saved.reasoning).toBe("minimal");
    expect(saved.conversation).toEqual({
      enabled: true,
      talker: { provider: "e2e", model: "talker", reasoning: "low", variant: "careful" },
      worker: { provider: "e2e", model: "worker", reasoning: "high" },
    });
    expect(saved.subagents.models).toEqual({
      explore: { provider: "e2e", model: "research", reasoning: "medium" },
      implement: { provider: "e2e", model: "worker", reasoning: "xhigh" },
      review: { provider: "e2e", model: "review", reasoning: "max" },
    });
    expect(saved.vision).toEqual({
      provider: "e2e",
      model: "eyes",
      reasoning: "high",
      variant: "detailed",
    });

    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await h.app.evaluate(
        ({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
        },
        { width, height },
      );
      await page.setViewportSize({ width, height });
      await dialog.locator(".main-scroll").evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.screenshot({ path: test.info().outputPath(`models-settings-${width}.png`) });
      await dialog.getByRole("button", { name: "Talker model", exact: true }).click();
      const bounds = await picker.boundingBox();
      expect(bounds).not.toBeNull();
      if (!bounds) throw new Error("Model picker has no bounds");
      expect(bounds.x).toBeGreaterThanOrEqual(7);
      expect(bounds.y).toBeGreaterThanOrEqual(7);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 7);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height - 7);
      await page.screenshot({ path: test.info().outputPath(`models-picker-${width}.png`) });
      await page.keyboard.press("Escape");
      await dialog.locator(".vision-settings").scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath(`models-subagents-${width}.png`) });
      await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeVisible();
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }

    await toggle.uncheck();
    await toggle.check();
    await expect(dialog.getByRole("button", { name: "Talker model", exact: true })).toHaveText(
      "Conversation model",
    );
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await toggle.uncheck();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByText("Saved", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await dialog.getByRole("button", { name: "Models", exact: true }).click();
    await expect(toggle).not.toBeChecked();
    await expect(
      dialog.getByRole("button", { name: "Default main model", exact: true }),
    ).toHaveText("Primary universal");
    await expect(dialog.getByRole("button", { name: "Talker model", exact: true })).toHaveText(
      "Conversation model",
    );
    await toggle.check();
    for (const [role, level] of [
      ["Default main model", "minimal"],
      ["Talker model", "low"],
      ["Worker model", "high"],
      ["Explore", "medium"],
      ["Implement", "xhigh"],
      ["Review", "max"],
      ["Image description model", "high"],
    ] as const) {
      await expect(
        dialog.getByLabel(`${role}: Model reasoning level`, { exact: true }),
      ).toHaveAttribute("value", level ?? "");
    }
    await choose(page, "Worker model", "Research model");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.getByRole("button", { name: "Don't save", exact: true }).click();
    const afterDiscard = JSON.parse(await readFile(configPath, "utf8"));
    expect(afterDiscard.conversation).toEqual({ ...saved.conversation, enabled: false });
    expect(afterDiscard.subagents.models).toEqual(saved.subagents.models);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
