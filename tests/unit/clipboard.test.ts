import { afterEach, expect, test } from "bun:test";
import "../helpers/svelte-runes";
import type { CopyFeedback as Feedback } from "../../ui/src/lib/clipboard.svelte";

const { CopyFeedback, copyText } = await import("../../ui/src/lib/clipboard.svelte");
const { toast } = await import("../../ui/src/lib/toast.svelte");

const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
let feedback: Feedback | undefined;

function clipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText } },
  });
}

afterEach(() => {
  feedback?.dispose();
  feedback = undefined;
  toast.dispose();
  for (const item of toast.items) toast.dismiss(item.id);
  if (original) Object.defineProperty(globalThis, "navigator", original);
  else Reflect.deleteProperty(globalThis, "navigator");
});

test("copy feedback waits for the clipboard and preserves the original text", async () => {
  let complete: (() => void) | undefined;
  let received = "";
  clipboard(
    (text) =>
      new Promise<void>((resolve) => {
        received = text;
        complete = resolve;
      }),
  );
  feedback = new CopyFeedback();
  const writing = feedback.copy("  точный текст\n");
  expect(feedback.pending).toBe(true);
  expect(feedback.copied).toBe(false);
  expect(received).toBe("  точный текст\n");
  complete?.();
  await writing;
  expect(feedback.pending).toBe(false);
  expect(feedback.copied).toBe(true);
  expect(toast.items.at(-1)?.text).toBe("Скопировано");
});

test("clipboard refusal never reports success and permits another attempt", async () => {
  clipboard(async () => {
    throw new Error("clipboard denied");
  });
  feedback = new CopyFeedback();
  await feedback.copy("путь/к/файлу");
  expect(feedback.copied).toBe(false);
  expect(feedback.pending).toBe(false);
  expect(toast.items.at(-1)?.tone).toBe("error");
  clipboard(async () => {});
  await feedback.copy("путь/к/файлу");
  expect(feedback.copied).toBe(true);
});

test("disposing during asynchronous report preparation cancels copying", async () => {
  let complete: ((text: string) => void) | undefined;
  let writes = 0;
  clipboard(async () => {
    writes += 1;
  });
  feedback = new CopyFeedback();
  const copying = feedback.copy(
    () =>
      new Promise<string>((resolve) => {
        complete = resolve;
      }),
  );
  feedback.dispose();
  complete?.("diagnostics");
  await copying;
  expect(writes).toBe(0);
  expect(feedback.copied).toBe(false);
});

test("empty content and failed report preparation do not write or show a check", async () => {
  let writes = 0;
  clipboard(async () => {
    writes += 1;
  });
  expect(await copyText("")).toBe(false);
  feedback = new CopyFeedback();
  await feedback.copy(async () => {
    throw new Error("Повторите сборку отчёта.");
  });
  expect(feedback.pending).toBe(false);
  expect(feedback.copied).toBe(false);
  expect(writes).toBe(0);
  expect(toast.items.at(-1)?.text).toBe("Повторите сборку отчёта.");
});
