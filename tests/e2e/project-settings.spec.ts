import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { AgentEvent } from "../../ui/src/lib/types";
import { environmentProblem, launchApp, type Page } from "./fixtures";

async function readSettings(page: Page) {
  return page.evaluate(async () => {
    const requestId = crypto.randomUUID();
    return new Promise<Extract<AgentEvent, { type: "response" }>>((resolve, reject) => {
      const timer = setTimeout(() => {
        stop?.();
        reject(new Error("Settings request timed out"));
      }, 10_000);
      const stop = window.desktop?.agent?.onEvent((event) => {
        if (event.type !== "response" || event.requestId !== requestId) return;
        clearTimeout(timer);
        stop?.();
        resolve(event);
      });
      window.desktop?.agent?.send({ type: "settings.get", requestId });
    });
  });
}

test("choosing a folder preserves the desktop models, key and preferences with project safety isolated", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const second = await mkdtemp(join(tmpdir(), "flecten-new-workspace-"));
  const h = await launchApp({ locale: "en", appProfile: true });
  try {
    const { page } = h;
    await writeFile(join(second, "README.md"), "# Second workspace\n");
    await mkdir(join(h.cwd, ".liquid/sessions/previous-workspace"), { recursive: true });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.locator("dialog.settings-dialog");
    await page.getByLabel("Send message", { exact: true }).selectOption("modifier-enter");
    await settings.getByRole("button", { name: "Providers", exact: true }).click();
    await settings.locator('[data-provider-id="e2e"]').click();
    await page
      .getByRole("textbox", { name: "API key for provider e2e", exact: true })
      .fill("e2e-profile-key");
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect(settings.getByText("Saved", { exact: true })).toBeVisible();
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    const original = await readSettings(page);
    expect(original.settings?.info.providers.find((entry) => entry.id === "e2e")?.apiKeySet).toBe(
      true,
    );

    await h.app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, second);
    await page.locator(".ns-picker-trigger").click();
    await page.getByRole("button", { name: "Select folder", exact: true }).click();
    await expect.poll(async () => (await readSettings(page)).settings?.info.cwd).toBe(second);
    const switched = await readSettings(page);
    expect(switched.settings?.info.cwd).toBe(second);
    expect(switched.settings?.config.provider).toBe("e2e");
    expect(switched.settings?.config.model).toBe("e2e-model");
    expect(switched.settings?.config.providers.e2e?.models).toEqual(
      original.settings?.config.providers.e2e?.models,
    );
    expect(switched.settings?.info.providers.find((entry) => entry.id === "e2e")?.apiKeySet).toBe(
      true,
    );
    expect(switched.settings?.config.ui?.sendShortcut).toBe("modifier-enter");
    expect(switched.settings?.config.sandbox?.enabled).toBe(true);
    expect(switched.settings?.config.permissions?.rules).toEqual([]);
    expect(switched.settings?.config.hooks?.preToolUse).toEqual([]);

    const profile = await readFile(join(h.cwd, "app-profile/flecten.config.json"), "utf8");
    expect(profile).not.toContain("e2e-profile-key");
    expect(profile).not.toContain(h.cwd);
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
      await page.screenshot({ path: test.info().outputPath(`project-settings-${width}.png`) });
    }
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
    await rm(second, { recursive: true, force: true });
  }
});
