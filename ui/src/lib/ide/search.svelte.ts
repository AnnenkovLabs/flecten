import { z } from "zod";
import { requestAgent } from "../desktop";
import { t } from "../i18n.svelte";

const Match = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  text: z.string(),
  length: z.number().int().positive(),
});
const Result = z.object({
  matches: z.array(Match),
  limited: z.boolean(),
  filesSearched: z.number().int().nonnegative(),
});
export type SearchMatch = z.infer<typeof Match>;
const PlannedFile = z.object({
  path: z.string(),
  expectedHash: z.string(),
  count: z.number().int().positive(),
});
export class IdeSearch {
  replacement = $state("");
  plan = $state<{
    query: string;
    include: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    replacement: string;
    files: z.infer<typeof PlannedFile>[];
  } | null>(null);
  query = $state("");
  include = $state("");
  caseSensitive = $state(false);
  wholeWord = $state(false);
  busy = $state(false);
  error = $state<string | null>(null);
  result = $state<z.infer<typeof Result> | null>(null);
  #ticket = 0;
  async find(): Promise<void> {
    const ticket = ++this.#ticket;
    this.error = null;
    if (!this.query) {
      this.result = null;
      this.busy = false;
      return;
    }
    this.busy = true;
    try {
      const response = await requestAgent(
        {
          type: "files.search",
          query: this.query,
          include: this.include,
          caseSensitive: this.caseSensitive,
          wholeWord: this.wholeWord,
        },
        15_000,
      );
      if (ticket === this.#ticket) this.result = Result.parse(response.search);
    } catch (error) {
      if (ticket === this.#ticket)
        this.error = t("Search failed. {0}. Try searching again.", [
          error instanceof Error ? error.message : String(error),
        ]);
    } finally {
      if (ticket === this.#ticket) this.busy = false;
    }
  }
  async previewReplace(): Promise<void> {
    const ticket = ++this.#ticket;
    this.busy = true;
    this.error = null;
    const options = {
      query: this.query,
      include: this.include,
      caseSensitive: this.caseSensitive,
      wholeWord: this.wholeWord,
      replacement: this.replacement,
    };
    try {
      const response = await requestAgent(
        { type: "files.replace", action: "preview", ...options },
        15_000,
      );
      const result = z.object({ files: z.array(PlannedFile) }).parse(response.replacement);
      if (ticket === this.#ticket) this.plan = { ...options, files: result.files };
    } catch (error) {
      if (ticket === this.#ticket) this.error = String(error);
    } finally {
      if (ticket === this.#ticket) this.busy = false;
    }
  }
  async applyReplace(blocked: string[]): Promise<void> {
    if (!this.plan) return;
    if (this.plan.files.some((file) => blocked.includes(file.path))) {
      this.error = t("First, save or close the modified files in the replacement list.");
      return;
    }
    this.busy = true;
    const ticket = ++this.#ticket;
    this.error = null;
    try {
      const response = await requestAgent(
        { type: "files.replace", action: "apply", ...$state.snapshot(this.plan) },
        30_000,
      );
      const result = z
        .object({
          completed: z.array(z.string()),
          errors: z.array(z.object({ path: z.string(), message: z.string() })),
        })
        .parse(response.replacement);
      if (ticket !== this.#ticket) return;
      this.plan = null;
      if (result.errors.length)
        this.error = t("Files saved: {0}. {1}", [
          result.completed.length,
          result.errors.map((error) => `${error.path}: ${error.message}`).join("; "),
        ]);
      this.result = null;
    } catch (error) {
      if (ticket === this.#ticket) this.error = String(error);
    } finally {
      if (ticket === this.#ticket) this.busy = false;
    }
  }
  reset(): void {
    this.plan = null;
    this.replacement = "";
    this.#ticket += 1;
    this.query = "";
    this.include = "";
    this.result = null;
    this.busy = false;
    this.error = null;
  }
}
