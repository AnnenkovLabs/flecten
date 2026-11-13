import {
  type DictionaryEntry,
  DictionaryEntrySchema,
  type DictionaryRecord,
  type DictionarySnapshot,
  DictionarySnapshotSchema,
} from "../../../shared/dictionary";
import { requestAgent } from "./desktop";
import { t } from "./i18n.svelte";

export interface DictionaryDraft {
  id: string;
  term: string;
  category: string;
  aliases: string;
  definition: string;
  clarification: string;
  sources: string;
  expectedRevision: number;
}

export function dictionaryDraftEntry(draft: DictionaryDraft): DictionaryEntry {
  const lines = (value: string) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  return DictionaryEntrySchema.parse({
    id: draft.id,
    term: draft.term,
    category: draft.category,
    aliases: lines(draft.aliases),
    definition: draft.definition,
    ...(draft.clarification.trim() ? { clarification: draft.clarification } : {}),
    sources: lines(draft.sources),
  });
}

export class DictionaryStore {
  snapshot = $state<DictionarySnapshot | null>(null);
  scope = $state<"public" | "local">("public");
  query = $state("");
  category = $state("");
  loading = $state(false);
  busy = $state(false);
  error = $state("");
  draft = $state<DictionaryDraft | null>(null);
  deleting = $state<DictionaryRecord | null>(null);
  #generation = 0;

  get entries(): DictionaryRecord[] {
    const query = this.query.trim().normalize("NFKC").toLocaleLowerCase();
    return (this.snapshot?.entries ?? [])
      .filter(
        (entry) =>
          entry.source === this.scope &&
          (!this.category || entry.category === this.category) &&
          (!query ||
            [entry.term, ...entry.aliases, entry.definition, entry.clarification ?? ""].some(
              (value) => value.normalize("NFKC").toLocaleLowerCase().includes(query),
            )),
      )
      .sort((a, b) => a.term.localeCompare(b.term));
  }

  get categories(): string[] {
    return [
      ...new Set(["general", ...(this.snapshot?.entries ?? []).map((entry) => entry.category)]),
    ].sort();
  }

  hasLocal(id: string): boolean {
    return (
      this.snapshot?.entries.some((entry) => entry.id === id && entry.source === "local") ?? false
    );
  }

  edit(entry?: DictionaryRecord): void {
    const local =
      entry &&
      this.snapshot?.entries.find((item) => item.id === entry.id && item.source === "local");
    const current = local ?? entry;
    this.error = "";
    this.deleting = null;
    this.draft = {
      id: current?.id ?? `term-${crypto.randomUUID()}`,
      term: current?.term ?? "",
      category: current?.category ?? "general",
      aliases: current?.aliases.join("\n") ?? "",
      definition: current?.definition ?? "",
      clarification: current?.clarification ?? "",
      sources: current?.sources.join("\n") ?? "",
      expectedRevision:
        local?.revision ?? (current?.source === "local" ? (current.revision ?? 0) : 0),
    };
  }

  reset(): void {
    this.#generation += 1;
    this.snapshot = null;
    this.draft = null;
    this.deleting = null;
    this.query = "";
    this.category = "";
    this.scope = "public";
    this.error = "";
    this.loading = false;
    this.busy = false;
  }

  async load(sync = false): Promise<void> {
    if (this.busy) return;
    this.loading = !this.snapshot;
    await this.#request({ type: sync ? "dictionary.sync" : "dictionary.list" });
  }

  async save(): Promise<void> {
    if (!this.draft || this.busy) return;
    let entry: DictionaryEntry;
    try {
      entry = dictionaryDraftEntry(this.draft);
    } catch {
      this.error = t("Enter a term and definition. Use HTTPS links for sources.");
      return;
    }
    const saved = await this.#request({
      type: "dictionary.save",
      entry,
      expectedRevision: this.draft.expectedRevision,
    });
    if (saved) {
      this.draft = null;
      this.scope = "local";
      this.query = "";
      this.category = "";
    }
  }

  async forget(): Promise<void> {
    const entry = this.deleting;
    if (entry?.source !== "local" || !entry.revision || this.busy) return;
    if (
      await this.#request({
        type: "dictionary.forget",
        id: entry.id,
        expectedRevision: entry.revision,
      })
    )
      this.deleting = null;
  }

  async #request(command: Parameters<typeof requestAgent>[0]): Promise<boolean> {
    const generation = this.#generation;
    this.busy = true;
    this.error = "";
    try {
      const response = await requestAgent(command, 60_000);
      const snapshot = DictionarySnapshotSchema.parse(response.dictionary);
      if (generation !== this.#generation) return false;
      this.snapshot = snapshot;
      return true;
    } catch (cause) {
      if (generation === this.#generation)
        this.error = cause instanceof Error ? cause.message : String(cause);
      return false;
    } finally {
      if (generation === this.#generation) {
        this.busy = false;
        this.loading = false;
      }
    }
  }
}
