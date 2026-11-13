import { readFile, rm } from "node:fs/promises";
import { basename } from "node:path";
import { atomicWrite } from "../../util/atomic";
import { assertNoSymlinkAncestors, hashBytes, lstatFile, resolveInside } from "./fs";
import type { ObjectStore } from "./objects";
import type {
  Checkpoint,
  CheckpointFile,
  CheckpointTarget,
  RestoreOptions,
  RestoreResult,
  RestoreSkip,
} from "./types";

/** Settings and secrets: undo never rewrites them unless the user picks them explicitly. */
const PROTECTED_ROOT_FILES = new Set(["flecten.config.json", "liquid.config.json"]);
const PROTECTED_ROOT_DIRS = [".liquid/"];
const PROTECTED_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
  "secrets.json",
]);

export function isProtectedPath(path: string): boolean {
  if (PROTECTED_ROOT_FILES.has(path)) return true;
  if (PROTECTED_ROOT_DIRS.some((dir) => path.startsWith(dir))) return true;
  return PROTECTED_NAMES.has(basename(path));
}

async function currentHash(
  cwd: string,
  absolute: string,
  path: string,
): Promise<string | undefined> {
  await assertNoSymlinkAncestors(cwd, absolute);
  const info = await lstatFile(absolute, path);
  if (info === null) return undefined;
  return hashBytes(await readFile(absolute));
}

type Plan =
  | { kind: "write"; hash: string }
  | { kind: "remove" }
  | { kind: "unchanged" }
  | { kind: "skip"; reason: RestoreSkip["reason"] };

function plan(
  file: CheckpointFile,
  target: CheckpointTarget,
  finalized: boolean,
  current: string | undefined,
  options: RestoreOptions,
): Plan {
  if (isProtectedPath(file.path) && options.includeProtected !== true) {
    return { kind: "skip", reason: "protected" };
  }
  const want = target === "before" ? file.beforeHash : file.afterHash;
  if (current === want) return { kind: "unchanged" };
  // After the checkpoint the file should hold the opposite state; anything else is a later edit.
  const expected = target === "before" ? file.afterHash : file.beforeHash;
  if (finalized && current !== expected && options.force !== true) {
    return { kind: "skip", reason: "conflict" };
  }
  return want === undefined ? { kind: "remove" } : { kind: "write", hash: want };
}

/**
 * Restores one side of a checkpoint. Files edited after the checkpoint are reported as conflicts
 * and left alone unless `force` is set; protected settings need `includeProtected`.
 */
export async function restoreCheckpoint(
  manifest: Checkpoint,
  target: CheckpointTarget,
  cwd: string,
  objects: ObjectStore,
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  const only = options.paths === undefined ? undefined : new Set(options.paths);
  const result: RestoreResult = {
    id: manifest.id,
    target,
    restored: [],
    removed: [],
    unchanged: [],
    skipped: [],
  };
  const finalized = manifest.finalizedAt !== undefined;
  for (const file of manifest.files) {
    options.signal?.throwIfAborted();
    if (only !== undefined && !only.has(file.path)) continue;
    const absolute = resolveInside(cwd, file.path);
    const current = await currentHash(cwd, absolute, file.path);
    const step = plan(file, target, finalized, current, options);
    if (step.kind === "skip") {
      result.skipped.push({ path: file.path, reason: step.reason });
    } else if (step.kind === "unchanged") {
      result.unchanged.push(file.path);
    } else if (step.kind === "remove") {
      await rm(absolute, { force: true });
      result.removed.push(file.path);
    } else {
      await atomicWrite(absolute, await objects.read(step.hash), file.mode);
      result.restored.push(file.path);
    }
  }
  return result;
}
