import { estimateTokens, PROFILE_4 } from "../../context";
import type { Message, ToolResult } from "../types";
import type { MemoryReference } from "./command";
import { visibleMemory } from "./delivery";
import { memoryActive, memoryBody } from "./render";
import { memorySources } from "./sources";
import type { MemoryRecord } from "./types";

/** A batch acknowledges full coverage only for bodies actually present in its bounded output. */
export function readMemories(
  records: readonly MemoryRecord[],
  ids: readonly string[],
  messages: readonly Message[],
  sessionId: string,
  system: string,
): ToolResult {
  const selected = [...new Set(ids)].map((id) => {
    const record = records.find((item) => item.id === id);
    if (!record || !memoryActive(record))
      throw new Error(
        `Memory ${id} is absent, expired or forgotten. Use list for current records.`,
      );
    return record;
  });
  const sources = new Set(memorySources(messages, sessionId).map((source) => source.digest));
  const visible = visibleMemory(messages);
  const blocks: string[] = [];
  const references: MemoryReference[] = [];
  const deferred: string[] = [];
  let tokens = 0;
  for (const record of selected) {
    let text: string;
    const prior = visible.get(record.id);
    if (
      record.sources.every((source) => sources.has(source.digest)) ||
      system.includes(record.content)
    ) {
      text = `Memory ${record.id} is covered by source evidence or project instructions already in context. Use that source instead of duplicating it.`;
    } else if (prior?.revision === record.revision && prior.level === "full") {
      text = `Memory ${record.id}, revision ${record.revision}, is already fully visible. Use its existing text.`;
    } else {
      text = memoryBody(record);
      const nextTokens = estimateTokens(text, PROFILE_4).tokens;
      // ponytail: the ordinary tool-output limit remains the final bound for a single large body.
      if (selected.length > 1 && tokens + nextTokens > 6000) {
        deferred.push(record.id);
        continue;
      }
      references.push({ id: record.id, revision: record.revision, level: "full" });
    }
    tokens += estimateTokens(text, PROFILE_4).tokens;
    blocks.push(text);
  }
  if (deferred.length)
    blocks.push(`Batch output limit reached. Read these separately: ${deferred.join(", ")}.`);
  return { ok: true, output: blocks.join("\n\n"), data: { memoryReferences: references } };
}
