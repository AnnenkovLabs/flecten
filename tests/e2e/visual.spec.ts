import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { type AppHarness, environmentProblem, launchApp, README_MARKER } from "./fixtures";

const PROMPT = "Прочитай README.md и покажи краткий итог.";
const SIZES = [
  [1480, 940],
  [1180, 640],
] as const;

function skipIfUnavailable(): void {
  const problem = environmentProblem();
  if (!problem) return;
  console.warn(`[e2e] skipped: ${problem}`);
  test.skip(true, problem);
}

async function setSize(harness: AppHarness, width: number, height: number): Promise<void> {
  await harness.app.evaluate(
    ({ BrowserWindow }, size: number[]) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size[0] ?? 0, size[1] ?? 0);
    },
    [width, height],
  );
  await harness.page.setViewportSize({ width, height });
  await expect
    .poll(() => harness.page.evaluate(() => [window.innerWidth, window.innerHeight]))
    .toEqual([width, height]);
  await harness.page.evaluate(() => document.fonts.ready.then(() => true));
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.mouse.move(1, 1);
}

async function waitForAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => {
      const duration = animation.effect?.getTiming().duration;
      return typeof duration === "number" && Number.isFinite(duration);
    });
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
}

async function scrollThreadToEnd(page: Page): Promise<void> {
  await waitForAnimations(page);
  await page.locator(".thread").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator("button.jump")).toHaveCount(0);
  await page.waitForTimeout(300);
}

async function sendPrompt(page: Page, prompt = PROMPT): Promise<void> {
  await page.locator("#prompt").fill(prompt);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.locator("#prompt")).toHaveText("");
}

async function expectSummary(page: Page): Promise<void> {
  const frame = page.locator("iframe.summary");
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("src", /^liquid-summary:\/\//);
  await expect(
    page.frameLocator("iframe.summary").getByRole("heading", { name: "README прочитан" }),
  ).toBeVisible();
  await page.waitForTimeout(800);
}

/** Changing parts (time, cost, paths, greeting) under `root`: the page or one modal dialog. */
function dynamicMasks(root: Page | Locator): Locator[] {
  return [
    root.locator(".msg-time"),
    root.locator(".answer-time"),
    root.locator(".context-meter"),
    root.locator(".lh-context"),
    root.locator(".state-dot"),
    root.locator(".run-live-dot"),
    root.locator("button.run-summary > span:nth-of-type(2)"),
    root.locator(".action-time"),
    root.locator(".detail-meta"),
    root.locator(".live-glow"),
    root.locator(".live-run"),
    root.locator(".scope-path"),
    root.locator(".ns-picker-path"),
    root.locator(".side-user"),
  ];
}

test("main thread with a tool call and HTML summary", async () => {
  skipIfUnavailable();
  const harness = await launchApp({ directory: "liquid-e2e-visual-thread", user: "e2e" });

  try {
    const { page } = harness;
    await expect(page.getByRole("region", { name: "Новая задача", exact: true })).toBeVisible();
    await sendPrompt(page);

    const runSummary = page.locator("button.run-summary").first();
    await expect(runSummary).toBeVisible({ timeout: 30_000 });
    await expectSummary(page);

    // The iframe can move the activity above the fold. Let Electron commit its scroll
    // before dispatching pointer input across the iframe's former screen coordinates.
    await runSummary.scrollIntoViewIfNeeded();
    await expect(runSummary).toBeInViewport();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    if ((await runSummary.getAttribute("aria-expanded")) !== "true") await runSummary.click();
    await expect(runSummary).toHaveAttribute("aria-expanded", "true");

    const toolRow = page.locator("button.action").filter({ hasText: "Чтение файла README.md" });
    await expect(toolRow).toBeVisible();
    if ((await toolRow.getAttribute("aria-expanded")) !== "true") await toolRow.click();
    await expect(
      page.locator(".detail-section").filter({ hasText: "Выход" }).locator("pre.code").first(),
    ).toContainText(README_MARKER);

    for (const [width, height] of SIZES) {
      await setSize(harness, width, height);
      await scrollThreadToEnd(page);
      await settle(page);
      await expect(page).toHaveScreenshot(`thread-${width}x${height}.png`, {
        mask: dynamicMasks(page),
        maxDiffPixelRatio: 0.004,
      });
    }

    expect(harness.consoleErrors, harness.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await harness.close();
  }
});

test("settings surface", async () => {
  skipIfUnavailable();
  const harness = await launchApp({ directory: "liquid-e2e-visual-settings", user: "e2e" });

  try {
    const { page } = harness;
    await expect(page.getByRole("region", { name: "Новая задача", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await expect(page.locator("dialog.settings-dialog")).toBeVisible();
    await expect(page.locator(".main-skeleton")).toBeHidden();
    await expect(page.locator('section[aria-labelledby="settings-general"]')).toBeVisible();

    for (const [width, height] of SIZES) {
      await setSize(harness, width, height);
      await settle(page);
      // The modal dialog covers the screen: masks of the new session screen behind it would
      // paint over the settings rows, so only the dialog's own dynamic parts are masked.
      await expect(page).toHaveScreenshot(`settings-${width}x${height}.png`, {
        mask: dynamicMasks(page.locator("dialog.settings-dialog")),
      });
    }

    expect(harness.consoleErrors, harness.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await harness.close();
  }
});

test("new session screen and empty state", async () => {
  skipIfUnavailable();
  const harness = await launchApp({ directory: "liquid-e2e-visual-new-session", user: "e2e" });

  try {
    const { page } = harness;
    await expect(page.getByRole("region", { name: "Новая задача", exact: true })).toBeVisible();
    await expect(page.locator(".ns-recent-empty")).toHaveText(
      "Здесь появятся задачи этого проекта.",
    );
    await expect(page.locator(".project-row")).toContainText("liquid-e2e-visual-new-session");

    for (const [width, height] of SIZES) {
      await setSize(harness, width, height);
      await settle(page);
      await expect(page).toHaveScreenshot(`new-session-${width}x${height}.png`, {
        mask: dynamicMasks(page),
      });
    }

    expect(harness.consoleErrors, harness.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await harness.close();
  }
});

test("reduced motion keeps the live run static", async () => {
  skipIfUnavailable();
  const harness = await launchApp({
    delayMs: 3000,
    holdSummary: true,
    directory: "liquid-e2e-visual-motion",
    user: "e2e",
  });

  try {
    const { page } = harness;
    await expect(page.getByRole("region", { name: "Новая задача", exact: true })).toBeVisible();
    await setSize(harness, 1180, 640);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await sendPrompt(page);

    await expect(page.locator(".live-run")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Остановка" })).toBeVisible();
    await expect(
      page.locator(".run-preview button.action").filter({ hasText: "Чтение файла README.md" }),
    ).toBeVisible({ timeout: 30_000 });

    await scrollThreadToEnd(page);
    await settle(page);
    await expect(page).toHaveScreenshot("reduced-motion-1180x640.png", {
      mask: dynamicMasks(page),
      maxDiffPixelRatio: 0.004,
    });

    expect(harness.consoleErrors, harness.consoleErrors.join("\n")).toEqual([]);
  } finally {
    await harness.close();
  }
});
