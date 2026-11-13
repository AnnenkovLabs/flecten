import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { atomicWrite } from "../../util/atomic";
import { Mutex } from "../../util/mutex";
import {
  assertNoSymlinkAncestors,
  hashBytes,
  isEnoent,
  lstatFile,
  readdirOrEmpty,
  resolveInside,
  toPosix,
} from "./fs";
import { hashesOf, ObjectStore } from "./objects";
import { restoreCheckpoint } from "./restore";
import {
  assertPreImage,
  type CaptureOptions,
  type Checkpoint,
  type CheckpointDiff,
  type CheckpointDiffFile,
  CheckpointError,
  type CheckpointFile,
  type CheckpointStoreOptions,
  type CheckpointTarget,
  checkpointSchema,
  type DiffOptions,
  type PreImage,
  type PreImageMap,
  type PruneOptions,
  type PruneResult,
  type RecordAfterOptions,
  type RestoreOptions,
  type RestoreResult,
} from "./types";

const MANIFEST_MODE = 0o600;
const ID_NAME = /^[\w-]+$/;

let sequence = 0;

function nextId(): string {
  sequence += 1;
  return `cp_${Date.now().toString(36)}_${sequence.toString(36).padStart(4, "0")}_${randomUUID().slice(0, 8)}`;
}

/** Object writes run a few dozen at a time: shell checkpoints can hold thousands of files. */
const WRITE_BATCH = 32;

async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let start = 0; start < items.length; start += WRITE_BATCH) {
    out.push(...(await Promise.all(items.slice(start, start + WRITE_BATCH).map(work))));
  }
  return out;
}

function changeStatus(
  before: string | undefined,
  after: string | undefined,
): CheckpointDiffFile["status"] {
  if (before === undefined && after === undefined) return "unchanged";
  if (before === undefined) return "added";
  if (after === undefined) return "deleted";
  return before === after ? "unchanged" : "modified";
}

export class CheckpointStore {
  readonly root: string;
  readonly cwd: string;
  readonly #objects: ObjectStore;
  readonly #manifestsDir: string;
  // ponytail: capture and prune share an in-process mutex only; add a lockfile for multi-process stores.
  readonly #mutex = new Mutex();

  constructor(options: CheckpointStoreOptions = {}) {
    this.cwd = resolve(options.cwd ?? process.cwd());
    this.root = resolve(this.cwd, options.root ?? join(".liquid", "checkpoints"));
    this.#objects = new ObjectStore(join(this.root, "objects"));
    this.#manifestsDir = join(this.root, "manifests");
  }

