import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { type AppHarness, environmentProblem, launchApp } from "./fixtures";

async function checkSavedProvider(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const bridge = window.desktop?.agent;
        if (!bridge) return reject(new Error("Missing sidecar bridge"));
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => {
          off();
          reject(new Error("Provider test timed out"));
        }, 15_000);
        const off = bridge.onEvent((event) => {
          if (event.type !== "response" || event.requestId !== requestId) return;
          clearTimeout(timer);
          off();
          if (event.ok) resolve();
          else reject(new Error(event.error));
        });
        bridge.send({
          type: "provider.test",
          providerId: "auth-ui",
          model: "auth-model",
          requestId,
        });
      }),
  );
}

async function auditSettings(h: AppHarness, name: string, focus?: Locator): Promise<void> {
  for (const [width, height] of [
    [1480, 940],
    [1180, 640],
  ] as const) {
    await h.app.evaluate(
      ({ BrowserWindow }, size: [number, number]) =>
        BrowserWindow.getAllWindows()[0]?.setContentSize(size[0], size[1]),
      [width, height],
    );
    await h.page.setViewportSize({ width, height });
    await h.page.locator(".main-scroll").evaluate((node) => {
      node.scrollTop = 0;
    });
    await focus?.evaluate((node) => node.scrollIntoView({ block: "start" }));
    const problems = await h.page.locator(".settings-dialog").evaluate((dialog) => {
      const content = dialog.querySelector<HTMLElement>(".main-scroll");
      const smallActions = [
        ...dialog.querySelectorAll<HTMLElement>(
          ".st-btn,.st-icon-btn,.section-main,.st-switch,.st-search",
        ),
      ]
        .filter(
          (node) =>
            node.getClientRects().length > 0 &&
            (node.getBoundingClientRect().width < 40 || node.getBoundingClientRect().height < 40),
        )
        .map((node) => node.textContent?.trim() || node.getAttribute("aria-label"));
      const smallMetadata = [
        ...dialog.querySelectorAll<HTMLElement>(".st-hint,.provider-meta,.key-source"),
      ]
        .filter(
          (node) =>
            node.getClientRects().length > 0 &&
            Number.parseFloat(getComputedStyle(node).fontSize) < 12,
        )
        .map((node) => node.textContent?.trim());
      return {
        overflow: !!content && content.scrollWidth > content.clientWidth,
        smallActions,
        smallMetadata,
      };
    });
    expect(problems).toEqual({ overflow: false, smallActions: [], smallMetadata: [] });
    await h.page.screenshot({
      path: test.info().outputPath(`${name}-${width}x${height}.png`),
      animations: "disabled",
    });
  }
}

