import { z } from "zod";
import { type MemoryFile, memoryWriteSchema } from "../core/memory/schema";
import type {
  MemoryReconciliation,
  MemoryReconciliationResult,
  MemoryRecord,
  MemoryWrite,
} from "../core/memory/types";
import { newId } from "../util/ids";

export const memoryReconciliationSchema = z
  .object({
    save: z.array(memoryWriteSchema).max(8),
    forget: z
      .array(
        z
          .object({ id: z.string().min(1).max(256), expectedRevision: z.number().int().positive() })
          .strict(),
      )
      .max(8),
  })
  .strict()
  .refine(
    (input) => input.save.length + input.forget.length > 0,
    "reconciliation must contain an operation",
  );

/** Optional retrieval fields remain absent on older records, including on exact retries. */
function memoryPayload(record: MemoryWrite | MemoryRecord): Omit<MemoryWrite, "expectedRevision"> {
  return {
    key: record.key,
    kind: record.kind,
    summary: record.summary,
    content: record.content,
    reason: record.reason,
    cues: [...record.cues],
    priority: record.priority,
    sources: record.sources.map((source) => ({ ...source })),
    ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
    ...(record.topics === undefined ? {} : { topics: [...record.topics] }),
    ...(record.appliesWhen === undefined ? {} : { appliesWhen: record.appliesWhen }),
    ...(record.dictionary === undefined ? {} : { dictionary: structuredClone(record.dictionary) }),
  };
}

/** Plan every mutation against one snapshot before publishing anything. */
export function reconcileMemory(
  file: MemoryFile,
  input: MemoryReconciliation,
  maxRecords: number,
): {
  file: MemoryFile;
  result: MemoryReconciliationResult;
  changed: boolean;
} {
  const keys = new Set<string>();
  const targets = new Set<string>();
  for (const draft of input.save) {
    if (keys.has(draft.key)) throw new Error("Memory reconciliation repeats a key");
    keys.add(draft.key);
    const current = file.records.find((record) => record.key === draft.key);
    if (current) targets.add(current.id);
  }
  for (const operation of input.forget) {
    if (targets.has(operation.id)) throw new Error("Memory reconciliation repeats a target");
    targets.add(operation.id);
  }
  const records = [...file.records];
  const history = [...file.history];
  const saved: MemoryRecord[] = [];
  const forgotten: MemoryRecord[] = [];
  const now = new Date().toISOString();
  const replace = (current: MemoryRecord | undefined, record: MemoryRecord) => {
    if (current) {
      records[records.indexOf(current)] = record;
      history.push(current);
    } else records.push(record);
  };
  for (const operation of input.forget) {
    const current = file.records.find((record) => record.id === operation.id);
    if (!current) throw new Error("Memory record not found");
    if (current.status === "forgotten") {
      forgotten.push(current);
      continue;
    }
    if (current.revision !== operation.expectedRevision)
      throw new Error("Memory revision conflict; read the current record before forgetting it");
    const record: MemoryRecord = {
      ...current,
      status: "forgotten",
      revision: current.revision + 1,
      updatedAt: now,
    };
    replace(current, record);
    forgotten.push(record);
  }
  for (const draft of input.save) {
    const current = file.records.find((record) => record.key === draft.key);
    if (
      current?.status === "active" &&
      JSON.stringify(memoryPayload(current)) === JSON.stringify(memoryPayload(draft))
    ) {
      saved.push(current);
      continue;
    }
    if (current ? draft.expectedRevision !== current.revision : (draft.expectedRevision ?? 0) !== 0)
      throw new Error("Memory revision conflict; read the current record before changing it");
    const record: MemoryRecord = {
      ...memoryPayload(draft),
      id: current?.id ?? newId("mem"),
      revision: (current?.revision ?? 0) + 1,
      status: "active",
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    replace(current, record);
    saved.push(record);
  }
  if (records.filter((record) => record.status === "active").length > maxRecords)
    throw new Error("Memory capacity reached; forget an obsolete record before adding another");
  return {
    file: { ...file, records, history },
    result: { saved, forgotten },
    changed: history.length !== file.history.length || records.length !== file.records.length,
  };
}
