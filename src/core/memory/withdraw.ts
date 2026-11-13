import type { Message } from "../types";
import type { MemoryReference } from "./command";
import { memoryActive } from "./render";
import type { MemoryRecord } from "./types";

/** Remove stale bodies from the provider projection; durable raw tool events remain intact. */
export function withdrawMemoryMessages(
  messages: readonly Message[],
  withdrawn: readonly MemoryReference[],
): void {
  const versions = new Map(withdrawn.map((reference) => [reference.id, reference.revision]));
  for (const message of messages) {
    if (
      message.role === "assistant" ||
      !message.memoryReferences?.some(
        (reference) =>
          reference.level !== "invalidated" &&
          (versions.get(reference.id) ?? 0) >= reference.revision,
      )
    )
      continue;
    message.content = "Earlier saved-memory delivery withdrawn. Read current records if needed.";
    delete message.memoryReferences;
  }
}

export function staleMemoryReferences(
  records: readonly MemoryRecord[],
  messages: readonly Message[],
): MemoryReference[] {
  const current = new Map(records.map((record) => [record.id, record]));
  const stale = new Map<string, MemoryReference>();
  for (const message of messages) {
    if (message.role === "assistant") continue;
    for (const reference of message.memoryReferences ?? []) {
      if (reference.level === "invalidated" || reference.id.startsWith("catalog:")) continue;
      const record = current.get(reference.id);
      if (record && memoryActive(record) && record.revision === reference.revision) continue;
      const revision = record && !memoryActive(record) ? record.revision : reference.revision;
      if ((stale.get(reference.id)?.revision ?? 0) < revision)
        stale.set(reference.id, { id: reference.id, revision, level: "invalidated" });
    }
  }
  return [...stale.values()];
}
