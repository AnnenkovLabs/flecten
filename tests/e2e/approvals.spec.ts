import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { environmentProblem, launchApp } from "./fixtures";

const models = {
  "e2e-model": { name: "E2E Mock", context: 131072, output: 4096, tools: true, reasoning: false },
};

test("approval scope, both viewports, persisted rule and revocation", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({
    models,
    locale: "en",
    firstCalls: [{ name: "bash", arguments: { command: "printf approval-system-ok" } }],
  });
  try {
    const { page } = h;
    await page.locator("#prompt").fill("Run the local command after my approval.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const card = page.locator("section.approval").last();
    await expect(card).toBeVisible();
    await card.getByText("Details", { exact: true }).click();
    await expect(card.getByText("Working directory", { exact: true })).toBeVisible();
    await card.getByText("Details", { exact: true }).click();
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
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: test.info().outputPath(`approval-${width}.png`),
        animations: "disabled",
      });
      await card.screenshot({
        path: test.info().outputPath(`approval-card-${width}.png`),
        animations: "disabled",
      });
      const bounds = await card.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds?.height).toBeLessThan(240);
      expect((bounds?.x ?? -1) >= 0).toBe(true);
      expect((bounds?.x ?? 0) + (bounds?.width ?? width + 1)).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await card.getByText("More options", { exact: true }).click();
    await card.getByRole("button", { name: "Remember…", exact: true }).click();
    await expect(card.getByText("Only this action in this folder.", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Save exact rule", exact: true }).click();
    await expect(card.getByText("Allowed and saved", { exact: true })).toBeVisible();
    const config = JSON.parse(await readFile(join(h.cwd, "flecten.config.json"), "utf8"));
    expect(config.permissions.rules.length).toBe(1);
    expect(config.permissions.rules[0].requestKey).toHaveLength(64);
    expect(config.permissions.rules[0].cwd).toBe(h.cwd);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    await dialog.locator(".rail").getByRole("button", { name: "Permissions", exact: true }).click();
    await expect(dialog.getByText("Exact arguments and resources", { exact: true })).toBeVisible();
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
      await page.screenshot({
        path: test.info().outputPath(`permission-settings-${width}.png`),
        animations: "disabled",
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await dialog.getByRole("button", { name: "Remove rule", exact: true }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(h.cwd, "flecten.config.json"), "utf8")).permissions.rules
            .length,
      )
      .toBe(0);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});

test("mandatory checkpoint and queued denial preserve human feedback", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApp({
    models,
    locale: "en",
    firstCalls: [{ name: "bash", arguments: { command: "printf checkpoint-test" } }],
  });
  try {
    const { page } = h;
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.locator("dialog.settings-dialog");
    await dialog.locator(".rail").getByRole("button", { name: "Permissions", exact: true }).click();
    await dialog
      .getByRole("group", { name: "Always ask a person", exact: true })
      .getByRole("checkbox", { name: "Terminal", exact: true })
      .check();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(async () =>
        JSON.parse(
          await readFile(join(h.cwd, "flecten.config.json"), "utf8"),
        ).permissions.rules.some(
          (rule: { action: string; checkpoint?: boolean }) =>
            rule.action === "shell" && rule.checkpoint,
        ),
      )
      .toBe(true);
    await dialog.getByRole("button", { name: "Close settings", exact: true }).click();
    await page.locator("#prompt").fill("Run the checkpoint command.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const card = page.locator("section.approval").last();
    await card.getByText("Details", { exact: true }).click();
    await expect(
      card.getByText("Human approval required every time", { exact: true }),
    ).toBeVisible();
    await card.getByText("Details", { exact: true }).click();
    await expect(card.getByRole("button", { name: "For this chat", exact: true })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Remember…", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await dialog.locator(".rail").getByRole("button", { name: "Permissions", exact: true }).click();
    const queue = dialog.locator(".perm-approvals");
    await expect(queue.locator(".perm-approval")).toHaveCount(1);
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
      await queue.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: test.info().outputPath(`approval-queue-${width}.png`),
        animations: "disabled",
      });
    }
    await queue.getByText("More options", { exact: true }).click();
    const feedback =
      "Do not run this command. Inspect the existing output instead.\nKeep this instruction verbatim.";
    await queue
      .getByRole("textbox", { name: "Feedback for the agent", exact: true })
      .fill(feedback);
    await queue.getByRole("button", { name: "Deny", exact: true }).click();
    await expect(queue.locator(".perm-approval")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close settings", exact: true }).click();
    await expect(card.getByText("Denied", { exact: true })).toBeVisible();
    const sessions = join(h.cwd, ".liquid", "sessions");
    await expect
      .poll(async () => {
        for (const session of await readdir(sessions)) {
          const events = await readFile(join(sessions, session, "events.jsonl"), "utf8").catch(
            () => "",
          );
          if (
            events
              .split("\n")
              .filter(Boolean)
              .some((line) => {
                const { event } = JSON.parse(line);
                return event?.type === "approval.resolved" && event.feedback === feedback;
              })
          )
            return true;
        }
        return false;
      })
      .toBe(true);
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});
