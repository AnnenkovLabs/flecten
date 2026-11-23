import { lstat, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/** Session-owned scratch persists between calls and restarts; never follow a replaced directory. */
export async function prepareScratch(path: string | undefined): Promise<void> {
  if (!path) return;
  for (const directory of [dirname(path), path]) {
    const existing = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink()))
      throw new Error("Session scratch must be a real directory, not a symlink or file.");
    if (!existing) {
      await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      const created = await lstat(directory);
      if (!created.isDirectory() || created.isSymbolicLink())
        throw new Error("Session scratch was replaced by a symlink or file.");
    }
  }
}

export function scratchEnvironment(
  path: string | undefined,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  if (!path) return {};
  return platform === "win32"
    ? { TMPDIR: path, TEMP: path, TMP: path, FLECTEN_SCRATCH: path }
    : { TMPDIR: path, FLECTEN_SCRATCH: path };
}
