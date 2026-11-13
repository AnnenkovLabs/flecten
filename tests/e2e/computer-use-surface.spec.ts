import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { HARNESS_TOKENS } from "../../ui/src/lib/markdown/tokens";

async function openSurface(page: Page, locale = "en") {
  const source = await readFile(
    join(import.meta.dirname, "../../src/marketplace/modules/computer-use/desktop.html"),
    "utf8",
  );
  const tokens = Object.entries(HARNESS_TOKENS)
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
  await page.route("http://computer.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: source
        .replace('<html lang="en">', `<html lang="${locale}">`)
        .replace("<style>", `<style>:root{${tokens}}`),
    }),
  );
  await page.addInitScript(() => {
    const host = window as unknown as {
      flecten: unknown;
      desktopCalls: Array<{ name: string; args: Record<string, unknown> }>;
      holdInput: boolean;
      holdStatus: boolean;
    };
    host.desktopCalls = [];
    let sequence = 0;
    let release: (() => void) | null = null;
    let image = "";
    const state = {
      version: 1,
      state: "idle",
      control: "agent",
      preview: null as null | { id: string; width: number; height: number; capturedAt: string },
      observation: null as null | {
        id: string;
        width: number;
        height: number;
        capturedAt: string;
      },
      history: [] as Array<{
        id: string;
        at: string;
        actor: string;
        action: string;
        status: string;
      }>,
      capabilities: { supported: true, ready: true, missingDependencies: [] },
    };
    const frame = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 800;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable");
      context.fillStyle = "#343434";
      context.fillRect(0, 0, 1280, 800);
      context.fillStyle = "#ededed";
      context.fillRect(80, 60, 1120, 660);
      context.fillStyle = "#d8d8d8";
      context.fillRect(80, 60, 1120, 40);
      context.fillStyle = "#333333";
      context.font = "18px sans-serif";
      context.fillText("Desktop fixture · local test document", 108, 87);
      context.font = "28px sans-serif";
      context.fillText("Observation and input test", 120, 164);
      context.font = "18px sans-serif";
      context.fillText("This image belongs to the UI test fixture.", 120, 205);
      context.fillText(`Frame ${sequence}`, 120, 240);
      image = canvas.toDataURL("image/png").split(",")[1] ?? "";
      state.preview = null;
      state.observation = {
        id: `observation-${++sequence}`,
        width: 1280,
        height: 800,
        capturedAt: "2026-11-12T19:30:00.000Z",
      };
    };
    const result = (withImage = false) => ({
      ok: true,
      output: "Desktop state",
      data: { structuredContent: structuredClone(state) },
      ...(withImage && state.observation
        ? { media: [{ mediaType: "image/png", data: image }] }
        : {}),
    });
    host.flecten = {
      tools: async () => ({ ok: true, output: "Desktop tools" }),
      call: async (name: string, args: Record<string, unknown>) => {
        host.desktopCalls.push({ name, args });
        switch (name) {
          case "mcp_module_computer-use__runtime_status":
            if (host.holdStatus) await new Promise<void>(() => {});
            return result();
          case "mcp_module_computer-use__runtime_start":
            state.state = "ready";
            frame();
            return result(true);
          case "mcp_module_computer-use__runtime_preview": {
            const observation = state.observation;
            frame();
            state.preview = state.observation;
            state.observation = observation;
            return result(true);
          }
          case "mcp_module_computer-use__runtime_observe":
            if (args.refresh) frame();
            return result(true);
          case "mcp_module_computer-use__runtime_control": {
            state.control = args.operation === "resume" ? "agent" : "human";
            state.state =
              args.operation === "stop" ? "stopped" : state.control === "human" ? "human" : "ready";
            if (state.state === "stopped") state.observation = null;
            else frame();
            const latest = result(true);
            setTimeout(() => release?.(), 50);
            return latest;
          }
          case "mcp_module_computer-use__runtime_interact": {
            if (state.control !== "human") throw new Error("Human ownership required");
            const action = args.action as { type: string };
            state.history.push({
              id: String(sequence),
              at: "2026-11-12T19:30:00.000Z",
              actor: "human",
              action: action.type,
              status: "completed",
            });
            frame();
            const completed = result(true);
            if (host.holdInput)
              await new Promise<void>((resolve) => {
                release = resolve;
              });
            return completed;
          }
          case "mcp_module_computer-use__runtime_navigate":
            frame();
            return result(true);
          default:
            throw new Error(`Unexpected tool: ${name}`);
        }
      },
    };
  });
  await page.goto("http://computer.test/");
  await expect(
    page.getByText(locale === "ru" ? "Не запущен" : "Not started", { exact: true }),
  ).toBeVisible();
}

test("pending viewer status stays single-flight instead of creating repeated approval requests", async ({
  page,
}) => {
  await page.clock.install();
  await openSurface(page);
  await page.evaluate(() => {
    const host = window as unknown as { holdStatus: boolean; desktopCalls: unknown[] };
    host.desktopCalls.length = 0;
    host.holdStatus = true;
  });
  await page.clock.runFor(3_100);
  expect(
    await page.evaluate(
      () => (window as unknown as { desktopCalls: unknown[] }).desktopCalls.length,
    ),
  ).toBe(1);
});

