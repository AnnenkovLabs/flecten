import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, test } from "@playwright/test";
import { type AppHarness, environmentProblem, launchApp } from "./fixtures";

const sizes = [
  [1480, 940],
  [1180, 640],
] as const;

async function resize(harness: AppHarness, [width, height]: readonly [number, number]) {
  await harness.app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
    },
    { width, height },
  );
  await harness.page.setViewportSize({ width, height });
}

async function colors(canvas: Locator) {
  return canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("Twin canvas is missing");
    const gl = element.getContext("webgl2");
    if (!gl) throw new Error("Twin requires a working WebGL2 renderer");
    const pixels = new Uint8Array(element.width * element.height * 4);
    gl.readPixels(0, 0, element.width, element.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let covered = 0;
    let colored = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if ((pixels[offset + 3] ?? 0) < 100) continue;
      covered++;
      const channels = [pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0];
      if (Math.max(...channels) - Math.min(...channels) > 10) colored++;
    }
    return { covered, colored };
  });
}

async function capture(canvas: Locator, name: string) {
  const data = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  await writeFile(
    test.info().outputPath(`${name}-canvas.png`),
    Buffer.from(data.split(",")[1] ?? "", "base64"),
  );
}

async function stopped(canvas: Locator) {
  await expect(canvas).toHaveAttribute("data-active", "false");
  await canvas.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  const frame = await canvas.getAttribute("data-frame");
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(await canvas.getAttribute("data-frame")).toBe(frame);
}

