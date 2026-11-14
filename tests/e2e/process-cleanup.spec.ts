import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { processAlive } from "../helpers/process-alive";
import { launchApp } from "./fixtures";

test("killing Electron leaves no agent-owned background process", async () => {
  test.skip(
    process.platform !== "linux",
    "Linux parent-death integration; native jobs have platform fixtures",
  );
  const script =
    'await Bun.write("background.pid", String(process.pid)); setInterval(() => {}, 1000)';
  const harness = await launchApp({
    firstCalls: [{ name: "bash", arguments: { command: `bun -e '${script}'`, background: true } }],
    reply: "Фоновая задача запущена.",
  });
  let childPid = 0;
  try {
    const prompt = harness.page.locator("#prompt");
    await prompt.fill("Запусти фоновую задачу");
    await prompt.press("Enter");
    await harness.page.getByRole("button", { name: "Разрешить один раз", exact: true }).click();
    await expect
      .poll(async () => {
        try {
          childPid = Number(await readFile(join(harness.cwd, "background.pid"), "utf8"));
          return Number.isSafeInteger(childPid) && childPid > 0 && processAlive(childPid);
        } catch {
          return false;
        }
      })
      .toBe(true);
    await expect(harness.page.locator(".answer").last()).toBeVisible();
    expect(harness.app.process().kill("SIGKILL")).toBe(true);
    await expect.poll(() => processAlive(childPid), { timeout: 5000 }).toBe(false);
  } finally {
    if (childPid && processAlive(childPid)) process.kill(childPid, "SIGKILL");
    await harness.close();
  }
});
