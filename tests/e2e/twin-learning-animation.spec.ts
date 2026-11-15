import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";

async function stopped(scene: Locator, canvas: Locator) {
  await expect(canvas).toHaveAttribute("data-active", "false");
  await canvas.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const before = [await scene.getAttribute("data-frame"), await canvas.getAttribute("data-frame")];
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect([await scene.getAttribute("data-frame"), await canvas.getAttribute("data-frame")]).toEqual(
    before,
  );
}

test("Twin learns through the real bridge with trailer cards, synchronized pause and reduced motion", async () => {
  test.setTimeout(180_000);
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({ locale: "en", twinLearning: true });
  try {
    const quotes = [
      "Keep checkout on one screen.",
      "Use the existing project colors.",
      "Make the primary action clear.",
      "Keep the typography readable.",
      "Preserve the original user message.",
      "Show the actual result before delivery.",
      "Keep navigation in the same place.",
      "Avoid adding unnecessary settings.",
      "Verify the small window layout.",
      "Use the real project state.",
      "Respect my motion preference.",
      "Keep errors easy to understand.",
      "Let me cancel long operations.",
      "Reuse the existing components.",
      "Use exact source evidence.",
      "Deliver the working change.",
    ];
    const session = join(h.cwd, ".liquid/sessions/twin-learning-fixture");
    await mkdir(session, { recursive: true });
    await writeFile(
      join(session, "events.jsonl"),
      quotes
        .map((prompt) => JSON.stringify({ event: { type: "session.started", prompt } }))
        .join("\n"),
    );
    const { page } = h;
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("button", { name: "Twin", exact: true }).click();
    const panel = page.getByTestId("twin-page");
    await panel.getByRole("button", { name: "Scan sources", exact: true }).click();
    await panel.getByRole("checkbox", { name: "Learn from Liquid Harness", exact: true }).check();
    await page.screenshot({ path: test.info().outputPath("twin-before-learning.png") });
    await panel.getByRole("button", { name: "Train Twin", exact: true }).click();
    const scene = panel.getByTestId("twin-learning");
    const cards = scene.getByTestId("twin-learning-card");
    const canvas = scene.locator("canvas");
    await expect(scene).toBeVisible();
    // Keep the brief entrance observable on software renderers, then pause it through the UI.
    await expect
      .poll(() =>
        scene.evaluate(
          (element) =>
            element
              .getAnimations({ subtree: true })
              .filter((animation) => !(animation instanceof CSSAnimation)).length,
        ),
      )
      .toBe(2);
    await scene.evaluate((element) => {
      for (const animation of element.getAnimations({ subtree: true })) {
        if (animation instanceof CSSAnimation) continue;
        animation.currentTime = 50;
        animation.playbackRate = 0.01;
      }
    });
    await scene.getByRole("button", { name: "Pause motion", exact: true }).press("Enter");
    await expect
      .poll(() =>
        scene.evaluate((element) =>
          element
            .getAnimations({ subtree: true })
            .filter((animation) => !(animation instanceof CSSAnimation))
            .map((animation) => animation.playState),
        ),
      )
      .toEqual(["paused", "paused"]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(() =>
        scene.evaluate(
          (element) =>
            element
              .getAnimations({ subtree: true })
              .filter((animation) => !(animation instanceof CSSAnimation)).length,
        ),
      )
      .toBe(0);
    await scene.getByRole("button", { name: "Resume motion", exact: true }).press("Enter");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(canvas).toHaveAttribute("data-renderer", "webgl");
    await expect
      .poll(async () =>
        (await cards.allTextContents()).some((value) =>
          quotes.some((quote) => value.includes(quote)),
        ),
      )
      .toBe(true);
    await expect(canvas).toHaveAttribute("data-active", "true");
    await expect
      .poll(
        async () => {
          const frame = Number(await scene.getAttribute("data-frame"));
          return frame >= 1355;
        },
        { intervals: [20] },
      )
      .toBe(true);
    await scene.getByRole("button", { name: "Pause motion", exact: true }).press("Enter");
    await stopped(scene, canvas);

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
      await expect(scene).toBeVisible();
      expect(await panel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        false,
      );
      const box = await scene.boundingBox();
      expect(box).not.toBeNull();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height);
      await page.screenshot({ path: test.info().outputPath(`twin-learning-${width}.png`) });
    }

    await scene.getByRole("button", { name: "Resume motion", exact: true }).press("Enter");
    const resumeFrame = await scene.getAttribute("data-frame");
    await expect.poll(() => scene.getAttribute("data-frame")).not.toBe(resumeFrame);
    await expect(canvas).toHaveAttribute("data-active", "true");
    // Keep the real WebGL renderer within CI raster capacity; layout was checked at both sizes.
    const graphics = await page.context().newCDPSession(page);
    await graphics.send("Emulation.setDeviceMetricsOverride", {
      width: 1180,
      height: 640,
      deviceScaleFactor: 0.25,
      mobile: false,
    });
    // Advance beyond three old film loops, including on slow software WebGL renderers.
    const continuity = await scene.evaluate(async (element) => {
      const samples: Array<{ frame: number; visible: number[] }> = [];
      const firstFrame = Number((element as HTMLElement).dataset.frame);
      const until = performance.now() + 90_000;
      while (performance.now() < until) {
        const stage = element.getBoundingClientRect();
        const visible = [
          ...element.querySelectorAll<HTMLElement>("[data-testid='twin-learning-card']"),
        ]
          .filter((card) => {
            const box = card.getBoundingClientRect();
            return (
              Number(getComputedStyle(card).opacity) > 0.05 &&
              box.width > 2 &&
              box.height > 2 &&
              box.right > stage.left &&
              box.left < stage.right &&
              box.bottom > stage.top &&
              box.top < stage.bottom
            );
          })
          .map((card) => Number(card.dataset.cardId));
        samples.push({ frame: Number((element as HTMLElement).dataset.frame), visible });
        if (Number((element as HTMLElement).dataset.frame) - firstFrame >= 732) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return samples;
    });
    await writeFile(
      test.info().outputPath("twin-learning-continuity.json"),
      JSON.stringify(continuity, null, 2),
    );
    expect(continuity.length).toBeGreaterThan(0);
    expect((continuity.at(-1)?.frame ?? 0) - (continuity[0]?.frame ?? 0)).toBeGreaterThanOrEqual(
      732,
    );
    expect(
      continuity.every((sample, index) => sample.frame >= (continuity[index - 1]?.frame ?? 0)),
    ).toBe(true);
    expect(continuity.every((sample) => sample.visible.length > 0)).toBe(true);
    expect(continuity.flatMap((sample) => sample.visible).every(Number.isFinite)).toBe(true);
    expect(Math.max(...continuity.flatMap((sample) => sample.visible))).toBeGreaterThan(15);
    await graphics.send("Emulation.clearDeviceMetricsOverride");
    await graphics.detach();
    await page.screenshot({ path: test.info().outputPath("twin-learning-continuous.png") });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stopped(scene, canvas);
    await scene.getByRole("button", { name: "Cancel training", exact: true }).click();
    await expect(scene).toHaveCount(0);
    await expect(
      panel.getByText("Training cancelled. Your existing character is unchanged.", { exact: true }),
    ).toBeVisible();

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await panel.getByRole("button", { name: "Train Twin", exact: true }).click();
    await expect(scene).toBeVisible();
    await h.releaseSummary();
    await expect(scene).toHaveCount(0);
    await expect(
      panel.getByText("Training finished. No supported traits were found.", {
        exact: false,
      }),
    ).toBeVisible();
    const saved = JSON.parse(await readFile(join(h.cwd, ".liquid/twin.json"), "utf8"));
    expect(saved.training).toMatchObject({ state: "ready", sessions: 1, messages: 16 });
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
