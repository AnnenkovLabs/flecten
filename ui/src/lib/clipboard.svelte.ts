import { t } from "./i18n.svelte";
import { toast } from "./toast.svelte";

export const COPY_FEEDBACK_MS = 1400;

/** A copy is successful only after the clipboard accepts it. */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    toast.show(t("Copied"));
    return true;
  } catch {
    toast.error(t("Could not copy. Try again."));
    return false;
  }
}

export class CopyFeedback {
  copied = $state(false);
  pending = $state(false);
  #timer: ReturnType<typeof setTimeout> | undefined;
  #revision = 0;

  async copy(source: string | (() => string | Promise<string>)): Promise<void> {
    if (this.pending) return;
    const revision = ++this.#revision;
    clearTimeout(this.#timer);
    this.copied = false;
    this.pending = true;
    try {
      const text = typeof source === "function" ? await source() : source;
      if (revision !== this.#revision) return;
      const copied = await copyText(text);
      if (revision !== this.#revision) return;
      this.copied = copied;
      if (copied) this.#timer = setTimeout(() => (this.copied = false), COPY_FEEDBACK_MS);
    } catch (error) {
      if (revision === this.#revision) {
        toast.error(
          error instanceof Error ? error.message : t("Could not prepare the text. Try again."),
        );
      }
    } finally {
      if (revision === this.#revision) this.pending = false;
    }
  }

  dispose(): void {
    this.#revision += 1;
    clearTimeout(this.#timer);
  }
}
