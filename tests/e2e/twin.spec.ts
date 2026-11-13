import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator, test } from "@playwright/test";
import type { TwinActivityEvent } from "../../shared/twin-activity";
import { environmentProblem, launchApp } from "./fixtures";

async function pixels(canvas: Locator) {
  return canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("Twin must render to canvas");
    const gl = element.getContext("webgl2");
    if (!gl) throw new Error("Twin must use a real WebGL2 context");
    const data = new Uint8Array(element.width * element.height * 4);
    gl.readPixels(0, 0, element.width, element.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    let hash = 2166136261;
    let covered = 0;
    let colored = 0;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      if ((data[index + 3] ?? 0) > 0) covered++;
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 10) colored++;
      for (let offset = 0; offset < 4; offset++)
        hash = Math.imul(hash ^ (data[index + offset] ?? 0), 16777619);
    }
    return { hash: hash >>> 0, covered, colored, width: element.width };
  });
}

async function assertStopped(canvas: Locator) {
  await expect(canvas).toHaveAttribute("data-active", "false");
  await canvas.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const frame = await canvas.getAttribute("data-frame");
  // Observe beyond several 24fps intervals: no idle work may survive pause/reduced motion.
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(
    await canvas.getAttribute("data-frame"),
    JSON.stringify(
      await canvas.evaluate((element) => ({
        width: element.clientWidth,
        height: element.clientHeight,
        parentWidth: element.parentElement?.clientWidth,
        parentHeight: element.parentElement?.clientHeight,
        attributes: (element as HTMLElement).dataset,
      })),
    ),
  ).toBe(frame);
}

