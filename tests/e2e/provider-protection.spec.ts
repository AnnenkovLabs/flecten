import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

test("gateway consent requires a decision, scopes protection and persists its advanced switch", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const requests: Array<{
    path: string;
    authorization: string | undefined;
    cookie: string | undefined;
  }> = [];
  const server = createServer((request, response) => {
    requests.push({
      path: request.url ?? "",
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
    });
    request.resume();
    response.writeHead(200, { "content-type": "application/json", "X-New-Api-Version": "v1.0.0" });
    response.end(JSON.stringify({ success: true, message: "", data: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing provider port");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const h = await launchApp({ locale: "ru" });
  try {
    const { page } = h;
    await h.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.restore();
      if (process.env.FLECTEN_E2E_PRIVATE_DISPLAY === "1") window?.showInactive();
      else window?.hide();
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await page.getByRole("button", { name: "Провайдеры", exact: true }).click();
    const settings = page.locator("dialog.settings-dialog");
    await settings
      .locator(".rail-head")
      .getByRole("button", { name: "Добавить", exact: true })
      .click();
    const add = page.getByRole("dialog", { name: "Добавить провайдера", exact: true });
    await add.getByRole("button", { name: "Свой сервер", exact: true }).click();
    await add.getByRole("checkbox").uncheck();
    await add.getByPlaceholder("https://api.example.com/v1", { exact: true }).fill(baseUrl);
    await add
      .getByLabel("Ключ API", { exact: true })
      .fill("fixture-secret-must-not-reach-public-probes");
    await add.getByRole("button", { name: "Добавить без проверки", exact: true }).click();
    const consent = page.getByRole("dialog", {
      name: "Скрыть ключи и пароли от этого API?",
      exact: true,
    });
    await expect(consent).toBeVisible();
    await expect(consent.getByRole("button")).toHaveCount(2);
    await expect(
      consent.getByRole("button", { name: "Включить защиту", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(consent).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(consent).toBeVisible();
    expect(requests.length).toBeGreaterThan(0);
    expect(
      requests.every(
        (request) => !request.authorization && !request.cookie && !request.path.endsWith("/models"),
      ),
    ).toBe(true);
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await h.app.evaluate(
        ({ BrowserWindow }, size) => {
          const window = BrowserWindow.getAllWindows()[0];
          window?.setMinimumSize(0, 0);
          window?.setContentSize(size.width, size.height);
        },
        { width, height },
      );
      await page.setViewportSize({ width, height });
      await expect.poll(async () => consent.boundingBox()).toEqual({ x: 0, y: 0, width, height });
      const content = consent.locator(".protection-content");
      await expect(content).toBeVisible();
      expect(
        await content.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= innerHeight &&
            rect.right <= innerWidth &&
            node.scrollWidth <= node.clientWidth &&
            node.scrollHeight <= node.clientHeight
          );
        }),
      ).toBe(true);
      expect(
        await consent.evaluate(
          (node) => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight,
        ),
      ).toBe(true);
      for (const button of await consent.getByRole("button").all()) {
        const bounds = await button.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(52);
        expect(bounds).not.toBeNull();
        expect((bounds?.y ?? -1) >= 0 && (bounds?.x ?? -1) >= 0).toBe(true);
        expect((bounds?.y ?? height) + (bounds?.height ?? 0)).toBeLessThanOrEqual(height);
        expect((bounds?.x ?? width) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width);
      }
      await hiddenScreenshot(
        h,
        test.info().outputPath(`provider-protection-consent-${width}x${height}.png`),
      );
    }
    await consent.getByRole("button", { name: "Включить защиту", exact: true }).click();
    await expect(consent).toBeHidden();
    await expect(add).toBeHidden();
    const editor = page.getByRole("region", { name: "Настройки провайдера", exact: true });
    await editor
      .getByRole("textbox", { name: "Название провайдера", exact: true })
      .fill("Protected relay");
    await editor.getByRole("tab", { name: "Дополнительно", exact: true }).click();
    const toggle = editor.getByRole("switch", {
      name: "Скрывать ключи и пароли от этого API",
      exact: true,
    });
    await expect(toggle).toBeChecked();
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await h.app.evaluate(
        ({ BrowserWindow }, size) => {
          const window = BrowserWindow.getAllWindows()[0];
          window?.setMinimumSize(0, 0);
          window?.setContentSize(size.width, size.height);
        },
        { width, height },
      );
      await page.setViewportSize({ width, height });
      await toggle.focus();
      expect(
        await toggle.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return (
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= innerWidth &&
            rect.bottom <= innerHeight
          );
        }),
      ).toBe(true);
      await hiddenScreenshot(
        h,
        test.info().outputPath(`provider-protection-advanced-${width}x${height}.png`),
      );
    }
    await settings.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(settings.getByText("Сохранено", { exact: true })).toBeVisible();
    const saved = JSON.parse(await readFile(join(h.cwd, "flecten.config.json"), "utf8"));
    const entry = Object.entries(saved.providers).find(
      ([, value]) => (value as { name?: string }).name === "Protected relay",
    );
    expect(entry?.[1]).toMatchObject({
      protection: { enabled: true, inspection: { gateway: "new-api" } },
    });
    expect(saved.providers.e2e.protection).toBeUndefined();
    await toggle.uncheck();
    await settings.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(settings.getByText("Сохранено", { exact: true })).toBeVisible();
    const disabled = JSON.parse(await readFile(join(h.cwd, "flecten.config.json"), "utf8"));
    expect(disabled.providers[entry?.[0] ?? ""].protection.enabled).toBe(false);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
