import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { TwinActivityEvent } from "../../shared/twin-activity";
import { environmentProblem, launchApp } from "./fixtures";

test("Twin sources, character edits and original poses stay usable at both desktop sizes", async () => {
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
    await page.getByRole("button", { name: "Twin", exact: true }).click();
    const panel = page.getByTestId("twin-page");
    await expect(
      panel.getByRole("heading", { name: "Same ideas. Same thoughts.", exact: true }),
    ).toBeVisible();
    await expect(panel.locator(".twin-source")).toHaveCount(9);
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
      const portrait = work.locator(`img[src='./twin/${emotion}.webp']`);
      await expect(portrait).toBeVisible();
      await expect
        .poll(() =>
          portrait.evaluate(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
          ),
        )
        .toBe(true);
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
