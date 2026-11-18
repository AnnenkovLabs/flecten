import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { type AppHarness, launchApp } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

test("mandatory upgrade keeps focus, retries and resumes after restart before acceptance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flecten-migration-ui-"));
  const cwd = join(directory, "project");
  const userData = join(directory, "profile");
  await mkdir(join(cwd, ".liquid"), { recursive: true });
  await writeFile(join(cwd, ".liquid", "saved.bin"), "original data");
  await writeFile(
    join(cwd, "flecten.config.json"),
    JSON.stringify({
      useDefaults: false,
      provider: "test",
      model: "test",
      providers: {
        test: {
          protocol: "openai-chat",
          baseUrl: "http://127.0.0.1:9/v1",
          models: { test: { context: 32768, output: 4096, tools: true } },
        },
      },
      catalog: { autoRefresh: false },
    }),
  );
  let h: AppHarness | undefined;
  try {
    h = await launchApp({ cwd, userData, locale: "en", migration: "manual" });
    const { page } = h;
    const dialog = page.locator("dialog.storage-migration");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading")).toHaveText("Upgrade session storage");
    await page.keyboard.press("Escape");
    await page.mouse.click(10, 100);
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Control+n");
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
    }
    for (const [width, height] of [
      [1480, 940],
      [1180, 640],
    ] as const) {
      await page.setViewportSize({ width, height });
      await hiddenScreenshot(h, test.info().outputPath(`migration-${width}x${height}.png`));
      const box = await dialog.locator(".migration-content").boundingBox();
      expect(box).not.toBeNull();
      expect((box?.x ?? -1) >= 0 && (box?.y ?? -1) >= 0).toBe(true);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height);
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }
    // A recoverable filesystem failure stays in the same mandatory screen.
    await writeFile(
      join(cwd, ".flecten-migration/v1/engine.lock"),
      JSON.stringify({ pid: process.pid, token: "test-holder" }),
    );
    await dialog.getByRole("button", { name: "Start migration", exact: true }).click();
    await expect(dialog.getByRole("heading")).toHaveText("Storage upgrade paused");
    await expect(dialog.getByRole("alert")).toContainText("already running");
    await rm(join(cwd, ".flecten-migration/v1/engine.lock"));
    await dialog.getByRole("button", { name: "Retry migration", exact: true }).click();
    await expect(dialog.getByRole("heading")).toHaveText("Session storage upgraded");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    expect(await readFile(join(cwd, ".flecten/saved.bin"), "utf8")).toBe("original data");
    expect(
      await readFile(join(cwd, ".flecten-migration/v1/originals/legacy/saved.bin"), "utf8"),
    ).toBe("original data");
    expect(await BunFileExists(join(cwd, ".flecten-migration/v1/accepted.json"))).toBe(false);
    if (process.platform === "linux") {
      // Observe the replacement core, without sending a command that could start it.
      await page.evaluate(() => {
        const bridge = window.desktop?.agent;
        if (!bridge) throw new Error("Bridge unavailable");
        let exited = false;
        const off = bridge.onEvent((event) => {
          if (event.type === "agent.exit") exited = true;
          if (!exited || event.type !== "storage.migration") return;
          if (event.migration.phase !== "complete") return;
          document.documentElement.dataset.testMigrationResumed = "true";
          off();
        });
      });
      const parent = await h.app.evaluate(() => process.pid);
      const children = await readFile(`/proc/${parent}/task/${parent}/children`, "utf8");
      let killed = 0;
      for (const value of children.trim().split(" ")) {
        if (!value) continue;
        const pid = Number(value);
        if ((await readFile(`/proc/${pid}/comm`, "utf8")).trim() !== "flecten-agent") continue;
        process.kill(pid, "SIGKILL");
        killed = pid;
        break;
      }
      expect(killed).toBeGreaterThan(0);
      await expect(page.locator("html")).toHaveAttribute("data-test-migration-resumed", "true");
      await expect(dialog.getByRole("heading")).toHaveText("Session storage upgraded");
    }
    expect(h.consoleErrors).toEqual([]);
    await h.close();
    h = undefined;
    h = await launchApp({ cwd, userData, locale: "en", migration: "manual" });
    const resumed = h.page.locator("dialog.storage-migration");
    await expect(resumed.getByRole("heading")).toHaveText("Session storage upgraded");
    await resumed.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(resumed).toHaveCount(0);
    await expect(h.page.locator("#prompt")).toBeVisible();
    expect(h.consoleErrors).toEqual([]);
    await h.close();
    h = undefined;
    h = await launchApp({ cwd, userData, locale: "en", migration: "manual" });
    await expect(h.page.locator("#prompt")).toBeVisible();
    await expect(h.page.locator("dialog.storage-migration")).toHaveCount(0);
  } finally {
    await h?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

async function BunFileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