  async init(): Promise<void> {
    await Promise.all(
      [this.#objects.dir, this.#manifestsDir].map((dir) => mkdir(dir, { recursive: true })),
    );
  }

  async capture(options: CaptureOptions): Promise<Checkpoint> {
    const paths = [...new Set(options.paths.map((path) => this.#normalizePath(path)))];
    if (paths.length === 0 || options.label.length === 0 || options.tool.length === 0) {
      throw new CheckpointError("invalid_options", "capture needs paths, label and tool");
    }
    if (options.sessionId === "")
      throw new CheckpointError("invalid_options", "sessionId is empty");
    const supplied =
      options.preImages === undefined
        ? undefined
        : this.#normalizePreImages(options.preImages, paths);
    const after =
      options.afterImages === undefined
        ? undefined
        : this.#normalizePreImages(options.afterImages, paths);

    return this.#mutex.run(async () => {
      await this.init();
      const sizes = new Map<string, number>();
      const files = await inBatches(paths, async (path) => {
        options.signal?.throwIfAborted();
        const image =
          supplied === undefined
            ? await this.#readImage(path)
            : this.#suppliedImage(supplied, path);
        const file: CheckpointFile = { path };
        if (image !== null) {
          const hash = await this.#objects.store(image.content, options.signal);
          sizes.set(hash, image.content.byteLength);
          file.beforeHash = hash;
          if (image.mode !== undefined) file.mode = image.mode;
        }
        const post = after === undefined ? null : this.#suppliedImage(after, path);
        if (post !== null) {
          const hash = await this.#objects.store(post.content, options.signal);
          sizes.set(hash, post.content.byteLength);
          file.afterHash = hash;
          if (file.mode === undefined && post.mode !== undefined) file.mode = post.mode;
        }
        return file;
      });

      const manifest: Checkpoint = {
        id: nextId(),
        createdAt: new Date().toISOString(),
        label: options.label,
        tool: options.tool,
        files,
        bytes: await this.#objects.sumBytes(files, sizes),
        ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
        ...(options.command === undefined ? {} : { command: options.command }),
        ...(after === undefined ? {} : { finalizedAt: new Date().toISOString() }),
        ...(options.gap === undefined ? {} : { gap: options.gap }),
      };
      options.signal?.throwIfAborted();
      await this.#writeManifest(manifest, options.signal);
      return manifest;
    }, options.signal);
  }

  async recordAfter(id: string, options: RecordAfterOptions = {}): Promise<Checkpoint> {
    return this.#mutex.run(async () => {
      const manifest = await this.get(id);
      const paths = manifest.files.map((file) => file.path);
      const supplied =
        options.after === undefined ? undefined : this.#normalizePreImages(options.after, paths);
      const sizes = new Map<string, number>();
      const files = await inBatches(manifest.files, async (current) => {
        options.signal?.throwIfAborted();
        const image =
          supplied === undefined
            ? await this.#readImage(current.path)
            : this.#suppliedImage(supplied, current.path);
        const file: CheckpointFile = { path: current.path };
        if (current.beforeHash !== undefined) file.beforeHash = current.beforeHash;
        if (image !== null) {
          const hash = await this.#objects.store(image.content);
          sizes.set(hash, image.content.byteLength);
          file.afterHash = hash;
        }
        const mode =
          current.mode ??
          (current.beforeHash === undefined && image !== null ? image.mode : undefined);
        if (mode !== undefined) file.mode = mode;
        return file;
      });

      const updated: Checkpoint = {
        id: manifest.id,
        createdAt: manifest.createdAt,
        label: manifest.label,
        tool: manifest.tool,
        files,
        bytes: await this.#objects.sumBytes(files, sizes),
        finalizedAt: new Date().toISOString(),
        ...(manifest.sessionId === undefined ? {} : { sessionId: manifest.sessionId }),
        ...(manifest.command === undefined ? {} : { command: manifest.command }),
        ...(options.gap === undefined ? {} : { gap: options.gap }),
      };
      await this.#writeManifest(updated);
      return updated;
    });
  }

