import { mkdir, open, stat } from "node:fs/promises";
import { dirname } from "node:path";

/** Sync directory entries after create, replace or unlink; IO failures must reach the caller. */
export async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, "r");
    try {
      try {
        await handle.sync();
      } catch (error) {
        // Windows opens directories but rejects FlushFileBuffers for their read handles.
        if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM")
          return;
        throw error;
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    // Node cannot flush directory entries on every Windows filesystem. File contents are
    // still synced there, but power-loss durability of the name is filesystem-dependent.
    const code = (error as NodeJS.ErrnoException).code;
    if (
      process.platform === "win32" &&
      ["EISDIR", "EINVAL", "ENOTSUP", "ENOSYS"].includes(code ?? "")
    )
      return;
    throw error;
  }
}

/** Publish every newly-created directory before acknowledging a file stored inside it. */
export async function durableMkdir(path: string): Promise<void> {
  const parent = dirname(path);
  try {
    await mkdir(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" && (await stat(path)).isDirectory()) return;
    if (code !== "ENOENT" || parent === path) throw error;
    await durableMkdir(parent);
    return durableMkdir(path);
  }
  await syncDirectory(path);
  await syncDirectory(parent);
}