test("saved command authorization refreshes through the provider settings button", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const credentials: string[] = [];
  const models: unknown[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      credentials.push(request.headers.authorization ?? "");
      models.push((JSON.parse(body) as { model?: unknown }).model);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        'data: {"choices":[{"delta":{"content":"Authorization checked"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test provider port");
  const cwd = await mkdtemp(join(tmpdir(), "liquid-auth-ui-"));
  const credential = join(cwd, "credential.txt");
  const executions = join(cwd, "auth-executions.txt");
  const auth = join(cwd, "authorize.cjs");
  await writeFile(credential, "qa-first-credential");
  await writeFile(executions, "");
  await writeFile(
    auth,
    "const fs = require('node:fs'); fs.appendFileSync(process.argv[3], 'executed\\n'); process.stdout.write(fs.readFileSync(process.argv[2], 'utf8'));",
  );
  await writeFile(join(cwd, "README.md"), "Provider authorization UI fixture");
  await mkdir(join(cwd, ".liquid", "skills", "qa-auth"), { recursive: true });
  await writeFile(
    join(cwd, ".liquid", "skills", "qa-auth", "SKILL.md"),
    "---\nname: qa-auth\ndescription: Review provider authorization\nversion: 1.0.0\nallowed-tools: read\n---\n\nRead the selected file.\n",
  );
  await writeFile(
    join(cwd, "flecten.config.json"),
    JSON.stringify({
      useDefaults: false,
      provider: "auth-ui",
      model: "auth-model",
      providers: {
        "auth-ui": {
          name: "Command authorization",
          protocol: "openai-chat",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          auth: {
            command: process.execPath,
            args: [auth, credential, executions],
            refreshIntervalMs: 3_600_000,
          },
          models: { "auth-model": { name: "Authorized model", context: 32768, output: 4096 } },
        },
      },
      permissions: {
        read: "auto",
        write: "auto",
        shell: "auto",
        network: "auto",
        mcp: "auto",
        skill: "allow",
        externalPath: "deny",
        rules: [],
      },
      sandbox: { enabled: false },
      catalog: { autoRefresh: false },
      skills: { sources: ["project-liquid"] },
      mcp: {
        servers: { "qa-server": { command: process.execPath, args: [], env: {}, enabled: false } },
      },
    }),
  );
  const h = await launchApp({ cwd });
  try {
    const { page } = h;
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await page.getByRole("button", { name: "Провайдеры", exact: true }).click();
    await page.locator('[data-provider-id="auth-ui"]').click();
    const editor = page.getByRole("region", { name: "Настройки провайдера", exact: true });
    await expect(editor.locator(".key-source")).toContainText("команда авторизации");
    const reauthorize = editor.getByRole("button", { name: "Обновить авторизацию", exact: true });
    await expect(reauthorize).toBeEnabled();
    await expect(
      editor.getByRole("button", { name: "Проверить связь", exact: true }),
    ).toBeEnabled();
    await checkSavedProvider(page);
    expect(credentials.at(-1)).toBe("Bearer qa-first-credential");
    const firstExecutions = (await readFile(executions, "utf8")).trim().split("\n").length;

    await writeFile(credential, "qa-second-credential");
    const before = credentials.length;
    await checkSavedProvider(page);
    await expect.poll(() => credentials.length).toBeGreaterThan(before);
    expect(credentials.at(-1)).toBe("Bearer qa-first-credential");
    await reauthorize.click();
    await expect(
      page.getByText("Авторизация обновлена и проверена.", { exact: true }),
    ).toBeVisible();
    expect(credentials.at(-1)).toBe("Bearer qa-second-credential");
    expect((await readFile(executions, "utf8")).trim().split("\n")).toHaveLength(
      firstExecutions + 1,
    );
    const after = credentials.length;
    await checkSavedProvider(page);
    await expect.poll(() => credentials.length).toBeGreaterThan(after);
    expect(credentials.at(-1)).toBe("Bearer qa-second-credential");
    expect(models.every((model) => model === "auth-model")).toBe(true);
    expect(await page.locator("body").innerText()).not.toContain("qa-second-credential");

    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await h.app.evaluate(
        ({ BrowserWindow }, size: [number, number]) =>
          BrowserWindow.getAllWindows()[0]?.setContentSize(size[0], size[1]),
        [width, height],
      );
      await page.setViewportSize({ width, height });
      await reauthorize.scrollIntoViewIfNeeded();
      const box = await reauthorize.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(40);
      expect(box?.width).toBeGreaterThanOrEqual(40);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: test.info().outputPath(`provider-authorization-${width}x${height}.png`),
        animations: "disabled",
      });
    }
    await page.getByRole("button", { name: "Назад", exact: true }).click();
    await page.getByRole("button", { name: "MCP", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Включить MCP-сервер qa-server", exact: true }),
    ).toBeAttached();
    await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
    await auditSettings(h, "mcp-controls");
    await page.getByRole("button", { name: "Навыки", exact: true }).click();
    await expect(page.locator("summary").filter({ hasText: "qa-auth" })).toBeVisible();
    await page.locator("summary").filter({ hasText: "qa-auth" }).click();
    await expect(
      page.getByRole("checkbox", { name: "Доверять навыку qa-auth", exact: true }),
    ).toBeAttached();
    await auditSettings(
      h,
      "skill-controls",
      page.locator("summary").filter({ hasText: "qa-auth" }),
    );
    await page.getByRole("button", { name: "О программе", exact: true }).click();
    await page.locator("summary").filter({ hasText: "Диагностика" }).click();
    await expect(
      page.getByRole("button", { name: "Скопировать отчёт", exact: true }),
    ).toBeVisible();
    await auditSettings(h, "diagnostics-controls");
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(cwd, { recursive: true, force: true });
  }
});
