import { createHash } from "node:crypto";
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
    const session = join(h.cwd, ".flecten/sessions/twin-training-fixture");
    await mkdir(session, { recursive: true });
    await writeFile(join(session, "events.jsonl"), "{}\n");

    const { page } = h;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Twin", exact: true }).click();
    const panel = page.getByTestId("twin-page");
    await expect(panel.locator(".twin-source")).toHaveCount(10);
    await panel.getByRole("button", { name: "Scan sources", exact: true }).click();
    const source = panel.getByRole("checkbox", { name: "Learn from Flecten", exact: true });
    await expect(source).toBeEnabled();
    await source.check();
    await panel.getByRole("button", { name: "Train Twin", exact: true }).click();

    const ready = panel.getByText(
      "No new user messages found in selected sources. Skipped model call.",
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

    const saved = JSON.parse(await readFile(join(h.cwd, ".flecten/twin.json"), "utf8"));
    expect(saved.sourceIds).toEqual(["flecten"]);
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

test("Twin recovers from cancellation and malformed training, learns fenced JSON and uses the saved character", async () => {
  test.setTimeout(120_000);
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({ locale: "en", twinLearning: true, reply: "invalid JSON" });
  try {
    const quote = "Keep guest checkout on one screen. Registration annoys me.";
    const session = join(h.cwd, ".flecten/sessions/twin-workflow-fixture");
    await mkdir(session, { recursive: true });
    await writeFile(
      join(session, "events.jsonl"),
      JSON.stringify({ event: { type: "session.started", prompt: quote } }),
    );
    const config = JSON.parse(await readFile(join(h.cwd, "flecten.config.json"), "utf8"));
    const control = new URL("/control/twin", config.providers.e2e.baseUrl);
    const requests = async () => (await (await fetch(control)).json()).requests as number;
    const saved = async () => JSON.parse(await readFile(join(h.cwd, ".flecten/twin.json"), "utf8"));
    const { page } = h;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Twin", exact: true }).click();
    const panel = page.getByTestId("twin-page");
    await panel.getByRole("button", { name: "Scan sources", exact: true }).click();
    const source = panel.getByRole("checkbox", { name: "Learn from Flecten", exact: true });
    await source.check();
    const capture = async (state: string) => {
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
        expect(await panel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
          false,
        );
        await page.screenshot({
          path: test.info().outputPath(`twin-workflow-${state}-${width}.png`),
          animations: "disabled",
        });
      }
    };
    await capture("sources");
    await panel.getByRole("button", { name: "Back to task", exact: true }).click();
    await page.getByRole("button", { name: "Twin", exact: true }).click();
    await expect(source).toBeChecked();

    const train = panel.getByRole("button", { name: "Train Twin", exact: true });
    const learning = panel.getByTestId("twin-learning");
    await train.click();
    await expect(learning).toBeVisible();
    await learning.getByRole("button", { name: "Cancel training", exact: true }).click();
    await expect(learning).toHaveCount(0);
    await expect(
      panel.getByText("Training cancelled. Your existing character is unchanged.", { exact: true }),
    ).toBeVisible();
    expect((await saved()).entries).toHaveLength(0);
    await train.click();
    await expect(learning).toBeVisible();
    await h.releaseSummary();
    await expect(learning).toHaveCount(0);
    await expect(panel.getByRole("alert")).toBeVisible();
    expect((await saved()).training.state).toBe("error");
    expect((await saved()).entries).toHaveLength(0);

    const candidates = [
      {
        kind: "preference",
        reaction: "anger",
        strength: 3,
        voice: quote,
        summary: "Guest checkout without registration",
        content: "Keep guest checkout on one screen.",
        appliesWhen: "Designing checkout",
        evidence: [
          {
            sourceMessageId: `source-flecten-${createHash("sha256").update(quote).digest("hex").slice(0, 24)}`,
            quote,
          },
        ],
      },
    ];
    const response = await fetch(control, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ response: `\`\`\`json\n${JSON.stringify({ candidates })}\n\`\`\`` }),
    });
    expect(response.ok).toBe(true);
    await train.click();
    await expect.poll(async () => (await saved()).training.state).toBe("ready");
    await expect(learning).toHaveCount(0);
    await expect(panel.getByRole("alert")).toHaveCount(0);
    expect((await saved()).entries).toHaveLength(1);
    await expect(
      panel.getByRole("switch", { name: "Use Twin in this project", exact: true }),
    ).toBeChecked();
    await panel.getByRole("button", { name: "View your character", exact: true }).click();
    await expect(
      panel.getByRole("heading", { name: "Guest checkout without registration", exact: true }),
    ).toBeVisible();
    await capture("trained");
    await panel.getByRole("button", { name: "Edit", exact: true }).click();
    await panel.getByLabel("Your voice", { exact: true }).fill("");
    await panel.getByRole("button", { name: "Save character", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Save character", exact: true })).toHaveCount(0);
    expect((await saved()).entries[0]).toMatchObject({ revision: 2, voice: "" });

    await panel.getByRole("button", { name: "Sources", exact: true }).click();
    const beforeRepeat = await requests();
    await train.click();
    await expect.poll(async () => (await saved()).training.messages).toBe(0);
    await expect(learning).toHaveCount(0);
    expect(await requests()).toBe(beforeRepeat);
    expect((await saved()).entries).toHaveLength(1);

    await panel
      .getByRole("navigation", { name: "Twin sections" })
      .getByRole("button", { name: "Your character", exact: false })
      .click();
    await panel.getByRole("button", { name: "Remove trait", exact: true }).click();
    await panel
      .getByRole("alert")
      .getByRole("button", { name: "Remove trait", exact: true })
      .click();
    await expect(
      panel.getByRole("heading", { name: "Guest checkout without registration", exact: true }),
    ).toHaveCount(0);
    expect(await requests()).toBe(beforeRepeat);
    const otherProject = join(h.cwd, "other-project");
    await mkdir(otherProject);
    await writeFile(join(otherProject, "README.md"), "# Other Twin project\n");
    await page.evaluate(async (path) => {
      if (!window.desktop?.selectProject) throw new Error("Missing project bridge");
      await window.desktop.selectProject(path);
    }, otherProject);
    await expect(panel.locator(".twin-source")).toHaveCount(10);
    await expect(panel.getByRole("button", { name: "Sources", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      panel.getByText("Twin is unavailable. Reload to try again.", { exact: true }),
    ).toHaveCount(0);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
