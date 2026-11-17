import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { AgentEvent } from "../../ui/src/lib/types";
import { type AppHarness, environmentProblem, launchApp } from "./fixtures";

type Response = Extract<AgentEvent, { type: "response" }>;

async function savedSettings(page: Page): Promise<Response> {
  return page.evaluate(
    () =>
      new Promise<Response>((resolve, reject) => {
        const bridge = window.desktop?.agent;
        if (!bridge) return reject(new Error("Missing sidecar bridge"));
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => {
          off();
          reject(new Error("Settings request timed out"));
        }, 15_000);
        const off = bridge.onEvent((event) => {
          if (event.type !== "response" || event.requestId !== requestId) return;
          clearTimeout(timer);
          off();
          if (event.ok) resolve(event);
          else reject(new Error(event.error));
        });
        bridge.send({ type: "settings.get", requestId });
      }),
  );
}

async function auditAddDialog(h: AppHarness, dialog: Locator, checkbox: Locator): Promise<void> {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await h.page.emulateMedia({ reducedMotion });
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
      await h.page.setViewportSize({ width, height });
      for (const checked of [true, false]) {
        await checkbox.setChecked(checked);
        await checkbox.focus();
        const layout = await dialog.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const body = node.querySelector<HTMLElement>(".add-body");
          return {
            fits:
              rect.left >= 0 &&
              rect.top >= 0 &&
              rect.right <= innerWidth &&
              rect.bottom <= innerHeight,
            overflow: !!body && body.scrollWidth > body.clientWidth,
            documentOverflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        expect(layout).toEqual({ fits: true, overflow: false, documentOverflow: false });
        await h.page.screenshot({
          path: test
            .info()
            .outputPath(`provider-check-${checked}-${reducedMotion}-${width}x${height}.png`),
          animations: "disabled",
        });
      }
    }
  }
}

test("custom providers can skip discovery and persist manual models after a 401", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const requests: Array<{ method: string; url: string; authorization: string }> = [];
  const server = createServer((request, response) => {
    if (request.url?.endsWith("/models") || request.method !== "GET")
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization ?? "",
      });
    request.resume();
    if (request.method === "GET") {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "HTTP 401: model discovery is blocked" } }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      'data: {"choices":[{"delta":{"content":"Manual model connected"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    );
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
    const dialog = page.getByRole("dialog", { name: "Добавить провайдера", exact: true });
    await dialog.getByRole("button", { name: "Свой сервер", exact: true }).click();
    const checkbox = dialog.getByRole("checkbox");
    await expect(checkbox).toBeChecked();
    await dialog.getByPlaceholder("https://api.example.com/v1", { exact: true }).fill(baseUrl);
    await dialog.getByLabel("Ключ API", { exact: true }).fill("qa-restricted-router-key");
    await dialog.getByRole("button", { name: "Подключить и найти модели", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("401");
    await expect(dialog).toBeVisible();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((entry) => entry.method === "GET" && entry.url.endsWith("/models"))).toBe(
      true,
    );
    let checkedRequests = requests.length;

    await auditAddDialog(h, dialog, checkbox);
    await expect(checkbox).not.toBeChecked();
    const add = dialog.getByRole("button", { name: "Добавить без проверки", exact: true });
    const url = dialog.getByPlaceholder("https://api.example.com/v1", { exact: true });
    await url.fill("not-a-url");
    if (await add.isEnabled()) await add.click();
    await expect(dialog).toBeVisible();
    await expect(settings.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
    expect(requests).toHaveLength(checkedRequests);
    await url.fill(baseUrl);
    await add.click();
    await expect(dialog).toBeHidden();
    expect(requests).toHaveLength(checkedRequests);
    const editor = page.getByRole("region", { name: "Настройки провайдера", exact: true });
    await editor
      .getByRole("textbox", { name: "Название провайдера", exact: true })
      .fill("Restricted router");
    await editor.getByRole("tab", { name: "Модели", exact: true }).click();
    const models = editor.getByRole("region", { name: "Модели провайдера", exact: true });
    await models.getByRole("button", { name: "Добавить", exact: true }).click();
    await models
      .getByPlaceholder("ID модели, например deepseek-chat", { exact: true })
      .fill("manual-model");
    await models.getByRole("button", { name: "Добавить модель", exact: true }).click();
    const closeModel = page.getByRole("button", { name: "Закрыть модель", exact: true });
    await expect(closeModel).toBeVisible();
    // Adding a model explicitly fetches its metadata, without running a generation.
    expect(requests).toHaveLength(checkedRequests + 1);
    expect(requests.at(-1)).toMatchObject({ method: "GET", url: "/v1/models" });
    checkedRequests = requests.length;
    await closeModel.click();
    await settings.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(settings.getByText("Сохранено", { exact: true })).toBeVisible();
    const saved = JSON.parse(await readFile(join(h.cwd, "flecten.config.json"), "utf8"));
    const entry = Object.entries(saved.providers).find(
      ([, provider]) => (provider as { baseUrl: string }).baseUrl === baseUrl,
    );
    expect(entry).toBeDefined();
    const providerId = entry?.[0];
    if (!providerId) throw new Error("Manual provider was not saved");
    expect(entry?.[1]).toMatchObject({
      protocol: "openai-chat",
      baseUrl,
      models: { "manual-model": { source: "manual" } },
    });
    expect(requests).toHaveLength(checkedRequests);
    await settings.getByRole("button", { name: "Закрыть настройки", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await page.getByRole("button", { name: "Провайдеры", exact: true }).click();
    await page.locator(`[data-provider-id="${providerId}"]`).click();
    const reopened = await savedSettings(page);
    expect(
      reopened.settings?.info.providers.find((provider) => provider.id === providerId),
    ).toMatchObject({
      apiKeySet: true,
      keySource: "stored",
      models: { "manual-model": { source: "manual" } },
    });
    expect(requests).toHaveLength(checkedRequests);

    await settings
      .locator(".rail-head")
      .getByRole("button", { name: "Добавить", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Свой сервер", exact: true }).click();
    await checkbox.uncheck();
    await url.fill(`${baseUrl}/`);
    await dialog.getByLabel("Ключ API", { exact: true }).fill("qa-replacement-router-key");
    await add.click();
    await expect(dialog).toBeHidden();
    await expect(
      editor.getByRole("textbox", { name: "Название провайдера", exact: true }),
    ).toHaveValue("Restricted router");
    await settings.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(settings.getByText("Сохранено", { exact: true })).toBeVisible();
    const merged = await savedSettings(page);
    expect(
      merged.settings?.info.providers.filter((provider) => provider.baseUrl === baseUrl),
    ).toHaveLength(1);
    expect(merged.settings?.config.providers[providerId]?.models["manual-model"]).toBeDefined();
    expect(requests).toHaveLength(checkedRequests);
    await editor.getByRole("button", { name: "Проверить подключение", exact: true }).click();
    await expect(editor.getByText("Текст: ответ получен", { exact: false })).toBeVisible();
    expect(requests.at(-1)).toMatchObject({
      method: "POST",
      authorization: "Bearer qa-replacement-router-key",
    });
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
