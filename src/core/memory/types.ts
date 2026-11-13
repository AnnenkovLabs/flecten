import type { DictionaryEntry } from "../../../shared/dictionary";

export const MEMORY_KINDS = [
  "preference",
  "lesson",
  "decision",
  "commitment",
  "context",
  "procedure",
] as const;

/** A model-selected category; projects can introduce their own categories. */
export type MemoryKind = string;

export interface MemoryEvidence {
  sessionId: string;
  role: "user" | "tool" | "legacy";
  quote: string;
  digest: string;
  reference: string;
}

export interface MemoryWrite {
  key: string;
  kind: MemoryKind;
  summary: string;
  content: string;
  reason: string;
  cues: string[];
  topics?: string[] | undefined;
  appliesWhen?: string | undefined;
  /** Structured vocabulary uses the same durable revision and evidence lifecycle. */
  dictionary?: DictionaryEntry | undefined;
  priority: "normal" | "critical";
  sources: MemoryEvidence[];
  expiresAt?: string | undefined;
  expectedRevision?: number | undefined;
}

export interface MemoryRecord extends Omit<MemoryWrite, "expectedRevision"> {
  id: string;
  revision: number;
  status: "active" | "forgotten";
  createdAt: string;
  updatedAt: string;
}

export interface MemoryPort {
  /** Includes tombstones so a context projection can invalidate forgotten revisions. */
  list(): Promise<MemoryRecord[]>;
  put(input: MemoryWrite): Promise<MemoryRecord>;
  forget(id: string, expectedRevision: number): Promise<MemoryRecord>;
  reconcile(input: MemoryReconciliation): Promise<MemoryReconciliationResult>;
}

export interface MemoryReconciliation {
  save: MemoryWrite[];
  forget: { id: string; expectedRevision: number }[];
}

export interface MemoryReconciliationResult {
  saved: MemoryRecord[];
  forgotten: MemoryRecord[];
}
