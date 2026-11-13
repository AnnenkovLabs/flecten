import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { launchApp } from "./fixtures";

// The compiled module host controls its own authenticated display. Electron itself stays hidden.
test("bundled Computer installs, receives real desktop pixels and hands input to the human", async () => {
  test.skip(process.platform !== "linux", "The bundled desktop backend requires Linux");
  let requests = 0;
  let typed = "";
  const site = createServer((request, response) => {
    if (request.url === "/typed") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        typed = body;
        response.end("ok");
      });
      return;
    }
    requests++;
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><html><title>Computer Use acceptance</title><body style="background:#f7f5f1;color:#272522;font:20px system-ui;padding:64px"><p>Flecten local acceptance document</p><h1>Desktop input is connected.</h1><p>This page is served by the local test fixture.</p><label>Notes <input autofocus style="font:inherit;padding:12px" oninput="fetch(\'/typed\',{method:\'POST\',body:this.value})"></label></body></html>',
    );
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  const address = site.address();
  if (!address || typeof address === "string")
    throw new Error("Local acceptance server did not start");
  const h = await launchApp({
    locale: "en",
    models: {
      "e2e-model": {
        name: "E2E Mock",
        context: 128000,
        output: 4096,
        tools: true,
        reasoning: false,
        vision: true,
      },
    },
    firstCalls: [{ name: "module", arguments: { operation: "activate", name: "computer-use" } }],
    reply: "Computer is available.",
  });
  try {
    const { page } = h;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    await dialog.getByRole("button", { name: "Modules", exact: true }).click();
    await dialog.getByRole("button", { name: "View module: Computer", exact: true }).click();
    await dialog.getByRole("button", { name: "Install module", exact: true }).click();
    await dialog.getByRole("button", { name: "Manage installed modules", exact: true }).click();
    await dialog.getByRole("button", { name: "Trust this version", exact: true }).click();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator("#prompt").fill("Activate computer-use for this task");
    await page.locator("#prompt").press("Enter");
    const tab = page.getByRole("tab", { name: "Computer", exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    const frame = page.frameLocator('iframe[title="Computer"]');
    // Revision-trusted status/preview use the bounded read path without flooding approvals.
    const approval = page.locator(".module-approvals");
    await expect(approval).toBeHidden();
    await expect(frame.getByRole("button", { name: "Start desktop", exact: true })).toBeEnabled();
    // Explicitly allow MCP in this isolated fixture for the remaining desktop acceptance actions.
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await dialog.getByRole("button", { name: "Permissions", exact: true }).click();
    await dialog
      .getByRole("group", { name: "Policy: MCP", exact: true })
      .getByRole("button", { name: "Allow", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByText("Saved", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(frame.getByRole("button", { name: "Start desktop", exact: true })).toBeVisible();
    await frame.getByRole("button", { name: "Start desktop", exact: true }).click();
    await expect(frame.getByText("Agent has control", { exact: true }).first()).toBeVisible();
    await expect(frame.locator("#image")).toBeVisible();
    await frame.getByRole("button", { name: "Take control", exact: true }).click();
    await expect(frame.getByText("You have control", { exact: true }).first()).toBeVisible();
    await expect(frame.getByLabel("Type on desktop", { exact: true })).toBeVisible();
    await frame.getByText("Pointer and browser controls", { exact: true }).click();
    await frame.getByLabel("Open URL", { exact: true }).fill(`http://127.0.0.1:${address.port}/`);
    await frame.getByRole("button", { name: "Open", exact: true }).click();
    await expect(frame.locator("#image")).toBeVisible();
    await expect(frame.locator("#notice")).toBeHidden();
    await expect.poll(() => requests).toBeGreaterThan(0);
    await frame.getByRole("button", { name: "Refresh", exact: true }).first().click();
    await frame.getByLabel("Type on desktop", { exact: true }).fill("Verified human input");
    await frame.getByRole("button", { name: "Type text", exact: true }).click();
    await expect.poll(() => typed).toBe("Verified human input");
    await expect(frame.locator("#workspace")).toHaveAttribute("aria-busy", "false");
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
      await expect(
        frame.getByRole("button", { name: "Return to agent", exact: true }),
      ).toBeVisible();
      expect(
        await frame.locator("body").evaluate((body) => body.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: test.info().outputPath(`computer-native-${width}.png`) });
    }
    await frame.getByRole("button", { name: "Return to agent", exact: true }).click();
    await expect(frame.getByText("Agent has control", { exact: true }).first()).toBeVisible();
    await frame.getByRole("button", { name: "Stop desktop", exact: true }).click();
    await expect(frame.getByRole("button", { name: "Start desktop", exact: true })).toBeVisible();
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
    site.closeAllConnections();
    await new Promise<void>((resolve) => site.close(() => resolve()));
  }
});
