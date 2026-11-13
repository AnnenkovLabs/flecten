import { createHash } from "node:crypto";
import { markdownValue } from "../../util/markdown";
import { memoryActive } from "./render";
import type { MemoryRecord } from "./types";

export const UNCATEGORIZED_TOPIC = "Uncategorized";

/** Topics are authored by the model. No query classifier or lexical relevance ranking. */
export function recordTopics(record: MemoryRecord): string[] {
  return record.topics?.length ? [...new Set(record.topics)] : [UNCATEGORIZED_TOPIC];
}

export function memoryTopics(records: readonly MemoryRecord[]) {
  const topics = new Map<string, number>();
  for (const record of records) {
    if (
      record.dictionary ||
      !memoryActive(record) ||
      record.sources.some((source) => source.role === "legacy")
    )
      continue;
    for (const topic of recordTopics(record)) topics.set(topic, (topics.get(topic) ?? 0) + 1);
  }
  return [...topics].sort(([a], [b]) => a.localeCompare(b));
}

export function topicLine(topic: string, count: number): string {
  return `- ${markdownValue(topic)}: ${count} records. Use list with topic ${markdownValue(topic)}.`;
}

export function catalogStamp(records: readonly MemoryRecord[]): string {
  const identity = records
    .filter((record) => !record.dictionary && memoryActive(record))
    .map((record) => [record.id, record.revision])
    .sort(([a], [b]) => String(a).localeCompare(String(b)));
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export function catalogReference(records: readonly MemoryRecord[]) {
  // A reference follows actual context, so clipping/compaction naturally reopens discovery.
  return { id: `catalog:${catalogStamp(records)}`, revision: 1, level: "index" as const };
}
