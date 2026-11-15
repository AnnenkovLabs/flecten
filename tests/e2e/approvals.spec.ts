import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { AgentEvent } from "../../ui/src/lib/agent-protocol";
import { type AppHarness, environmentProblem, type LaunchOptions, launchApp } from "./fixtures";

const models = {
  "e2e-model": { name: "E2E Mock", context: 131072, output: 4096, tools: true, reasoning: false },
};

async function launchApprovalApp(options: LaunchOptions): Promise<AppHarness> {
  const h = await launchApp(options);
  try {
    await h.page.emulateMedia({ reducedMotion: "reduce" });
    await h.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.restore();
      window?.hide();
    });
    await expect(h.page.locator("#prompt")).toBeVisible();
    const trust = h.page.locator("dialog.project-trust");
    if (await trust.isVisible()) {
      await trust.getByRole("button", { name: "Do not trust", exact: true }).dispatchEvent("click");
      const confirm = trust.getByRole("button", { name: "Continue without trust", exact: true });
      if (await confirm.isVisible()) await confirm.dispatchEvent("click");
      await expect(trust).toBeHidden();
    }
    return h;
  } catch (error) {
    console.error(await h.page.locator("body").innerText(), h.consoleErrors);
    await h.close();
    throw error;
  }
}

async function capture(h: AppHarness, name: string, locator?: Locator): Promise<void> {
  // Native snapshots map a window, so only an explicitly private Xvfb display may capture them.
  if (process.env.FLECTEN_E2E_PRIVATE_DISPLAY !== "1") return;
  const bounds = await locator?.boundingBox();
  const rect = bounds
    ? {
        x: Math.floor(bounds.x),
        y: Math.floor(bounds.y),
        width: Math.ceil(bounds.width),
        height: Math.ceil(bounds.height),
      }
    : undefined;
  const image = await h.app.evaluate(
    async ({ BrowserWindow }, { region, privateDisplay }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) throw new Error("Approval fixture window is unavailable");
      if (privateDisplay) window.showInactive();
      try {
        return (await window.webContents.capturePage(region, { stayHidden: true, stayAwake: true }))
          .toPNG()
          .toString("base64");
      } finally {
        window.hide();
      }
    },
    { region: rect, privateDisplay: process.env.FLECTEN_E2E_PRIVATE_DISPLAY === "1" },
  );
  await writeFile(test.info().outputPath(name), Buffer.from(image, "base64"));
}

async function openAccessSettings(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Settings", exact: true }).dispatchEvent("click");
  const dialog = page.locator("dialog.settings-dialog");
  await dialog.getByRole("button", { name: "Access", exact: true }).dispatchEvent("click");
  await expect(dialog.locator("#settings-permissions")).toBeVisible();
  return dialog;
}

