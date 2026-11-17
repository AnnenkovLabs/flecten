import { lstat, rename } from "node:fs/promises";
import { join } from "node:path";

/** Scratch follows a deleted chat into its recoverable trash and expires with that record. */
export async function archiveSessionScratch(cwd: string, id: string, trash: string): Promise<void> {
  const root = join(cwd, ".flecten-scratch");
  const info = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!info?.isDirectory() || info.isSymbolicLink()) return;
  for (const [owner, name] of [
    [id, "scratch"],
    [`${id}_worker`, "worker-scratch"],
  ]) {
    const path = join(root, owner ?? "");
    const scratch = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (scratch?.isDirectory() && !scratch.isSymbolicLink())
      await rename(path, join(trash, name ?? ""));
  }
}
