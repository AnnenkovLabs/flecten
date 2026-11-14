import { lstat, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { ensureInside, isInside, resolveToolPath } from "./paths";

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function assertRealPathInside(
  cwd: string,
  input: string,
  start: string,
  roots: readonly string[],
): Promise<void> {
  let current = start;
  while (true) {
    if (!isInside(cwd, current, roots)) {
      throw new Error(`Refusing to follow a symbolic link outside the workspace: ${input}`);
    }
    try {
      const real = await realpath(current);
      if (!isInside(cwd, real, roots)) {
        throw new Error(`Refusing to follow a symbolic link outside the workspace: ${input}`);
      }
      return;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = dirname(current);
      if (parent === current) return;
      current = parent;
    }
  }
}

export async function mutationPath(
  cwd: string,
  input: string,
  why: string | undefined,
  roots: readonly string[] = [],
): Promise<string> {
  const path = resolveToolPath(cwd, input);
  ensureInside(cwd, path, why, roots);
  await assertRealPathInside(cwd, input, dirname(path), roots);
  const info = await lstat(path).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (info?.isSymbolicLink()) {
    const target = await realpath(path);
    if (!isInside(cwd, target, roots)) {
      throw new Error(`Refusing to follow a symbolic link outside the workspace: ${input}`);
    }
  }
  return path;
}
