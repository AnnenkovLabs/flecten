// Loading of external catalogs: memory and disk cache with TTL, last-known-good on errors.
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { HarnessError } from "../errors";
import { atomicWrite } from "../util/atomic";

export const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;

export class CatalogError extends HarnessError {
  readonly source: string;
  readonly status: number | undefined;

  constructor(
    source: string,
    message: string,
    options: { status?: number | undefined; cause?: unknown } = {},
  ) {
    super("provider_failed", `catalog ${source}: ${message}`, options);
    this.name = "CatalogError";
    this.source = source;
    this.status = options.status;
  }
}

interface CacheEntry {
  raw: unknown;
  mtimeMs: number;
}

async function readCacheFile(path: string): Promise<CacheEntry | undefined> {
  try {
    const info = await stat(path);
    return { raw: await Bun.file(path).json(), mtimeMs: info.mtimeMs };
  } catch {
    return undefined;
  }
}

async function writeCache(path: string, value: unknown): Promise<void> {
  try {
    await atomicWrite(path, JSON.stringify(value));
  } catch {}
}

export function cachePath(cwd: string, name: string): string {
  return join(cwd, ".liquid", "cache", name);
}

export interface CatalogLoadOptions {
  url?: string;
  fetch?: typeof fetch;
  ttlMs?: number;
  now?: () => number;
  force?: boolean;
}

export interface SourceSpec<T> {
  name: string;
  file: string;
  url: string;
  accept: string;
  read(response: Response): Promise<unknown>;
  parse(raw: unknown): T;
  empty(value: T): boolean;
  cacheValue?: "raw" | "value";
}

const memory = new Map<string, { value: unknown; at: number }>();
const errors = new Map<string, string>();

function asCatalogError(source: string, cause: unknown): CatalogError {
  if (cause instanceof CatalogError) return cause;
  return new CatalogError(source, cause instanceof Error ? cause.message : String(cause), {
    cause,
  });
}

export async function loadSource<T>(
  cwd: string,
  spec: SourceSpec<T>,
  options: CatalogLoadOptions,
): Promise<T | undefined> {
  const now = options.now?.() ?? Date.now();
  const ttl = options.ttlMs ?? CACHE_TTL_MS;
  const memo = memory.get(spec.file);
  if (!options.force && memo && now - memo.at <= ttl) return memo.value as T;

  const path = cachePath(cwd, spec.file);
  const cache = await readCacheFile(path);
  const fresh = cache !== undefined && now - cache.mtimeMs <= ttl;
  let value: T | undefined;
  let error: CatalogError | undefined;
  let fetched: unknown;
  let network = false;

  if (!options.force && fresh && cache) {
    try {
      value = spec.parse(cache.raw);
    } catch (cause) {
      error = asCatalogError(spec.name, cause);
    }
  }

  if (value === undefined) {
    network = true;
    try {
      const response = await (options.fetch ?? fetch)(options.url ?? spec.url, {
        headers: { accept: spec.accept },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.ok) fetched = await spec.read(response);
      else {
        error = new CatalogError(spec.name, `HTTP ${response.status}`, {
          status: response.status,
        });
      }
    } catch (cause) {
      error = asCatalogError(spec.name, cause);
    }
    if (fetched !== undefined) {
      try {
        const parsed = spec.parse(fetched);
        if (spec.empty(parsed)) {
          error ??= new CatalogError(spec.name, "response contained no models");
        } else {
          value = parsed;
          error = undefined;
        }
      } catch (cause) {
        error = asCatalogError(spec.name, cause);
      }
    }
  }

  if (value === undefined && cache) {
    try {
      const parsed = spec.parse(cache.raw);
      if (!spec.empty(parsed)) value = parsed;
    } catch {}
  }

  if (value !== undefined) {
    memory.set(spec.file, {
      value,
      at: network ? now : (cache?.mtimeMs ?? now),
    });
    if (network && fetched !== undefined && error === undefined && !spec.empty(value)) {
      await writeCache(path, spec.cacheValue === "value" ? value : fetched);
    }
  }
  if (error) errors.set(spec.name, error.message);
  else errors.delete(spec.name);
  return value;
}

export function resetCatalogCache(): void {
  memory.clear();
  errors.clear();
}

export function catalogLastError(source?: "models.dev" | "agent-one"): string | undefined {
  if (source) return errors.get(source);
  const values = [...errors.values()];
  return values.length > 0 ? values.join("; ") : undefined;
}