async function chooseAccessMode(page: Page, label: "Agent" | "Full access"): Promise<void> {
  const dialog = await openAccessSettings(page);
  const choice = dialog
    .getByRole("group", { name: "Access mode", exact: true })
    .getByRole("button")
    .filter({ has: page.getByText(label, { exact: true }) });
  await choice.dispatchEvent("click");
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  const save = dialog.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeEnabled();
  await save.dispatchEvent("click");
  await expect(dialog.getByText("Saved", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).dispatchEvent("click");
  await expect(dialog).toBeHidden();
}

test("approval scope, both viewports, persisted rule and revocation", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApprovalApp({
    models,
    locale: "en",
    firstCalls: [{ name: "bash", arguments: { command: "printf approval-system-ok" } }],
    reply: "Approval scope check complete.",
  });
  try {
    const { page } = h;
    await page.locator("#prompt").fill("Run the local command after my approval.");
    await page.getByRole("button", { name: "Send", exact: true }).dispatchEvent("click");
    const card = page.locator("section.approval").last();
    await expect(card).toBeVisible();
    await card.getByText("Details", { exact: true }).dispatchEvent("click");
    await expect(card.getByText("Working directory", { exact: true })).toBeVisible();
    await card.getByText("Details", { exact: true }).dispatchEvent("click");
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
      await expect(card.getByRole("button", { name: "Allow once", exact: true })).toBeInViewport({
        ratio: 1,
      });
      await expect(card.getByRole("button", { name: "Deny", exact: true })).toBeInViewport({
        ratio: 1,
      });
      await capture(h, `approval-${width}.png`);
      await capture(h, `approval-card-${width}.png`, card);
      const bounds = await card.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds?.height).toBeLessThan(240);
      expect((bounds?.x ?? -1) >= 0).toBe(true);
      expect((bounds?.x ?? 0) + (bounds?.width ?? width + 1)).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await card.getByText("More options", { exact: true }).dispatchEvent("click");
    await card.getByRole("button", { name: "Remember…", exact: true }).dispatchEvent("click");
    await expect(
      card.getByText("Only identical arguments, paths and working directory will match.", {
        exact: false,
      }),
    ).toBeVisible();
    await card.getByRole("button", { name: "Save exact rule", exact: true }).dispatchEvent("click");
    await expect(card.getByText("Allowed and saved", { exact: true })).toBeVisible();
    const config = JSON.parse(await readFile(join(h.cwd, "flecten.config.json"), "utf8"));
    expect(config.permissions.rules.length).toBe(1);
    expect(config.permissions.rules[0].requestKey).toHaveLength(64);
    expect(config.permissions.rules[0].cwd).toBe(h.cwd);
    await page.getByRole("button", { name: "Settings", exact: true }).dispatchEvent("click");
    const dialog = page.locator("dialog.settings-dialog");
    await dialog
      .locator(".rail")
      .getByRole("button", { name: "Access", exact: true })
      .dispatchEvent("click");
    await dialog.getByText("Advanced access settings", { exact: true }).dispatchEvent("click");
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
      await capture(h, `permission-settings-${width}.png`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await dialog.getByRole("button", { name: "Remove rule", exact: true }).dispatchEvent("click");
    await dialog.getByRole("button", { name: "Save", exact: true }).dispatchEvent("click");
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
  const h = await launchApprovalApp({
    models,
    locale: "en",
    firstCalls: [{ name: "bash", arguments: { command: "printf checkpoint-test" } }],
  });
  try {
    const { page } = h;
    await page.getByRole("button", { name: "Settings", exact: true }).dispatchEvent("click");
    const dialog = page.locator("dialog.settings-dialog");
    await dialog
      .locator(".rail")
      .getByRole("button", { name: "Access", exact: true })
      .dispatchEvent("click");
    await dialog.getByText("Advanced access settings", { exact: true }).dispatchEvent("click");
    await dialog
      .getByRole("group", { name: "Always ask a person", exact: true })
      .getByRole("checkbox", { name: "Terminal", exact: true })
      .dispatchEvent("click");
    await dialog.getByRole("button", { name: "Save", exact: true }).dispatchEvent("click");
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
    await dialog
      .getByRole("button", { name: "Close settings", exact: true })
      .dispatchEvent("click");
    await page.locator("#prompt").fill("Run the checkpoint command.");
    await page.getByRole("button", { name: "Send", exact: true }).dispatchEvent("click");
    const card = page.locator("section.approval").last();
    await card.getByText("Details", { exact: true }).dispatchEvent("click");
    await expect(
      card.getByText("Human approval required every time", { exact: true }),
    ).toBeVisible();
    await card.getByText("Details", { exact: true }).dispatchEvent("click");
    await expect(card.getByRole("button", { name: "For this chat", exact: true })).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "Repeat this action in this chat", exact: true }),
    ).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Remember…", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).dispatchEvent("click");
    await dialog
      .locator(".rail")
      .getByRole("button", { name: "Access", exact: true })
      .dispatchEvent("click");
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
      await queue.evaluate((node) => node.scrollIntoView({ block: "center" }));
      await capture(h, `approval-queue-${width}.png`);
    }
    await queue.getByText("More options", { exact: true }).dispatchEvent("click");
    const feedback =
      "Do not run this command. Inspect the existing output instead.\nKeep this instruction verbatim.";
    await queue
      .getByRole("textbox", { name: "Feedback for the agent", exact: true })
      .fill(feedback);
    await queue.getByRole("button", { name: "Deny", exact: true }).dispatchEvent("click");
    await expect(queue.locator(".perm-approval")).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Close settings", exact: true })
      .dispatchEvent("click");
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

test("Access settings persist the approval policy and execution boundary without a composer dropdown", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const h = await launchApprovalApp({ models, locale: "en" });
  try {
    const { page } = h;
    const config = async () =>
      JSON.parse(await readFile(join(h.cwd, "flecten.config.json"), "utf8"));
    await expect(page.locator(".composer-access")).toHaveCount(0);
    let dialog = await openAccessSettings(page);
    await expect(
      dialog.locator(".perm-preset-note").getByText("Custom access.", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).dispatchEvent("click");
    await chooseAccessMode(page, "Full access");
    await expect.poll(config).toMatchObject({
      permissions: { externalPath: "allow", destructive: "allow", shell: "allow" },
      sandbox: { enabled: false, allowNetwork: true },
    });
    await page.reload();
    dialog = await openAccessSettings(page);
    await expect(
      dialog
        .getByRole("group", { name: "Access mode", exact: true })
        .getByRole("button", { pressed: true }),
    ).toContainText("Full access");
    await dialog.getByRole("button", { name: "Close", exact: true }).dispatchEvent("click");
    await chooseAccessMode(page, "Agent");
    await expect.poll(config).toMatchObject({
      permissions: { externalPath: "ask", destructive: "ask", shell: "allow" },
      sandbox: { enabled: true, allowNetwork: true },
    });
    await page.reload();
    dialog = await openAccessSettings(page);
    await expect(
      dialog
        .getByRole("group", { name: "Access mode", exact: true })
        .getByRole("button", { pressed: true }),
    ).toContainText("Agent");
    await dialog.getByRole("button", { name: "Close", exact: true }).dispatchEvent("click");
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
  }
});

