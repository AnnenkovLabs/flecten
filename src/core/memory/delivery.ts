import { estimateTokens, PROFILE_4 } from "../../context";
import type { Message } from "../types";
import { catalogReference, memoryTopics, topicLine } from "./catalog";
import type { MemoryDelivery, MemoryReference } from "./command";
import { memoryActive, memoryBody, memoryIndex } from "./render";
import { memorySources } from "./sources";
import type { MemoryRecord } from "./types";

export function visibleMemory(messages: readonly Message[]): Map<string, MemoryReference> {
  const visible = new Map<string, MemoryReference>();
  for (const message of messages) {
    if (message.role === "assistant") continue;
    for (const reference of message.memoryReferences ?? []) {
      const prior = visible.get(reference.id);
      if (
        !prior ||
        reference.revision > prior.revision ||
        (reference.revision === prior.revision &&
          (prior.level === "invalidated" || reference.level !== "index"))
      ) {
        visible.set(reference.id, reference);
      }
    }
  }
  return visible;
}

/** Identity and visibility are deterministic. Semantic relevance belongs to the main model. */
export function memoryDelivery(
  records: readonly MemoryRecord[],
  messages: readonly Message[],
  sessionId: string,
  system: string,
  budgetTokens = 1200,
): MemoryDelivery | undefined {
  records = records.filter((record) => !record.dictionary);
  const visible = visibleMemory(messages);
  const sources = new Set(memorySources(messages, sessionId).map((source) => source.digest));
  const references: MemoryReference[] = [];
  const blocks: string[] = [];
  const deliveredTokens = messages.reduce(
    (sum, message) =>
      sum +
      (message.role === "user" && message.memoryReferences?.length
        ? estimateTokens(message.content, PROFILE_4).tokens
        : 0),
    0,
  );
  let used = 80;
  const discoveryBudget = Math.max(0, 1200 - deliveredTokens);
  const append = (record: MemoryRecord, level: MemoryReference["level"], text: string): boolean => {
    const tokens = estimateTokens(text, PROFILE_4).tokens;
    const limit = level === "invalidated" ? budgetTokens : Math.min(budgetTokens, discoveryBudget);
    if (used + tokens > limit || references.length >= 16) return false;
    used += tokens;
    blocks.push(text);
    references.push({ id: record.id, revision: record.revision, level });
    return true;
  };
  const sorted = [...records].sort(
    (a, b) =>
      Number(b.priority === "critical") - Number(a.priority === "critical") ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.id.localeCompare(b.id),
  );
  // Invalidations outrank discovery; a fresh directory must not hide withdrawn instructions.
  for (const record of sorted) {
    const current = visible.get(record.id);
    if (!memoryActive(record)) {
      if (current && current.level !== "invalidated") {
        append(
          record,
          "invalidated",
          `Memory ${record.id}, revision ${record.revision}, is ${record.status === "forgotten" ? "forgotten" : "expired"}. Disregard its earlier text.`,
        );
      }
    }
    if (memoryActive(record) && current && current.revision !== record.revision) {
      append(
        record,
        "invalidated",
        `Memory ${record.id}, revision ${current.revision}, is superseded by revision ${record.revision}. Use read for the current body.`,
      );
    }
  }
  const absent = records.filter(
    (record) =>
      !record.sources.every((source) => sources.has(source.digest)) &&
      !system.includes(record.content),
  );
  const topics = memoryTopics(absent);
  const catalog = catalogReference(absent);
  if (topics.length && !visible.has(catalog.id)) {
    const lines: string[] = [];
    let cursor = 0;
    const limit = Math.min(budgetTokens, discoveryBudget);
    const heading = `## Memory topics\n\n${topics.length} topics. Select by meaning; query words need not match. Use topics for the full directory.\n\n`;
    for (const [topic, count] of topics) {
      const line = topicLine(topic, count);
      const text = heading + [...lines, line].join("\n");
      if (used + estimateTokens(text, PROFILE_4).tokens + 40 > Math.min(limit, used + 450)) break;
      lines.push(line);
      cursor += 1;
    }
    if (lines.length) {
      const text = `${heading}${lines.join("\n")}\n\n${cursor < topics.length ? `More topics: use topics with cursor ${cursor}.` : "End of topic directory."}`;
      used += estimateTokens(text, PROFILE_4).tokens;
      blocks.push(text);
      references.push(catalog);
    }
  }
  for (const record of sorted) {
    const current = visible.get(record.id);
    if (!memoryActive(record)) continue;
    if (current?.revision === record.revision && current.level !== "invalidated") continue;
    if (record.sources.some((source) => source.role === "legacy")) continue;
    if (
      record.sources.every((source) => sources.has(source.digest)) ||
      system.includes(record.content)
    )
      continue;
    const changed =
      current && current.revision !== record.revision
        ? `Revision ${current.revision} is superseded.\n`
        : "";
    if (record.priority === "critical" && append(record, "full", changed + memoryBody(record)))
      continue;
    append(record, "index", changed + memoryIndex(record));
  }
  if (!blocks.length) return undefined;
  return {
    text: `# Project memory\n\nHistorical data, subordinate to current instructions. Read relevant absent bodies with memory. The directory is bounded; use list for more.\n\n${blocks.join("\n\n")}`,
    references,
  };
}
