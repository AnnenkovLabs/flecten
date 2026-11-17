import { createServer } from "node:http";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp } from "./fixtures";

// The compiled module host controls its own authenticated display. Electron itself stays hidden.
test("Computer installs from a folder, receives real desktop pixels and hands input to the human", async () => {
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
  const desktopCalls: Array<{ tool: string; id: string }> = [];
  try {
    const { page } = h;
    await page.exposeFunction("recordDesktopCall", (tool: string, id: string) =>
      desktopCalls.push({ tool, id }),
    );
    await page.evaluate(() => {
      window.addEventListener("message", (event) => {
        const value = event.data;
        if (value?.type === "flecten.module.request" && value.method === "call")
          (
            window as unknown as { recordDesktopCall(tool: string, id: string): void }
          ).recordDesktopCall(value.tool, value.id);
      });
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    await dialog.getByRole("button", { name: "Modules", exact: true }).click();
    await dialog.getByRole("button", { name: "Installed", exact: false }).click();
    await dialog
      .getByLabel("Module folder", { exact: true })
      .fill(join(import.meta.dirname, "../fixtures/modules/computer-use"));
    await dialog.getByRole("button", { name: "Install from folder", exact: true }).click();
    await dialog.getByRole("button", { name: "Trust this version", exact: true }).click();
    // Wait for the persisted trust response and settings reload before starting model work.
    await expect(dialog.getByRole("button", { name: "Disable", exact: true })).toBeEnabled();
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
    await dialog.getByRole("button", { name: "Access", exact: true }).click();
    await dialog.getByText("Advanced access settings", { exact: true }).click();
    await dialog
      .getByRole("group", { name: "Policy: MCP", exact: true })
      .getByRole("button", { name: "Allow", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByText("Saved", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(frame.getByRole("button", { name: "Start desktop", exact: true })).toBeVisible();
    // CDP can lose the first pointer click in a minimized opaque-origin frame after a modal closes.
    await frame.getByRole("button", { name: "Start desktop", exact: true }).press("Enter");
    await expect(frame.getByText("Agent has control", { exact: true }).first()).toBeVisible();
    await expect(frame.locator("#image")).toBeVisible();
    // Manual input uses one observed frame; refresh it explicitly after navigation below.
    await frame.getByRole("checkbox", { name: "Follow activity", exact: true }).uncheck();
    await frame.getByRole("button", { name: "Take control", exact: true }).press("Enter");
    await expect(frame.getByText("You have control", { exact: true }).first()).toBeVisible();
    await expect(frame.locator("#workspace")).toHaveAttribute("aria-busy", "false");
    await expect(frame.locator("#image")).toBeVisible();
    await expect(frame.getByLabel("Type on desktop", { exact: true })).toBeVisible();
    await frame.getByText("Pointer and browser controls", { exact: true }).press("Enter");
    const url = frame.getByLabel("Open URL", { exact: true });
    await url.fill(`http://127.0.0.1:${address.port}/`);
    // Submit from the focused field without moving keyboard focus across a clipped button.
    await url.scrollIntoViewIfNeeded();
    await url.press("Enter");
    await expect
      .poll(() =>
        desktopCalls.some((call) => call.tool === "mcp_module_computer-use__runtime_navigate"),
      )
      .toBe(true);
    await expect(frame.locator("#workspace")).toHaveAttribute("aria-busy", "false", {
      timeout: 30_000,
    });
    await expect(frame.locator("#image")).toBeVisible();
    const notice = frame.locator("#notice");
    if (await notice.isVisible())
      await expect(notice).toContainText(
        "Navigation may have been delivered. Observe before retrying.",
      );
    // Confirm actual delivery, then take a fresh observation without resending input.
    await expect.poll(() => requests).toBeGreaterThan(0);
    await frame.getByRole("button", { name: "Refresh", exact: true }).first().press("Enter");
    await expect(frame.locator("#workspace")).toHaveAttribute("aria-busy", "false");
    await expect(notice).toBeHidden();
    await frame.getByLabel("Type on desktop", { exact: true }).fill("Verified human input");
    await frame.getByRole("button", { name: "Type text", exact: true }).press("Enter");
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
    await frame.getByRole("button", { name: "Return to agent", exact: true }).press("Enter");
    await expect(frame.getByText("Agent has control", { exact: true }).first()).toBeVisible();
    await frame.getByRole("button", { name: "Stop desktop", exact: true }).press("Enter");
    await expect(frame.getByRole("button", { name: "Start desktop", exact: true })).toBeVisible();
    expect(h.consoleErrors).toEqual([]);
  } catch (error) {
    const state = await h.page
      .frameLocator('iframe[title="Computer"]')
      .locator("body")
      .evaluate((body) => ({
        busy: body.querySelector("#workspace")?.getAttribute("aria-busy"),
        notice: body.querySelector("#notice")?.textContent,
        history: body.querySelector("#timeline")?.textContent,
        imageVisible: !(body.querySelector("#image") as HTMLImageElement | null)?.hidden,
        activeControl: document.activeElement?.id,
      }))
      .catch(() => undefined);
    await test.info().attach("computer-runtime-evidence", {
      body: JSON.stringify({ desktopCalls, requests, state }, null, 2),
      contentType: "application/json",
    });
    throw error;
  } finally {
    await h.close();
    site.closeAllConnections();
    await new Promise<void>((resolve) => site.close(() => resolve()));
  }
});
