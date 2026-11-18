import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import { setProjectTrust } from "../../shared/project-index.cjs";
import { launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

test("projectless entry, remembered folders and sessions survive navigation and sidebar removal", async () => {
  const first = await mkdtemp(join(tmpdir(), "flecten-project-one-"));
  const second = await mkdtemp(join(tmpdir(), "flecten-project-two-"));
  const h = await launchApp({
    locale: "en",
    projectless: true,
    appProfile: true,
    reply: "Task completed.",
  });
  try {
    const { page } = h;
    const sidebar = page.getByRole("complementary", { name: "Projects and tasks", exact: true });
    const standaloneChat = sidebar.getByRole("button", {
      name: "Task without a project, done",
      exact: true,
    });
    const standaloneSection = sidebar.getByRole("button", {
      name: "Separate chats",
      exact: true,
    });
    const sidebarOrder = sidebar
      .locator(".project-select:visible, .task-title:visible")
      .or(standaloneSection);
    await expect(sidebar.getByRole("button", { name: "Add folder", exact: true })).toHaveCount(0);
    await expect(page.getByText("No project selected", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Add a folder to work on a project. You can also start a task without one."),
    ).toBeVisible();
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
      await hiddenScreenshot(h, test.info().outputPath(`projectless-${width}.png`));
    }
    await page.locator("#prompt").fill("Task without a project");
    await page.locator("#prompt").press("Enter");
    await expect(page.locator(".thread")).toContainText("Task completed.");
    await expect(standaloneSection).toHaveAttribute("aria-expanded", "true");
    await expect(standaloneChat).toBeVisible();
    await expect(sidebarOrder).toHaveText(["Separate chats", "Task without a project"]);
    await sidebar.getByRole("button", { name: "New task", exact: true }).click();
    await page.locator("#prompt").fill("Another independent task");
    await page.locator("#prompt").press("Enter");
    await expect(page.locator(".thread")).toContainText("Task completed.");
    for (const [directory, prompt] of [
      [first, "Task in first project"],
      [second, "Task in second project"],
    ] as const) {
      await h.app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      }, directory);
      await sidebar.getByRole("button", { name: "New task", exact: true }).click();
      await page.locator(".ns-picker-trigger").click();
      await page.getByRole("button", { name: "Select folder", exact: true }).click();
      const trust = page.getByRole("dialog", { name: "Do you trust this folder?" });
      await expect(trust).toContainText(directory);
      await trust.getByRole("button", { name: "Trust folder", exact: true }).click();
      await expect(trust).toHaveCount(0);
      await page.locator("#prompt").fill(prompt as string);
      await page.locator("#prompt").press("Enter");
      await expect(page.locator(".thread")).toContainText("Task completed.");
    }
    const mixedOrder = [
      basename(first),
      "Task in first project",
      basename(second),
      "Task in second project",
      "Separate chats",
      "Another independent task",
      "Task without a project",
    ];
    await expect(sidebarOrder).toHaveText(mixedOrder);
    await standaloneSection.press("Enter");
    await expect(standaloneSection).toHaveAttribute("aria-expanded", "false");
    await expect(standaloneChat).toBeHidden();
    const search = sidebar.getByRole("textbox", { name: "Search tasks", exact: true });
    await search.fill("Task without a project");
    await expect(standaloneSection).toHaveAttribute("aria-expanded", "true");
    await expect(sidebarOrder).toHaveText(["Separate chats", "Task without a project"]);
    await standaloneChat.click();
    await expect(page.locator(".thread")).toContainText("Task without a project");
    await search.press("Escape");
    await expect(sidebarOrder).toHaveText(mixedOrder.slice(0, -2));
    await page.getByRole("button", { name: "Task in first project, done", exact: true }).click();
    await expect(page.locator(".thread")).toContainText("Task in first project");
    await page.reload();
    await expect(standaloneSection).toHaveAttribute("aria-expanded", "false");
    await expect(standaloneChat).toBeHidden();
    await standaloneSection.click();
    await expect(sidebarOrder).toHaveText(mixedOrder);
    await expect(page.locator("dialog.project-trust")).toHaveCount(0);
    await page
      .locator(".project-select")
      .filter({ hasText: basename(first) })
      .click({ button: "right" });
    await page.getByRole("button", { name: "Remove from sidebar", exact: true }).click();
    await expect(standaloneChat).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".thread")).toContainText("Task without a project");
    await expect(sidebarOrder).toHaveText(mixedOrder.slice(2));
    expect(existsSync(join(first, ".flecten/sessions"))).toBe(true);
    expect(existsSync(join(first, "flecten.config.json"))).toBe(false);
    expect(existsSync(join(second, "flecten.config.json"))).toBe(false);
    expect(h.consoleErrors).toEqual([]);
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
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      await hiddenScreenshot(h, test.info().outputPath(`project-navigation-${width}.png`));
      await standaloneSection.click();
      await expect(standaloneChat).toBeHidden();
      await hiddenScreenshot(h, test.info().outputPath(`standalone-collapsed-${width}.png`));
      await standaloneSection.click();
      await expect(standaloneChat).toBeVisible();
    }
  } finally {
    await h.close();
    await Promise.all([first, second].map((path) => rm(path, { recursive: true, force: true })));
  }
});

