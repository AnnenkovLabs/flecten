import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { invalidPath, notFileError, symlinkError } from "./types";

/** Filesystem primitives shared by the checkpoint store, its object store and restore. */

export function hashBytes(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export async function lstatOrNull(path: string) {
  return lstat(path).catch((error: unknown) => {
    if (isEnoent(error)) return null;
    throw error;
  });
}

export async function readdirOrEmpty(path: string) {
  return readdir(path, { withFileTypes: true }).catch((error: unknown) => {
    if (isEnoent(error)) return [];
    throw error;
  });
}

export function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

/** Absolute path of a workspace-relative checkpoint path; rejects anything that escapes `cwd`. */
export function resolveInside(cwd: string, path: string): string {
  if (path.length === 0 || path.includes("\0") || isAbsolute(path)) throw invalidPath(path);
  const absolute = resolve(cwd, path);
  const inside = relative(cwd, absolute);
  if (
    inside.length === 0 ||
    inside === ".." ||
    inside.startsWith(`..${sep}`) ||
    isAbsolute(inside)
  ) {
    throw invalidPath(path);
  }
  return absolute;
}

/** A regular file or nothing: symbolic links and directories are never followed or replaced. */
export async function lstatFile(absolute: string, path: string) {
  const info = await lstatOrNull(absolute);
  if (info?.isSymbolicLink()) throw symlinkError(path);
  if (info !== null && !info.isFile()) throw notFileError(path);
  return info;
}

export async function assertNoSymlinkAncestors(cwd: string, absolute: string): Promise<void> {
  let current = cwd;
  for (const segment of relative(cwd, dirname(absolute)).split(sep)) {
    if (segment.length === 0) continue;
    current = join(current, segment);
    const info = await lstatOrNull(current);
    if (info === null) return;
    if (info.isSymbolicLink()) throw symlinkError(toPosix(relative(cwd, current)));
  }
}
