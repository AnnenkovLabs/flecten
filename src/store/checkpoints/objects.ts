import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { atomicWrite } from "../../util/atomic";
import { hashBytes, isEnoent, lstatOrNull, readdirOrEmpty } from "./fs";
import { type CheckpointFile, missingObject } from "./types";

const OBJECT_MODE = 0o600;
const HASH_LENGTH = 64;
const HEX = new Set("0123456789abcdef");

function isHashName(name: string): boolean {
  if (name.length !== HASH_LENGTH) return false;
  for (const char of name) if (!HEX.has(char)) return false;
  return true;
}

export function hashesOf(files: readonly CheckpointFile[]): string[] {
  const hashes = new Set(files.flatMap((file) => [file.beforeHash, file.afterHash]));
  return [...hashes].filter((hash): hash is string => hash !== undefined);
}

/** Content-addressed blobs of checkpoints: `objects/<sha256>`, written once, read many times. */
export class ObjectStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async read(hash: string): Promise<Buffer> {
    return readFile(join(this.dir, hash)).catch((error: unknown) => {
      if (isEnoent(error)) throw missingObject(hash);
      throw error;
    });
  }

  async store(content: Uint8Array, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const hash = hashBytes(content);
    const path = join(this.dir, hash);
    if (!(await lstatOrNull(path))?.isFile()) await atomicWrite(path, content, OBJECT_MODE, signal);
    signal?.throwIfAborted();
    return hash;
  }

  async sumBytes(files: readonly CheckpointFile[], known: Map<string, number>): Promise<number> {
    let total = 0;
    for (const hash of hashesOf(files)) {
      let size = known.get(hash);
      if (size === undefined) {
        const info = await stat(join(this.dir, hash)).catch((error: unknown) => {
          if (isEnoent(error)) throw missingObject(hash);
          throw error;
        });
        size = info.size;
        known.set(hash, size);
      }
      total += size;
    }
    return total;
  }

  /** Removes every object no kept manifest references. */
  async sweep(
    referenced: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<{ objectsRemoved: number; bytesFreed: number }> {
    let objectsRemoved = 0;
    let bytesFreed = 0;
    for (const entry of await readdirOrEmpty(this.dir)) {
      signal?.throwIfAborted();
      if (!entry.isFile() || !isHashName(entry.name) || referenced.has(entry.name)) continue;
      const path = join(this.dir, entry.name);
      const info = await lstatOrNull(path);
      if (info === null) continue;
      await rm(path, { force: true });
      objectsRemoved += 1;
      bytesFreed += info.size;
    }
    return { objectsRemoved, bytesFreed };
  }
}