test("folder grants cover the chat and saved project scope without repeated requests", async () => {
  const problem = environmentProblem();
  test.skip(Boolean(problem), problem);
  const folder = await mkdtemp(join(tmpdir(), "liquid-e2e-external-"));
  const paths = [join(folder, "first.txt"), join(folder, "second.txt")];
  await Promise.all(paths.map((path, index) => writeFile(path, `External file ${index + 1}\n`)));
  const h = await launchApprovalApp({
    models,
    locale: "en",
    firstCalls: paths.map((path) => ({ name: "read", arguments: { path } })),
    reply: "Folder check complete.",
  });
  try {
    const { page } = h;
    const config = async () =>
      JSON.parse(await readFile(join(h.cwd, "flecten.config.json"), "utf8"));
    const send = async (prompt: string) => {
      await page.locator("#prompt").fill(prompt);
      await page.getByRole("button", { name: "Send", exact: true }).dispatchEvent("click");
    };
    const pending = page.locator("section.approval:not(.is-settled)");
    await chooseAccessMode(page, "Agent");
    await send("Read both files from the folder I approve for this chat.");
    await expect(pending).toHaveCount(1);
    await expect(pending.getByText("Allow folder access?", { exact: true })).toBeVisible();
    await expect(pending.locator(".approval-body > .approval-target")).toHaveText([folder]);
    await expect(pending.getByRole("button", { name: "Allow once", exact: true })).toBeVisible();
    await expect(
      pending.getByRole("button", { name: "Remember folder access", exact: true }),
    ).toBeVisible();
    await h.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 640),
    );
    await page.setViewportSize({ width: 1180, height: 640 });
    for (const label of ["For this chat", "Allow once", "Remember folder access", "Deny"]) {
      await expect(pending.getByRole("button", { name: label, exact: true })).toBeInViewport({
        ratio: 1,
      });
    }
    await pending
      .getByRole("button", { name: "For this chat", exact: true })
      .dispatchEvent("click");
    await expect(
      page.getByText("Файл прочитан. Folder check complete.", { exact: true }).last(),
    ).toBeVisible();
    await expect(pending).toHaveCount(0);
    await expect(page.locator("section.approval")).toHaveCount(1);
    expect((await config()).permissions.rules).toEqual([]);

    await page.getByRole("button", { name: "New task", exact: true }).dispatchEvent("click");
    await send("Read the same two files in this new chat.");
    await expect(pending).toHaveCount(1);
    await expect(pending.locator(".approval-body > .approval-target")).toHaveText([folder]);
    await pending
      .getByRole("button", { name: "Remember folder access", exact: true })
      .dispatchEvent("click");
    await expect(
      page.getByText("Файл прочитан. Folder check complete.", { exact: true }).last(),
    ).toBeVisible();
    await expect(pending).toHaveCount(0);
    await expect
      .poll(async () => (await config()).permissions.rules)
      .toEqual([
        expect.objectContaining({ action: "external_path", pathPrefix: folder, policy: "allow" }),
      ]);
    expect((await config()).permissions.rules[0].requestKey).toBeUndefined();

    await page.getByRole("button", { name: "New task", exact: true }).dispatchEvent("click");
    await send("Use the saved project folder grant to read the files again.");
    await expect(
      page.getByText("Файл прочитан. Folder check complete.", { exact: true }).last(),
    ).toBeVisible();
    await expect(page.locator("section.approval")).toHaveCount(0);
    const sessions = join(h.cwd, ".liquid", "sessions");
    await expect
      .poll(async () => {
        const events = (
          await Promise.all(
            (
              await readdir(sessions, { withFileTypes: true })
            )
              .filter((entry) => entry.isDirectory())
              .map(async (session) => {
                const text = await readFile(join(sessions, session.name, "events.jsonl"), "utf8");
                return text
                  .split("\n")
                  .filter(Boolean)
                  .map((line) => (JSON.parse(line) as { event: AgentEvent }).event);
              }),
          )
        ).flat();
        const reads = events.filter(
          (event) => event.type === "tool.finished" && event.call.name === "read",
        );
        return {
          reads: reads.length,
          successful: reads.filter((event) => event.type === "tool.finished" && event.result.ok)
            .length,
          approvals: events.filter((event) => event.type === "approval.requested").length,
        };
      })
      .toEqual({ reads: 6, successful: 6, approvals: 2 });
    expect(h.consoleErrors).toEqual([]);
  } finally {
    await h.close();
    await rm(folder, { recursive: true, force: true });
  }
});
