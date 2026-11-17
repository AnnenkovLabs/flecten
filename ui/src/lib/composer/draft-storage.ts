import { z } from "zod";
import { snapshotSchema } from "./prompt-clipboard";

const attachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().nonnegative(),
  kind: z.enum(["audio", "image", "pdf", "text", "folder", "file"]),
  path: z.string().optional(),
});
const draftSchema = z.object({
  document: snapshotSchema,
  attachments: z.array(attachmentSchema),
});
export type SavedDraft = z.infer<typeof draftSchema>;
const PREFIX = "flecten.composer-draft.v1:";
const FOCUS_PREFIX = "flecten.composer-focus.v1:";
export const DRAFT_SAVE_DELAY_MS = 200;

/** Each dirty draft has its own record. Continuous typing never postpones the timer. */
// ponytail: Chromium commits cover renderer recovery; use durable native storage for power loss.
export class DraftStorage {
  readonly #pending = new Map<string, SavedDraft | null>();
  readonly #saved = new Map<string, string | null>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #failed = false;

  constructor(
    private readonly storage: () => Storage | undefined = () => globalThis.localStorage,
    private readonly onError: () => void = () => {},
  ) {}

  read(key: string): SavedDraft | null {
    try {
      const raw = this.storage()?.getItem(PREFIX + key) ?? null;
      if (raw === null) return null;
      const parsed = draftSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) throw new Error("Invalid composer draft");
      this.#saved.set(key, raw);
      return parsed.data;
    } catch {
      this.#error();
      return null;
    }
  }

  write(key: string, value: SavedDraft | null): void {
    this.#pending.set(key, value);
    this.#timer ??= setTimeout(() => this.flush(), DRAFT_SAVE_DELAY_MS);
  }

  flush = (): void => {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (!this.#pending.size) return;
    try {
      const storage = this.storage();
      if (!storage) throw new Error("Composer storage is unavailable");
      for (const [key, value] of this.#pending) {
        const raw = value ? JSON.stringify(value) : null;
        if (this.#saved.get(key) !== raw) {
          if (raw === null) storage.removeItem(PREFIX + key);
          else storage.setItem(PREFIX + key, raw);
          this.#saved.set(key, raw);
        }
        this.#pending.delete(key);
      }
      this.#failed = false;
    } catch {
      // Retain pending values for the next edit, navigation or lifecycle flush.
      this.#error();
    }
  };

  focus(project: string, task?: string): string | null {
    try {
      const storage = this.storage();
      if (task !== undefined) {
        if (storage?.getItem(FOCUS_PREFIX + project) !== task)
          storage?.setItem(FOCUS_PREFIX + project, task);
        return task;
      }
      const parsed = z
        .string()
        .min(1)
        .max(4096)
        .safeParse(storage?.getItem(FOCUS_PREFIX + project));
      return parsed.success ? parsed.data : null;
    } catch {
      this.#error();
      return null;
    }
  }

  listen(target: Window): () => void {
    const hidden = (): void => {
      if (target.document.visibilityState === "hidden") this.flush();
    };
    for (const event of ["blur", "pagehide", "beforeunload"])
      target.addEventListener(event, this.flush);
    target.document.addEventListener("visibilitychange", hidden);
    return () => {
      this.flush();
      for (const event of ["blur", "pagehide", "beforeunload"])
        target.removeEventListener(event, this.flush);
      target.document.removeEventListener("visibilitychange", hidden);
    };
  }

  #error(): void {
    if (!this.#failed) this.onError();
    this.#failed = true;
  }
}
