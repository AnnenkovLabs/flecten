import { markdownData, markdownValue } from "../../util/markdown";
import type { MemoryRecord } from "./types";

export function memoryActive(record: MemoryRecord, now = Date.now()): boolean {
  return record.status === "active" && (!record.expiresAt || Date.parse(record.expiresAt) > now);
}

export function memoryIndex(record: MemoryRecord): string {
  return `- ${markdownValue(record.id)} (revision ${record.revision}, ${markdownValue(record.kind)}, key ${markdownValue(record.key)}): ${markdownValue(record.summary)}${record.appliesWhen ? `; when: ${markdownValue(record.appliesWhen)}` : ""}${record.cues.length ? `; cues: ${record.cues.map(markdownValue).join(", ")}` : ""}`;
}

export function memoryBody(record: MemoryRecord): string {
  return markdownData(
    "Saved memory",
    [
      ["Identifier", record.id],
      ["Key", record.key],
      ["Revision", String(record.revision)],
      ["Kind", record.kind],
      ["Summary", record.summary],
      ["Priority", record.priority],
      ["Topics", record.topics?.join(", ")],
      ["Applies when", record.appliesWhen],
      ["Why keep", record.reason],
      ["Expires", record.expiresAt],
      ["Trust", "historical data; verify against current instructions"],
    ],
    `${record.content}\n\nEvidence:\n${record.sources
      .map(
        (source) =>
          `${source.role} in session ${source.sessionId}, ${source.reference}, SHA-256 ${source.digest}:\n${source.quote}`,
      )
      .join("\n\n")}`,
  );
}