test("Twin live 3D, interactions and character workflow stay usable at both desktop sizes", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({
    locale: "en",
    reply: "Checkout review completed.",
    models: {
      "e2e-model": {
        context: 131072,
        output: 4096,
        tools: true,
        reasoning: false,
      },
    },
  });
  try {
    const { page } = h;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Twin", exact: true }).click();
    const panel = page.getByTestId("twin-page");
    await expect(
      panel.getByRole("heading", { name: "Same ideas. Same thoughts.", exact: true }),
    ).toBeVisible();
    await expect(panel.locator(".twin-source")).toHaveCount(9);
    const character = panel.locator(".twin-portrait [data-testid='twin-character']");
    const canvas = character.locator("canvas");
    const input = character.getByRole("button", { name: "Interact with Twin", exact: true });
    await expect(canvas).toHaveAttribute("data-renderer", "webgl");
    const original = await pixels(canvas);
    expect(original.covered).toBeGreaterThan(100);
    expect(original.colored).toBeGreaterThan(100);
    await expect(character.locator("img")).toHaveCount(0);
    await assertStopped(canvas);
    await input.hover({ position: { x: 32, y: 32 } });
    await expect.poll(async () => (await pixels(canvas)).hash).not.toBe(original.hash);
    const gaze = await pixels(canvas);
    expect(gaze.width).toBe(original.width);
    const box = await input.boundingBox();
    if (!box) throw new Error("Twin interaction surface is missing");
    await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + (box.width * 2) / 3, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await pixels(canvas)).hash).not.toBe(gaze.hash);
    const turned = await pixels(canvas);
    await input.focus();
    await input.press("ArrowRight");
    await expect.poll(async () => (await pixels(canvas)).hash).not.toBe(turned.hash);
    await input.press("Home");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const frame = Number(await canvas.getAttribute("data-frame"));
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-frame")))
      .toBeGreaterThan(frame + 1);
    await character.getByRole("button", { name: "Pause motion", exact: true }).click();
    await assertStopped(canvas);
    const paused = await pixels(canvas);
    await input.press("ArrowLeft");
    await expect.poll(async () => (await pixels(canvas)).hash).not.toBe(paused.hash);
    await assertStopped(canvas);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await character.getByRole("button", { name: "Resume motion", exact: true }).click();
    await assertStopped(canvas);
    const restore = await canvas.evaluateHandle((element) => {
      const extension = (element as HTMLCanvasElement)
        .getContext("webgl2")
        ?.getExtension("WEBGL_lose_context");
      if (!extension) throw new Error("WebGL context loss extension is unavailable");
      extension.loseContext();
      return () => extension.restoreContext();
    });
    await expect(canvas).toHaveAttribute("data-renderer", "fallback");
    await expect(character.locator("img")).toBeVisible();
    await restore.evaluate((restoreContext) => restoreContext());
    await restore.dispose();
    await expect(canvas).toHaveAttribute("data-renderer", "webgl");
    expect((await pixels(canvas)).colored).toBeGreaterThan(100);
    await expect(character.locator("img")).toHaveCount(0);
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await h.app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height),
        { width, height },
      );
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: test.info().outputPath(`twin-sources-${width}.png`) });
      expect(await panel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        false,
      );
      await expect(panel.getByRole("button", { name: "Scan sources", exact: true })).toBeVisible();
    }
    const result = await page.evaluate(async () => {
      const requestId = crypto.randomUUID();
      return new Promise<boolean>((resolve) => {
        const stop = window.desktop?.agent?.onEvent((event) => {
          if (event.type === "response" && event.requestId === requestId) {
            stop?.();
            resolve(event.ok);
          }
        });
        window.desktop?.agent?.send({
          type: "twin.teach",
          requestId,
          summary: "No registration for checkout",
          content: "Keep checkout on one screen without registration.",
          appliesWhen: "Designing checkout",
          reaction: "anger",
          strength: 3,
          voice: "Меня бесит регистрация. Убери её.",
        });
      });
    });
    expect(result).toBe(true);
    await panel.getByRole("button", { name: "Back to task", exact: true }).click();
    await page.getByRole("button", { name: "Twin", exact: true }).click();
    await panel.getByRole("button", { name: "Your character", exact: false }).click();
    await expect(
      panel.getByRole("heading", { name: "No registration for checkout", exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByText("Меня бесит регистрация. Убери её.", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("twin-character-1180.png") });
    await panel.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Save character", exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("twin-edit-1180.png") });
    await panel.getByRole("button", { name: "Cancel", exact: true }).click();
    await panel.getByRole("button", { name: "Remove trait", exact: true }).click();
    await expect(
      panel.getByText("Remove this trait from Twin? Original history is kept."),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Cancel", exact: true }).click();
    await panel.getByRole("button", { name: "Back to task", exact: true }).click();
    await page.locator("#prompt").fill("Review the checkout and keep it on one screen.");
    await page.locator("#prompt").press("Enter");
    await expect(page.locator(".run-check")).toBeVisible();
    const sessions = await readdir(join(h.cwd, ".liquid/sessions"), { withFileTypes: true });
    const sessionId = sessions.find((entry) => entry.isDirectory())?.name;
    if (!sessionId) throw new Error("The checkout review did not create a task session");
    const work = page.getByTestId("twin-work");
    let previousEmotionHash = 0;
    for (const [emotion, voice, instructions, corrections] of [
      [
        "angry",
        "Меня бесит регистрация. Убери её.",
        "Remove registration and keep guest checkout on one screen.",
        1,
      ],
      [
        "furious",
        "Ты опять добавил регистрацию. Я же просил убрать её!",
        "Remove the account step. Verify guest checkout before returning the result.",
        2,
      ],
    ] as const) {
      const event: TwinActivityEvent = {
        type: "twin.activity",
        sessionId,
        activity: {
          phase: "final",
          state: "revise",
          emotion,
          voice,
          instructions,
          entryIds: [],
          corrections,
          provider: "e2e",
          model: "e2e-model",
          usage: { input: 240, output: 60, cached: 120 },
        },
      };
      await h.app.evaluate(({ BrowserWindow }, payload) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send("agent:event", payload);
      }, event);
      await expect(work).toBeVisible();
      await expect(work).toHaveAttribute("data-state", "revise");
      await expect(work.locator(".work-round")).toHaveText(`Corrections: ${corrections} / 4`);
      const portrait = work.locator("canvas");
      await expect(portrait).toHaveAttribute("data-emotion", emotion);
      await expect(portrait).toHaveAttribute("data-renderer", "webgl");
      await assertStopped(portrait);
      const rendered = await pixels(portrait);
      expect(rendered.colored).toBeGreaterThan(20);
      expect(rendered.hash).not.toBe(previousEmotionHash);
      previousEmotionHash = rendered.hash;
      if ((await work.getAttribute("open")) === null) {
        await work.locator(":scope > summary").click();
      }
      const latest = work.locator(".work-dialogue article").last();
      await expect(latest.locator("blockquote")).toHaveText(voice);
      await latest.getByText("Instructions to Worker", { exact: true }).click();
      await expect(latest.locator("details p")).toHaveText(instructions);
      for (const [width, height] of [
        [1480, 940],
        [1180, 640],
      ] as const) {
        await h.app.evaluate(
          ({ BrowserWindow }, size) =>
            BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height),
          { width, height },
        );
        await page.setViewportSize({ width, height });
        await latest.scrollIntoViewIfNeeded();
        await expect(latest.locator("details p")).toBeVisible();
        expect(
          await work.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        ).toBe(true);
        expect(
          await work
            .locator(".work-dialogue")
            .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        ).toBe(true);
        await page.screenshot({
          path: test.info().outputPath(`twin-work-${emotion}-${width}.png`),
          animations: "disabled",
        });
      }
      await latest.getByText("Instructions to Worker", { exact: true }).click();
    }
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