test("Twin can be rescued during goodbye, falls grey, and stays off after an app restart", async () => {
  test.setTimeout(120_000);
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const userData = await mkdtemp(join(tmpdir(), "twin-power-profile-"));
  const first = await launchApp({ locale: "en", userData });
  let restarted: AppHarness | undefined;
  try {
    const { page } = first;
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await resize(first, sizes[0]);
    await page.getByRole("button", { name: "Twin", exact: true }).click();
    const panel = page.getByTestId("twin-page");
    const power = panel.getByRole("switch", { name: "Use Twin in this project", exact: true });
    const portrait = panel.locator(".twin-portrait [data-testid='twin-character']");
    const canvas = portrait.locator("canvas");
    const input = portrait.getByRole("button", { name: "Interact with Twin", exact: true });
    const icon = page
      .getByRole("button", { name: "Twin", exact: true })
      .getByTestId("twin-character");
    await expect(power).toBeEnabled();
    await expect(power).toHaveAttribute("aria-checked", "false");
    await expect(portrait).toHaveAttribute("data-power", "disabled");
    await power.click();
    await expect(portrait).toHaveAttribute("data-power", "reviving");
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-hearts")))
      .toBeGreaterThan(0.4);
    await page.screenshot({ path: test.info().outputPath("twin-hearts-1480.png") });
    await expect(portrait).toHaveAttribute("data-power", "enabled");
    await expect(canvas).toHaveAttribute("data-renderer", "webgl");
    expect((await colors(canvas)).colored).toBeGreaterThan(100);
    const bounds = await power.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(100);

    await resize(first, sizes[1]);
    await input.focus();
    await input.press("ArrowRight");
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-yaw")))
      .toBeGreaterThan(0.15);

    // Svelte flushes its local state before Electron can return the configure response.
    const immediate = await power.evaluate(async (element) => {
      if (!(element instanceof HTMLButtonElement)) throw new Error("Twin switch is missing");
      let replied = false;
      const stop = window.desktop?.agent?.onEvent((event) => {
        if (event.type === "response") replied = true;
      });
      element.click();
      await Promise.resolve();
      await Promise.resolve();
      stop?.();
      return {
        pending: !replied,
        available: !element.disabled,
        phase: element.closest("[data-testid='twin-power']")?.getAttribute("data-phase"),
      };
    });
    expect(immediate).toEqual({ pending: true, available: true, phase: "pleading" });
    await expect(input).toBeDisabled();
    await expect(canvas).toHaveAttribute("data-yaw", "0");
    await expect(icon).toHaveAttribute("data-power", "pleading");
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-tears")))
      .toBeGreaterThan(0.8);
    await page.screenshot({ path: test.info().outputPath("twin-pleading-1180.png") });
    const yaw = await canvas.getAttribute("data-yaw");
    await input.dispatchEvent("keydown", { key: "ArrowRight" });
    await input.dispatchEvent("pointermove", { clientX: 10, clientY: 10, pointerId: 1 });
    await expect(canvas).toHaveAttribute("data-yaw", yaw ?? "0");
    await power.click();
    await expect(portrait).toHaveAttribute("data-power", "reviving");
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-hearts")))
      .toBeGreaterThan(0.4);
    await page.screenshot({ path: test.info().outputPath("twin-hearts-1180.png") });
    await expect(portrait).toHaveAttribute("data-power", "enabled");
    await expect(input).toBeEnabled();

    await resize(first, sizes[0]);
    await power.click();
    await expect(portrait).toHaveAttribute("data-power", "pleading");
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-tears")))
      .toBeGreaterThan(0.8);
    await page.screenshot({ path: test.info().outputPath("twin-pleading-1480.png") });
    await capture(canvas, "pleading");
    await expect(portrait).toHaveAttribute("data-power", "falling", { timeout: 20_000 });
    await expect(portrait).toHaveAttribute("data-power", "disabled");
    await expect(icon).toHaveAttribute("data-power", "disabled");
    await expect(canvas).toHaveAttribute("data-renderer", "webgl");
    await stopped(canvas);
    const fallen = await colors(canvas);
    await capture(canvas, "disabled");
    expect(fallen.covered).toBeGreaterThan(100);
    expect(fallen.colored / fallen.covered).toBeLessThan(0.01);
    for (const size of sizes) {
      await resize(first, size);
      await page.screenshot({ path: test.info().outputPath(`twin-fallen-${size[0]}.png`) });
      expect(await panel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        false,
      );
      await expect(power).toBeVisible();
    }
    await panel.getByRole("button", { name: "Your character", exact: false }).click();
    await expect(panel.getByTestId("twin-character")).toHaveAttribute("data-power", "disabled");
    await page.reload();
    await expect(icon).toHaveAttribute("data-power", "disabled");
    await first.app.close();

    restarted = await launchApp({ cwd: first.cwd, locale: "en", userData });
    await restarted.page.emulateMedia({ reducedMotion: "reduce" });
    const restartIcon = restarted.page
      .getByRole("button", { name: "Twin", exact: true })
      .getByTestId("twin-character");
    await expect(restartIcon).toHaveAttribute("data-power", "disabled");
    await restarted.page.getByRole("button", { name: "Twin", exact: true }).click();
    const restartPanel = restarted.page.getByTestId("twin-page");
    const restartPower = restartPanel.getByRole("switch", {
      name: "Use Twin in this project",
      exact: true,
    });
    const restartPortrait = restartPanel.locator(".twin-portrait [data-testid='twin-character']");
    await expect(restartPower).toHaveAttribute("aria-checked", "false");
    await expect(restartPortrait).toHaveAttribute("data-power", "disabled");
    const restore = await restartPortrait.locator("canvas").evaluateHandle((element) => {
      const extension = (element as HTMLCanvasElement)
        .getContext("webgl2")
        ?.getExtension("WEBGL_lose_context");
      if (!extension) throw new Error("WebGL context loss extension is unavailable");
      extension.loseContext();
      return () => extension.restoreContext();
    });
    const fallback = restartPortrait.locator("img");
    await expect(fallback).toHaveAttribute("src", "./twin/disabled.webp");
    await expect
      .poll(() => fallback.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBe(640);
    await restore.evaluate((restoreContext) => restoreContext());
    await restore.dispose();
    await expect(restartPortrait.locator("canvas")).toHaveAttribute("data-renderer", "webgl");
    await restartPower.click();
    await expect(restartPortrait).toHaveAttribute("data-power", "reviving");
    await expect
      .poll(async () => Number(await restartPortrait.locator("canvas").getAttribute("data-hearts")))
      .toBeGreaterThan(0.4);
    await stopped(restartPortrait.locator("canvas"));
    await capture(restartPortrait.locator("canvas"), "reviving");
    await expect(restartPortrait).toHaveAttribute("data-power", "enabled");
    await stopped(restartPortrait.locator("canvas"));
    expect(first.consoleErrors).toEqual([]);
    expect(restarted.consoleErrors).toEqual([]);
  } finally {
    await restarted?.close();
    await first.close();
    await rm(userData, { recursive: true, force: true });
  }
});