  async restore(
    id: string,
    target: CheckpointTarget = "before",
    options: RestoreOptions = {},
  ): Promise<RestoreResult> {
    if (target !== "before" && target !== "after") {
      throw new CheckpointError("invalid_options", `Invalid restore target: ${target}`);
    }
    const manifest = await this.get(id);
    if (target === "after" && manifest.finalizedAt === undefined) {
      throw new CheckpointError("not_finalized", `Checkpoint ${id} has no after state`, {
        path: id,
      });
    }

    return restoreCheckpoint(manifest, target, this.cwd, this.#objects, options);
  }

  async diff(id: string, options: DiffOptions = {}): Promise<CheckpointDiff> {
    const manifest = await this.get(id);
    const files: CheckpointDiffFile[] = [];
    for (const file of manifest.files) {
      options.signal?.throwIfAborted();
      const image = manifest.finalizedAt === undefined ? await this.#readImage(file.path) : null;
      const afterHash = image === null ? file.afterHash : hashBytes(image.content);
      files.push({
        path: file.path,
        status: changeStatus(file.beforeHash, afterHash),
        ...(file.beforeHash === undefined ? {} : { beforeHash: file.beforeHash }),
        ...(afterHash === undefined ? {} : { afterHash }),
      });
    }
    return { id, files };
  }

  async list(): Promise<Checkpoint[]> {
    const entries = await readdirOrEmpty(this.#manifestsDir);
    const manifests: Checkpoint[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const id = entry.name.slice(0, -5);
      if (!ID_NAME.test(id)) continue;
      manifests.push(await this.get(id));
    }
    manifests.sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    );
    return manifests;
  }

  async get(id: string): Promise<Checkpoint> {
    if (!ID_NAME.test(id)) {
      throw new CheckpointError("invalid_id", `Invalid checkpoint id: ${id}`, { path: id });
    }
    const text = await readFile(join(this.#manifestsDir, `${id}.json`), "utf8").catch(
      (error: unknown) => {
        if (isEnoent(error)) {
          throw new CheckpointError("manifest_missing", `Checkpoint not found: ${id}`, {
            path: id,
          });
        }
        throw error;
      },
    );

    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch (error) {
      throw new CheckpointError("manifest_invalid", `Invalid checkpoint manifest: ${id}`, {
        path: id,
        cause: error,
      });
    }
    const parsed = checkpointSchema.safeParse(raw);
    if (!parsed.success) {
      throw new CheckpointError("manifest_invalid", `Invalid checkpoint manifest: ${id}`, {
        path: id,
        cause: parsed.error,
      });
    }
    return parsed.data as Checkpoint;
  }

  async prune(options: PruneOptions = {}): Promise<PruneResult> {
    const { keep, maxAgeMs, signal } = options;
    if (keep === undefined && maxAgeMs === undefined) {
      throw new CheckpointError("invalid_options", "prune requires keep or maxAgeMs");
    }
    if (keep !== undefined && (!Number.isInteger(keep) || keep < 0)) {
      throw new CheckpointError("invalid_options", "prune keep must be a non-negative integer");
    }
    if (maxAgeMs !== undefined && (!Number.isFinite(maxAgeMs) || maxAgeMs < 0)) {
      throw new CheckpointError("invalid_options", "prune maxAgeMs must be non-negative");
    }

    return this.#mutex.run(async () => {
      const manifests = await this.list();
      const now = Date.now();
      const removedIds = new Set<string>();
      for (const [index, manifest] of manifests.entries()) {
        signal?.throwIfAborted();
        const tooOld = maxAgeMs !== undefined && now - Date.parse(manifest.createdAt) >= maxAgeMs;
        if (tooOld || (keep !== undefined && index >= keep)) removedIds.add(manifest.id);
      }

      const removed: string[] = [];
      for (const manifest of manifests) {
        if (!removedIds.has(manifest.id)) continue;
        await rm(join(this.#manifestsDir, `${manifest.id}.json`), { force: true });
        removed.push(manifest.id);
      }

      const kept = manifests.filter((manifest) => !removedIds.has(manifest.id));
      const referenced = new Set(hashesOf(kept.flatMap((manifest) => manifest.files)));
      const swept = await this.#objects.sweep(referenced, signal);
      return { removed, ...swept };
    });
  }

  async #readImage(path: string): Promise<{ content: Buffer; mode: number } | null> {
    const absolute = resolveInside(this.cwd, path);
    await assertNoSymlinkAncestors(this.cwd, absolute);
    const info = await lstatFile(absolute, path);
    if (info === null) return null;
    return { content: await readFile(absolute), mode: info.mode & 0o777 };
  }

  async #writeManifest(manifest: Checkpoint, signal?: AbortSignal): Promise<void> {
    const json = `${JSON.stringify(manifest, null, 2)}\n`;
    await atomicWrite(
      join(this.#manifestsDir, `${manifest.id}.json`),
      Buffer.from(json, "utf8"),
      MANIFEST_MODE,
      signal,
    );
    if (signal?.aborted) {
      await rm(join(this.#manifestsDir, `${manifest.id}.json`), { force: true });
      signal.throwIfAborted();
    }
  }

  #suppliedImage(
    images: Map<string, PreImage>,
    path: string,
  ): { content: Buffer; mode?: number } | null {
    const image = images.get(path);
    if (image === undefined) {
      throw new CheckpointError("invalid_options", `Missing pre-image for ${path}`, { path });
    }
    if (image === null) return null;
    const content = Buffer.from(image.content);
    return image.mode === undefined ? { content } : { content, mode: image.mode };
  }

  #normalizePreImages(images: PreImageMap, paths: string[]): Map<string, PreImage> {
    const normalized = new Map<string, PreImage>();
    for (const [input, image] of Object.entries(images)) {
      const path = this.#normalizePath(input);
      assertPreImage(path, image);
      normalized.set(path, image);
    }
    if (
      normalized.size !== Object.keys(images).length ||
      normalized.size !== paths.length ||
      paths.some((path) => !normalized.has(path))
    ) {
      throw new CheckpointError("invalid_options", "pre-images must cover the captured paths");
    }
    return normalized;
  }

  #normalizePath(path: string): string {
    return toPosix(relative(this.cwd, resolveInside(this.cwd, path)));
  }
}
