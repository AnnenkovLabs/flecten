import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";

test("Twin trains selected sources through the Electron bridge without a clone error", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({ locale: "en" });
  try {
    // Metadata-only session exercises the complete import path without calling a model.
    const session = join(h.cwd, ".liquid/sessions/twin-training-fixture");
    await mkdir(session, { recursive: true });
    await writeFile(join(session, "events.jsonl"), "{}\n");

    const { page } = h;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Twin", exact: true }).click();
    const panel = page.getByTestId("twin-page");
    await expect(panel.locator(".twin-source")).toHaveCount(9);
    await panel.getByRole("button", { name: "Scan sources", exact: true }).click();
    const source = panel.getByRole("checkbox", { name: "Learn from Liquid Harness", exact: true });
    await expect(source).toBeEnabled();
    await source.check();
    await panel.getByRole("button", { name: "Train Twin", exact: true }).click();

    const ready = panel.getByText(
      "Twin is ready. Learned traits apply immediately and you can edit them.",
      { exact: false },
    );
    await expect
      .poll(async () => {
        const alert = panel.getByRole("alert");
        if ((await alert.count()) > 0) return await alert.first().innerText();
        return (await ready.count()) > 0 ? "ready" : "waiting";
      })
      .toBe("ready");
    await expect(panel.getByRole("alert")).toHaveCount(0);
    await expect(source).toBeChecked();

    const saved = JSON.parse(await readFile(join(h.cwd, ".liquid/twin.json"), "utf8"));
    expect(saved.sourceIds).toEqual(["liquid"]);
    expect(saved.training).toMatchObject({
      state: "ready",
      messages: 0,
      usage: { input: 0, output: 0, cached: 0 },
    });

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
      await ready.scrollIntoViewIfNeeded();
      expect(await panel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        false,
      );
      await expect(ready).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath(`twin-training-${width}.png`),
        animations: "disabled",
      });
    }
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
