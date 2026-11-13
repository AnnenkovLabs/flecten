import { stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  type DictionaryCategory,
  DictionaryCategorySchema,
  DictionaryIndexSchema,
  type DictionarySnapshot,
} from "../../shared/dictionary";
import { atomicWrite } from "../util/atomic";
import aiDevelopment from "./data/ai-development.json";
import design from "./data/design.json";

export const DICTIONARY_PUBLIC_SOURCE =
  "https://github.com/AnnenkovLabs/flecten/tree/main/src/dictionary/data";
const RAW_SOURCE =
  "https://raw.githubusercontent.com/AnnenkovLabs/flecten/main/src/dictionary/data/";
const FILE_LIMIT = 512 * 1024;
const CACHE_LIMIT = 4 * 1024 * 1024;
const TTL_MS = 24 * 60 * 60 * 1000;
const CacheSchema = z
  .object({
    schemaVersion: z.literal(1),
    syncedAt: z.iso.datetime(),
    categories: z.array(DictionaryCategorySchema).max(40),
  })
  .strict();

function validateCategories(categories: DictionaryCategory[]): DictionaryCategory[] {
  const entries = categories.flatMap((category) => category.entries);
  if (entries.length > 5_000 || new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new Error("Public dictionary exceeds its entry limit or contains duplicate ids");
  }
  if (new Set(categories.map((category) => category.category)).size !== categories.length) {
    throw new Error("Duplicate public dictionary category");
  }
  return categories;
}

/** A complete validated snapshot is published only after every category succeeds. */
export class PublicDictionary {
  readonly #path: string;
  readonly #fetch: typeof fetch;
  #categories = validateCategories(
    [design, aiDevelopment].map((value) => DictionaryCategorySchema.parse(value)),
  );
  #syncedAt: string | undefined;
  #error: string | undefined;
  #pending: Promise<DictionarySnapshot> | undefined;
  #attemptedAt = 0;

  constructor(cwd: string, options: { fetch?: typeof fetch } = {}) {
    this.#path = join(cwd, ".liquid", "dictionary", "public.json");
    this.#fetch = options.fetch ?? fetch;
  }

  snapshot(): DictionarySnapshot {
    return {
      entries: this.#categories.flatMap((category) =>
        category.entries.map((entry) => ({ ...entry, source: "public" as const })),
      ),
      publicSource: DICTIONARY_PUBLIC_SOURCE,
      ...(this.#syncedAt ? { syncedAt: this.#syncedAt } : {}),
      ...(this.#error ? { error: this.#error } : {}),
    };
  }

  async load(): Promise<DictionarySnapshot> {
    try {
      if ((await stat(this.#path)).size > CACHE_LIMIT)
        throw new Error("Dictionary cache exceeds 4 MiB");
      const cached = CacheSchema.parse(await Bun.file(this.#path).json());
      this.#categories = validateCategories(cached.categories);
      this.#syncedAt = cached.syncedAt;
      this.#error = undefined;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        this.#error =
          "The public dictionary cache could not be read. Refresh it to restore the latest definitions.";
      }
    }
    return this.snapshot();
  }

  refreshIfStale(signal?: AbortSignal): Promise<DictionarySnapshot> {
    const lastAttempt = Math.max(
      this.#attemptedAt,
      this.#syncedAt ? Date.parse(this.#syncedAt) : 0,
    );
    if (Date.now() - lastAttempt < TTL_MS) return Promise.resolve(this.snapshot());
    return this.syncPublic(signal);
  }

  syncPublic(signal?: AbortSignal): Promise<DictionarySnapshot> {
    if (this.#pending) return this.#pending;
    this.#pending = this.#sync(signal).finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  async #sync(signal?: AbortSignal): Promise<DictionarySnapshot> {
    this.#attemptedAt = Date.now();
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000);
    try {
      const manifest = DictionaryIndexSchema.parse(await this.#json("index.json", requestSignal));
      const categories: DictionaryCategory[] = [];
      for (const filename of manifest.categories) {
        categories.push(DictionaryCategorySchema.parse(await this.#json(filename, requestSignal)));
      }
      validateCategories(categories);
      const syncedAt = new Date().toISOString();
      const cache = JSON.stringify({ schemaVersion: 1, syncedAt, categories });
      if (Buffer.byteLength(cache) > CACHE_LIMIT)
        throw new Error("Dictionary snapshot exceeds 4 MiB");
      await atomicWrite(this.#path, cache, 0o600, requestSignal);
      this.#categories = categories;
      this.#syncedAt = syncedAt;
      this.#error = undefined;
    } catch (error) {
      signal?.throwIfAborted();
      this.#error =
        error instanceof Error
          ? `Public dictionary refresh failed: ${error.message.slice(0, 500)}. Retry the refresh; saved definitions remain available.`
          : "Public dictionary refresh failed. Retry the refresh; saved definitions remain available.";
    }
    return this.snapshot();
  }

  async #json(filename: string, signal: AbortSignal): Promise<unknown> {
    const response = await this.#fetch(new URL(filename, RAW_SOURCE), {
      signal,
      redirect: "error",
    });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
    if (!response.body) throw new Error("GitHub returned an empty response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > FILE_LIMIT) throw new Error("Dictionary category exceeds 512 KiB");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
}
