import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { expect, test } from "@playwright/test";
import { locales } from "../../ui/src/lib/i18n/locales";
import { repoRoot } from "./fixtures";

test("website languages cover the home page, docs and interactive examples", async ({ page }) => {
  const root = resolve(repoRoot, "web");
  const server = createServer(async (request, response) => {
    const path = resolve(root, `.${new URL(request.url ?? "/", "http://localhost").pathname}`);
    if (!path.startsWith(root + sep)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const mime = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
      };
      response.setHeader(
        "content-type",
        mime[extname(path) as keyof typeof mime] ?? "application/octet-stream",
      );
      response.end(await readFile(path));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  const origin = `http://127.0.0.1:${address.port}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`${origin}/index.html`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("[data-language]")).toHaveValue("en");
    for (const { id } of locales) {
      await page.locator("[data-language]").selectOption(id);
      await expect(page.locator("html")).toHaveAttribute("lang", id);
      await expect(page.locator("[data-language]")).toHaveValue(id);
      await expect(page.locator("h1")).not.toBeEmpty();
      await page.setViewportSize({ width: 1180, height: 640 });
      const catalog = JSON.parse(await readFile(resolve(root, `locales/${id}.json`), "utf8"));
      await page.locator('[data-task="ui"]').click();
      await expect(page.locator("#scene-status")).toContainText(
        catalog["Build a UI without low-quality AI output"],
      );
      await expect(page.locator("#task-prompt")).not.toBeEmpty();
      await page.screenshot({ path: test.info().outputPath(`website-${id}.png`) });
      await page.goto(`${origin}/docs.html`);
      await expect(page.locator("html")).toHaveAttribute("lang", id);
      await expect(page.locator("h1")).not.toBeEmpty();
      await page.goto(`${origin}/index.html`);
    }
    expect(errors).toEqual([]);
  } finally {
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
});
