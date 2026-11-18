import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { SummaryInteractionDelivery } from "../../shared/summary-interaction";
import { type AppHarness, environmentProblem, launchApp, type Page } from "./fixtures";
import { hiddenScreenshot } from "./hidden-screenshot";

const prompt = "Compare the two implementation plans.";
const followUp = "Use that plan. Keep the  launch small, please.";
const modes: SummaryInteractionDelivery[] = [
  { when: "next-message" },
  { when: "on-action" },
  { when: "after-delay", delayMs: 4000 },
  { when: "after-first-interaction", delayMs: 500 },
];

function summary(delivery: SummaryInteractionDelivery): string {
  const onAction = delivery.when === "on-action";
  return `<summary>
<p class="lead">Two rollout plans are ready to compare.</p>
<h2>Rollout plan</h2>
<p>Basic plan: ship the smallest change first and check it with one group.</p>
<button type="button" id="preview">See details</button>
<button type="button" class="is-primary" id="select" data-plan="basic-plan-42">Choose basic plan</button>
${onAction ? '<button type="button" id="send-selection">Send selection</button>' : ""}
<p class="meta" id="selection-status" role="status"></p>
<script>
const summaryApi = window.flectenSummary;
summaryApi.deliver(${JSON.stringify(delivery)});
const status = document.getElementById('selection-status');
const select = document.getElementById('select');
document.getElementById('preview').addEventListener('click', () => {
  status.textContent = 'A small pilot group sees the change first.';
});
select.addEventListener('click', (event) => {
  if (event.isTrusted) {
    summaryApi.capture(event, 'oversized-value', 'x'.repeat(512));
    summaryApi.capture(event, 'plan-selected', select.dataset.plan);
  } else summaryApi.capture(event, 'fabricated-selection', true);
  status.textContent = event.isTrusted ? 'Basic plan selected.' : 'Synthetic click ran.';
});
document.getElementById('send-selection')?.addEventListener('click', (event) => summaryApi.flush(event));
status.textContent = 'Pick a plan to continue.';
</script>
</summary>`;
}

type WireRequest = Array<{ role: string; content: string | { text?: string }[] | null }>;

async function observe(harness: AppHarness): Promise<() => Promise<WireRequest[]>> {
  const config = JSON.parse(await readFile(join(harness.cwd, "flecten.config.json"), "utf8"));
  const port = new URL("/control/requests", config.providers.e2e.baseUrl);
  return async () => {
    const response = await fetch(port);
    expect(response.ok).toBe(true);
    return (await response.json()) as WireRequest[];
  };
}

function modelInput(request: WireRequest | undefined): string {
  return (request ?? [])
    .filter(({ role }) => role !== "assistant")
    .flatMap(({ content }) =>
      typeof content === "string" ? [content] : (content ?? []).map(({ text }) => text ?? ""),
    )
    .join("\n\n");
}

async function send(page: Page, text: string): Promise<void> {
  await page.locator("#prompt").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

async function savedPrompts(harness: AppHarness): Promise<string[]> {
  const root = join(harness.cwd, ".flecten/sessions");
  const session = (await readdir(root, { withFileTypes: true })).find(
    (entry) => entry.isDirectory() && !entry.name.endsWith("_worker"),
  );
  if (!session) throw new Error("Conversation was not saved");
  const journal = await readFile(join(root, session.name, "events.jsonl"), "utf8");
  return journal
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).event)
    .flatMap((event) =>
      event.type === "session.started" && !event.internal && typeof event.prompt === "string"
        ? [event.prompt]
        : [],
    );
}

for (const delivery of modes) {
  test(`HTML summary delivers selected interactions: ${delivery.when}`, async () => {
    const problem = environmentProblem();
    test.skip(Boolean(problem), problem);
    const harness = await launchApp({
      locale: "en",
      conversation: delivery.when !== "next-message",
      firstCalls: [],
      reply: summary(delivery),
      recordRequests: true,
    });
    try {
      const { page } = harness;
      const requests = await observe(harness);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await send(page, prompt);
      const frame = page.frameLocator("iframe.summary").first();
      const status = frame.getByRole("status");
      const select = frame.getByRole("button", { name: "Choose basic plan" });
      await expect(status).toHaveText("Pick a plan to continue.");
      await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
      expect(await requests()).toHaveLength(1);

      if (delivery.when === "next-message" || delivery.when === "on-action") {
        await frame.getByRole("button", { name: "See details" }).press("Enter");
        await expect(status).toContainText("A small pilot group");
        await select.evaluate((button) => (button as HTMLButtonElement).click());
        await expect(status).toHaveText("Synthetic click ran.");
        await frame.locator("#summary-root").evaluate(() => {
          parent.postMessage(
            {
              type: "flecten-summary",
              version: 1,
              kind: "interaction",
              interaction: { kind: "capture", name: "forged-event", value: "forged-selection" },
            },
            "*",
          );
        });
      }

      // Native keyboard activation provides a trusted click even in a minimized opaque frame.
      await select.press("Enter");
      await expect(status).toHaveText("Basic plan selected.");
      if (delivery.when === "next-message") {
        for (const [width, height] of [
          [1480, 940],
          [1180, 640],
        ] as const) {
          await harness.app.evaluate(
            ({ BrowserWindow }, size) =>
              BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height),
            { width, height },
          );
          await page.setViewportSize({ width, height });
          await status.scrollIntoViewIfNeeded();
          const fits = await frame.locator("#summary-root").evaluate((element) => {
            const viewport = element.ownerDocument.documentElement;
            return viewport.scrollWidth <= viewport.clientWidth;
          });
          expect(fits).toBe(true);
          await hiddenScreenshot(
            harness,
            test.info().outputPath(`html-interactions-${width}x${height}.png`),
          );
        }
        expect(await requests()).toHaveLength(1);
        await send(page, followUp);
      } else if (delivery.when === "on-action") {
        const flush = frame.getByRole("button", { name: "Send selection" });
        await flush.evaluate((button) => (button as HTMLButtonElement).click());
        expect(await requests()).toHaveLength(1);
        await flush.press("Enter");
      }

      await expect.poll(async () => (await requests()).length).toBe(2);
      const input = modelInput((await requests()).at(-1));
      expect(input).toContain("HTML summary interaction");
      expect(input).toContain("- Trust: `untrusted`");
      expect(input).toContain("plan-selected");
      expect(input).toContain("basic-plan-42");
      for (const rejected of [
        "fabricated-selection",
        "forged-selection",
        "oversized-value",
        "A small pilot group sees the change first.",
      ]) {
        expect(input).not.toContain(rejected);
      }
      await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
      if (delivery.when === "next-message") expect(input).toContain(followUp);
      if (delivery.when === "next-message") {
        await expect.poll(() => savedPrompts(harness)).toEqual([prompt, followUp]);
      }
      await expect(page.locator(".msg.user .bubble")).toHaveCount(
        delivery.when === "next-message" ? 2 : 1,
      );
      expect(harness.consoleErrors, harness.consoleErrors.join("\n")).toEqual([]);
    } finally {
      await harness.close();
    }
  });
}
