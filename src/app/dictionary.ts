import {
  DictionaryDeleteSchema,
  type DictionaryRecord,
  type DictionarySnapshot,
  DictionaryWriteSchema,
} from "../../shared/dictionary";
import { memoryDigest, safeMemoryText } from "../core/memory/sources";
import type { MemoryPort } from "../core/memory/types";
import { PublicDictionary } from "../dictionary/public";

/** The local vocabulary shares memory's audit, redaction and revision boundary. */
export async function projectDictionary(
  cwd: string,
  memory: MemoryPort,
  secrets: () => readonly string[],
  publicDictionary = new PublicDictionary(cwd),
) {
  await publicDictionary.load();
  async function list(): Promise<DictionarySnapshot> {
    const snapshot = publicDictionary.snapshot();
    const records = await memory.list();
    const local = records.filter(
      (record) =>
        record.dictionary &&
        record.status === "active" &&
        (!record.expiresAt || Date.parse(record.expiresAt) > Date.now()),
    );
    return {
      ...snapshot,
      entries: [
        ...snapshot.entries,
        ...local.flatMap<DictionaryRecord>((record) =>
          record.dictionary
            ? [{ ...record.dictionary, source: "local", revision: record.revision }]
            : [],
        ),
      ],
    };
  }
  return {
    list,
    async save(input: unknown): Promise<DictionarySnapshot> {
      const { entry, expectedRevision = 0 } = DictionaryWriteSchema.parse(input);
      const quote = JSON.stringify(entry);
      if (safeMemoryText(quote, secrets()) !== quote) {
        throw new Error("The definition contains a credential. Remove it before saving.");
      }
      const key = `dictionary/${entry.id}`;
      const current = (await memory.list()).find((record) => record.key === key);
      await memory.put({
        key,
        kind: "vocabulary",
        dictionary: entry,
        summary: entry.term,
        content: entry.definition,
        reason: "Definition explicitly saved by the user in Memory and dictionary.",
        cues: entry.aliases.slice(0, 16),
        priority: "normal",
        expectedRevision:
          current?.status === "forgotten" && expectedRevision === 0
            ? current.revision
            : expectedRevision,
        sources: [
          {
            sessionId: "dictionary-editor",
            role: "user",
            quote: quote.slice(0, 4_000),
            digest: memoryDigest(quote),
            reference: `dictionary-editor:${entry.id}`,
          },
        ],
      });
      return list();
    },
    async forget(input: unknown): Promise<DictionarySnapshot> {
      const { id, expectedRevision } = DictionaryDeleteSchema.parse(input);
      const current = (await memory.list()).find(
        (record) => record.key === `dictionary/${id}` && record.dictionary?.id === id,
      );
      if (!current) throw new Error("Local definition not found. Reload the dictionary.");
      await memory.forget(current.id, expectedRevision);
      return list();
    },
    async sync(): Promise<DictionarySnapshot> {
      await publicDictionary.syncPublic();
      return list();
    },
    refresh: () => publicDictionary.refreshIfStale(),
  };
}
