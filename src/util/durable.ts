import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** Sync directory entries after create, replace or unlink; IO failures must reach the caller. */
export async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
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
  const firstCreated = await mkdir(path, { recursive: true });
  if (!firstCreated) return;
  const boundary = dirname(resolve(firstCreated));
  let current = resolve(path);
  for (;;) {
    await syncDirectory(current);
    if (current === boundary) return;
    current = dirname(current);
  }
}