async function seedChats(folder: string, count: number): Promise<void> {
  const path = join(folder, ".flecten", "sessions");
  await mkdir(path, { recursive: true });
  const project = basename(folder);
  const sessions = Array.from({ length: count }, (_, index) => {
    const id = String(index + 1).padStart(2, "0");
    const title = `${project} chat ${id}`;
    const date = new Date(Date.now() - (index + 1) * 60_000).toISOString();
    return {
      id: `fixture-${id}`,
      title,
      project,
      createdAt: date,
      updatedAt: date,
      stopReason: "done",
      messageCount: 2,
      lastPrompt: title,
    };
  });
  await writeFile(join(path, "index.json"), JSON.stringify({ version: 2, sessions }));
}

test("Agent folders cap their own chats and stay visible while reordered", async () => {
  const root = await mkdtemp(join(tmpdir(), "flecten-sidebar-"));
  const profile = join(root, "profile");
  const projects = ["Atlas", "Beacon", "Cedar", "Drift", "Ember", "Fern", "Garden"];
  try {
    for (const name of projects) {
      const path = join(root, name);
      await mkdir(path);
      setProjectTrust(profile, path, "trusted");
    }
    await seedChats(join(root, "Atlas"), 15);
    await seedChats(join(root, "Beacon"), 6);
    const h = await launchApp({
      locale: "en",
      projectless: true,
      appProfile: true,
      userData: profile,
      reply: "Task completed.",
    });
    try {
      const { page } = h;
      const sidebar = page.getByRole("complementary", { name: "Projects and tasks", exact: true });
      const rows = sidebar.locator(".project-row");
      const project = (name: string) => page.getByRole("group", { name, exact: true });
      const folder = (name: string) => project(name).getByRole("button", { name, exact: true });
      const group = (name: string) =>
        sidebar.locator(".project-group").filter({ has: project(name) });
      const atlasChats = group("Atlas").locator(".task-row");
      const beaconChats = group("Beacon").locator(".task-row");
      const more = group("Atlas").getByRole("button", { name: "Show More", exact: true });
      const less = group("Atlas").getByRole("button", { name: "Show Less", exact: true });
      const search = sidebar.getByRole("textbox", { name: "Search tasks", exact: true });
      const gardenPencil = project("Garden").getByRole("button", {
        name: "New task in Garden",
        exact: true,
      });
      const gardenOptions = project("Garden").getByRole("button", {
        name: "Project options",
        exact: true,
      });
      const expectOrder = (names: string[]) =>
        expect
          .poll(() =>
            rows.evaluateAll((elements) => elements.map((el) => el.getAttribute("aria-label"))),
          )
          .toEqual(names);
      const capture = async (state: string, hoverAtlas = false) => {
        for (const [width, height] of [
          [1480, 940],
          [1180, 640],
        ] as const) {
          await page.setViewportSize({ width, height });
          if (hoverAtlas) await folder("Atlas").hover();
          else await page.mouse.move(340, 48);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
          ).toBeLessThanOrEqual(1);
          await hiddenScreenshot(
            h,
            test.info().outputPath(`agent-folders-${state}-${width}x${height}.png`),
          );
        }
      };

      await expectOrder(projects);
      await expect(atlasChats).toHaveCount(5);
      await expect(beaconChats).toHaveCount(5);
      await more.click();
      await expect(atlasChats).toHaveCount(7);
      await expect(beaconChats).toHaveCount(5);
      await folder("Beacon").click();
      await expect(beaconChats).toHaveCount(0);
      await expectOrder(projects);
      await capture("expanded", true);
      await more.click();
      await expect(atlasChats).toHaveCount(14);
      await more.click();
      await expect(atlasChats).toHaveCount(15);
      await expect(more).toHaveCount(0);
      await less.click();
      await expect(atlasChats).toHaveCount(5);

      await folder("Atlas").click();
      await expect(folder("Atlas")).toHaveAttribute("aria-expanded", "false");
      await expect(atlasChats).toHaveCount(0);
      const restoreRandom = await page.evaluateHandle(() => {
        const random = Math.random;
        Math.random = () => 0.099;
        return random;
      });
      await folder("Atlas").press("Enter");
      await expect(atlasChats).toHaveCount(5);
      const stage = group("Atlas").locator("canvas.sidebar-rescue-stage");
      const rescuedRows = group("Atlas").locator(".task");
      await expect(stage).toBeVisible();
      await restoreRandom.evaluate((random) => {
        Math.random = random;
      });
      await restoreRandom.dispose();
      await expect(rescuedRows.first()).toBeHidden();
      await expect(rescuedRows.last()).toHaveAttribute("data-rescue-card", "pull");
      await expect(rescuedRows.last()).toHaveAttribute("data-rescue-card", "stack");
      await rescuedRows.last().locator(".task-row").focus();
      await expect(stage).toBeVisible();
      await folder("Atlas").click();
      await expect(stage).toHaveCount(0);
      await search.fill("Atlas chat 15");
      await expect(atlasChats).toHaveCount(1);
      await expect(atlasChats).toContainText("Atlas chat 15");
      await search.press("Escape");
      await expect(atlasChats).toHaveCount(0);
      await expectOrder(projects);
      await capture("compact");

      await expect(gardenPencil).toHaveCSS("opacity", "0");
      await expect(gardenOptions).toHaveCSS("opacity", "0");
      await folder("Garden").focus();
      await page.keyboard.press("Tab");
      await expect(gardenPencil).toBeFocused();
      await expect(gardenPencil).toHaveCSS("opacity", "1");
      await expect(gardenOptions).toHaveCSS("opacity", "1");
      await gardenPencil.click();
      await expect(project("Garden").and(sidebar.locator(".project-row.is-current"))).toBeVisible();
      await page.locator("#prompt").fill("Garden notes");
      await page.locator("#prompt").press("Enter");
      await expect(page.locator(".thread")).toContainText("Task completed.");
      await expect(group("Garden").locator(".task-row")).toContainText("Garden notes");

      await folder("Garden").dragTo(project("Atlas"), {
        steps: 10,
        targetPosition: { x: 80, y: 5 },
      });
      await expectOrder(["Garden", ...projects.slice(0, 6)]);
      await folder("Garden").dragTo(project("Cedar"), {
        steps: 10,
        targetPosition: { x: 80, y: 27 },
      });
      await expectOrder(["Atlas", "Beacon", "Cedar", "Garden", "Drift", "Ember", "Fern"]);
      await expect(page.locator(".thread")).toContainText("Garden notes");

      await folder("Garden").hover();
      await gardenOptions.click();
      await page.getByRole("button", { name: "Move up", exact: true }).press("Enter");
      const moved = ["Atlas", "Beacon", "Garden", "Cedar", "Drift", "Ember", "Fern"];
      await expectOrder(moved);
      await page.reload();
      await expect(folder("Atlas")).toHaveAttribute("aria-expanded", "false");
      await expectOrder(moved);
      await page.getByRole("button", { name: "IDE", exact: true }).click();
      await expect(page.locator(".explorer")).toBeVisible();
      await expect(sidebar).toBeHidden();
      expect(h.consoleErrors).toEqual([]);
    } finally {
      await h.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