test("surface preserves ownership, exact screenshot coordinates and cached viewer observations", async ({
  page,
}) => {
  await openSurface(page);
  await page.setViewportSize({ width: 980, height: 780 });
  await page.getByRole("button", { name: "Start desktop", exact: true }).click();
  const image = page.getByAltText("Current desktop screenshot");
  await expect(image).toBeVisible();
  await image.click({ position: { x: 40, y: 40 } });
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { desktopCalls: Array<{ name: string }> }).desktopCalls.filter(
          (call) => call.name.endsWith("_interact"),
        ).length,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "Take control", exact: true }).click();
  await expect(page.getByRole("button", { name: "Return to agent", exact: true })).toBeVisible();
  await expect(image).toBeVisible();
  const box = await image.boundingBox();
  if (!box) throw new Error("Screenshot has no bounds");
  await image.dispatchEvent("click", {
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (
          window as unknown as { desktopCalls: Array<{ name: string; args: unknown }> }
        ).desktopCalls;
        return calls.findLast((call) => call.name.endsWith("_interact"))?.args;
      }),
    )
    .toMatchObject({ action: { type: "click" } });
  const sent = await page.evaluate(() => {
    const calls = (
      window as unknown as {
        desktopCalls: Array<{ name: string; args: { action: { x: number; y: number } } }>;
      }
    ).desktopCalls;
    return calls.findLast((call) => call.name.endsWith("_interact"))?.args.action;
  });
  // DOM mouse positions are integer CSS pixels; a fitted frame may map one pixel to several desktop pixels.
  expect(sent?.x).toBeCloseTo(640, -1);
  expect(sent?.y).toBeCloseTo(400, -1);
  await expect(image).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Return to agent", exact: true }).click();
  await expect(page.getByRole("button", { name: "Take control", exact: true })).toBeVisible();
  await page.getByLabel("Follow activity", { exact: true }).uncheck();
  const previousFrame = await image.getAttribute("src");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(image).toBeVisible();
  await expect.poll(async () => (await image.getAttribute("src")) !== previousFrame).toBe(true);
  expect(
    await page.evaluate(() => {
      const calls = (window as unknown as { desktopCalls: Array<{ name: string; args: unknown }> })
        .desktopCalls;
      return calls.at(-1);
    }),
  ).toMatchObject({ name: "mcp_module_computer-use__runtime_preview", args: {} });
});

test("returning control wins over a late manual input response", async ({ page }) => {
  await openSurface(page);
  await page.getByRole("button", { name: "Start desktop", exact: true }).click();
  await page.getByRole("button", { name: "Take control", exact: true }).click();
  await expect(page.getByAltText("Current desktop screenshot")).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { holdInput: boolean }).holdInput = true;
  });
  await page.getByLabel("Type on desktop", { exact: true }).fill("Late input");
  await page.getByRole("button", { name: "Type text", exact: true }).click();
  await expect(page.getByRole("button", { name: "Type text", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Return to agent", exact: true }).click();
  await expect(page.getByRole("button", { name: "Take control", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to agent", exact: true })).toBeHidden();
  await expect(page.locator("#state")).toHaveText("Agent has control");
});

test("human follow activity displays fresh previews and grounds input in the visible frame", async ({
  page,
}) => {
  await page.clock.install();
  await openSurface(page);
  await page.getByRole("button", { name: "Start desktop", exact: true }).click();
  await page.getByRole("button", { name: "Take control", exact: true }).click();
  const image = page.getByAltText("Current desktop screenshot");
  await expect(image).toBeVisible();
  const previousFrame = await image.getAttribute("src");
  await page.clock.runFor(1_100);
  await expect.poll(async () => (await image.getAttribute("src")) !== previousFrame).toBe(true);
  await expect(image).toBeVisible();
  await page.getByLabel("Follow activity", { exact: true }).uncheck();
  await image.click({ position: { x: 40, y: 40 } });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { desktopCalls: Array<{ name: string; args: unknown }> }
          ).desktopCalls.findLast((call) => call.name.endsWith("_interact"))?.args,
      ),
    )
    .toMatchObject({ observationId: "observation-3", action: { type: "click" } });
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await page.getByLabel("Follow activity", { exact: true }).check();
  await page.clock.runFor(1_000);
  await page.getByLabel("Follow activity", { exact: true }).uncheck();
  await expect(image).toBeVisible();
  await page.getByText("Pointer and browser controls", { exact: true }).click();
  await page.getByLabel("Open URL", { exact: true }).fill("https://example.com");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { desktopCalls: Array<{ name: string; args: unknown }> }
          ).desktopCalls.findLast((call) => call.name.endsWith("_navigate"))?.args,
      ),
    )
    .toMatchObject({ observationId: "observation-5", url: "https://example.com" });
});

test("desktop surface reflows with translated controls and keyboard input at both acceptance sizes", async ({
  page,
}) => {
  await openSurface(page, "ru");
  for (const size of [
    { width: 1480, height: 940 },
    { width: 1180, height: 640 },
  ]) {
    await page.setViewportSize(size);
    await page.screenshot({ path: test.info().outputPath(`computer-setup-${size.width}.png`) });
  }
  await page.getByRole("button", { name: "Запустить рабочий стол", exact: true }).click();
  await page.getByRole("button", { name: "Забрать управление", exact: true }).click();
  await expect(page.getByAltText("Текущий снимок рабочего стола")).toBeVisible();
  for (const size of [
    { width: 1480, height: 940 },
    { width: 1180, height: 640 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(size);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name: "Вернуть агенту", exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`computer-human-${size.width}.png`) });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name: "Вернуть агенту", exact: true }).focus();
  expect(
    await page
      .getByRole("button", { name: "Вернуть агенту", exact: true })
      .evaluate((node) => getComputedStyle(node).outlineStyle),
  ).toBe("solid");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Забрать управление", exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.lang = "uk";
    dispatchEvent(new Event("flecten.locale"));
  });
  await expect(
    page.getByRole("button", { name: "Перебрати керування", exact: true }),
  ).toBeVisible();
});
