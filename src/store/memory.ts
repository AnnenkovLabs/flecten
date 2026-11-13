import { createHash } from "node:crypto";
import { realpathSync, type Stats } from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  legacyMemoryFileSchema,
  MEMORY_ACTIVE_LIMIT,
  MEMORY_FILE_BYTES,
  type MemoryFile,
  memoryFileSchema,
  memoryWriteSchema,
} from "../core/memory/schema";
import type {
  MemoryPort,
  MemoryReconciliation,
  MemoryReconciliationResult,
  MemoryRecord,
  MemoryWrite,
} from "../core/memory/types";
import { atomicWrite } from "../util/atomic";
import { Mutex } from "../util/mutex";
import { redactKnown } from "../util/redact";
import { memoryReconciliationSchema, reconcileMemory } from "./memory-mutations";

export interface MemoryStoreOptions {
  cwd?: string;
  file?: string;
  maxRecords?: number;
  secrets?: () => readonly string[];
}

// ponytail: writers share one process; add an OS lock if independent agent processes share a file.
const mutexes = new Map<string, Mutex>();

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(canonicalPath(parent), basename(path));
  }
}

function fingerprint(metadata: Stats): string {
  return [metadata.dev, metadata.ino, metadata.mtimeMs, metadata.ctimeMs, metadata.size].join(":");
}

function checkFile(metadata: Stats): void {
  if (!metadata.isFile() || metadata.size > MEMORY_FILE_BYTES)
    throw new Error("Memory file exceeds its storage boundary");
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function migratedFile(value: unknown): MemoryFile {
  const legacy = legacyMemoryFileSchema.safeParse(value);
  if (!legacy.success) throw new Error("Memory file is invalid; the original file was preserved");
  return memoryFileSchema.parse({
    version: 2,
    records: legacy.data.records.map((record) => ({
      id: record.id,
      key: `legacy/${digest(record.id)}`,
      kind: "context",
      summary: record.text.slice(0, 300),
      content: record.text,
      reason: "Legacy memory has no verified source. Verify it before using or promoting it.",
      cues: ["legacy-unverified", ...record.tags].slice(0, 16),
      priority: "normal",
      sources: [
        {
          sessionId: record.source.sessionId,
          role: "legacy",
          quote: record.text.slice(0, 4_000),
          digest: digest(record.text),
          reference: record.source.messageId ?? record.source.path ?? record.id,
        },
      ],
      revision: 1,
      status: "active",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    })),
    history: [],
  });
}

/** Durable project memory. Main-model writes select meaning; the store enforces identity and CAS. */
export class MemoryStore implements MemoryPort {
  readonly cwd: string;
  readonly path: string;
  readonly #maxRecords: number;
  readonly #secrets: () => readonly string[];
  readonly #mutex: Mutex;
  #cache: { fingerprint: string; file: MemoryFile } | undefined;

  constructor(options: MemoryStoreOptions = {}) {
    this.cwd = canonicalPath(resolve(options.cwd ?? process.cwd()));
    this.path = canonicalPath(resolve(this.cwd, options.file ?? ".liquid/memory.json"));
    this.#maxRecords = options.maxRecords ?? MEMORY_ACTIVE_LIMIT;
    if (
      !Number.isInteger(this.#maxRecords) ||
      this.#maxRecords < 1 ||
      this.#maxRecords > MEMORY_ACTIVE_LIMIT
    ) {
      throw new Error(`Memory capacity must be between 1 and ${MEMORY_ACTIVE_LIMIT}`);
    }
    this.#secrets = options.secrets ?? (() => []);
    this.#mutex = mutexes.get(this.path) ?? new Mutex();
    mutexes.set(this.path, this.#mutex);
  }

  load(): Promise<MemoryRecord[]> {
    return this.list();
  }

  list(): Promise<MemoryRecord[]> {
    return this.#mutex.run(async () => structuredClone((await this.#read()).records));
  }

  async put(input: MemoryWrite): Promise<MemoryRecord> {
    const parsed = memoryWriteSchema.safeParse(redactKnown(input, this.#secrets()));
    if (!parsed.success) throw new Error("Invalid memory write: check fields and source evidence");
    const result = await this.#mutate({ save: [parsed.data], forget: [] });
    const record = result.saved[0];
    if (!record) throw new Error("Memory save produced no record");
    return record;
  }

  async forget(id: string, expectedRevision: number): Promise<MemoryRecord> {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
      throw new Error("Invalid memory revision");
    const result = await this.#mutate({ save: [], forget: [{ id, expectedRevision }] });
    const record = result.forgotten[0];
    if (!record) throw new Error("Memory forgetting produced no record");
    return record;
  }

  reconcile(input: MemoryReconciliation): Promise<MemoryReconciliationResult> {
    const parsed = memoryReconciliationSchema.safeParse(redactKnown(input, this.#secrets()));
    if (!parsed.success)
      return Promise.reject(
        new Error("Invalid memory reconciliation: check all operations and evidence"),
      );
    return this.#mutate(parsed.data);
  }

  #mutate(input: MemoryReconciliation): Promise<MemoryReconciliationResult> {
    return this.#mutex.run(async () => {
      const planned = reconcileMemory(await this.#read(), input, this.#maxRecords);
      if (planned.changed) await this.#commit(planned.file);
      return structuredClone(planned.result);
    });
  }

  async #read(): Promise<MemoryFile> {
    let raw: string;
    let key: string;
    try {
      const metadata = await stat(this.path);
      checkFile(metadata);
      key = fingerprint(metadata);
      if (this.#cache?.fingerprint === key) return this.#cache.file;
      const handle = await open(this.path, "r");
      try {
        const before = await handle.stat();
        checkFile(before);
        key = fingerprint(before);
        raw = await handle.readFile("utf8");
        if (fingerprint(await handle.stat()) !== key)
          throw new Error("Memory file changed while reading; retry the operation");
      } finally {
        await handle.close();
      }
    } catch (error) {
      this.#cache = undefined;
      if (isMissing(error)) return { version: 2, records: [], history: [] };
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("Memory file is corrupt; the original file was preserved");
    }
    const parsed = memoryFileSchema.safeParse(value);
    if (parsed.success) {
      this.#cache = { fingerprint: key, file: parsed.data };
      return parsed.data;
    }
    const migrated = memoryFileSchema.parse(redactKnown(migratedFile(value), this.#secrets()));
    await this.#commit(migrated);
    return migrated;
  }

  async #commit(file: MemoryFile): Promise<void> {
    const parsed = memoryFileSchema.safeParse(redactKnown(file, this.#secrets()));
    if (!parsed.success)
      throw new Error("Memory storage boundary exceeded; the original file was preserved");
    const data = `${JSON.stringify(parsed.data)}\n`;
    if (Buffer.byteLength(data) > MEMORY_FILE_BYTES)
      throw new Error("Memory file capacity reached; the original file was preserved");
    await atomicWrite(this.path, data, 0o600);
    this.#cache = undefined;
  }
}
