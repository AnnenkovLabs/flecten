import { open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { durableMkdir, syncDirectory } from "./durable";

/** Windows readers and antivirus can briefly deny replacement; keep the old file intact. */
async function replaceFile(temp: string, path: string, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + 1000;
  for (;;) {
    signal?.throwIfAborted();
    try {
      await rename(temp, path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        process.platform !== "win32" ||
        !["EPERM", "EACCES", "EBUSY"].includes(code ?? "") ||
        Date.now() >= deadline
      )
        throw error;
      await delay(20, undefined, signal ? { signal } : {});
    }
  }
}

/**
 * Syncs a temp file before renaming and syncing its directory, so an acknowledged write
 * survives power loss under the filesystem's fsync contract, without publishing half a file.
 * With `mode` the temp file gets exactly that mode before it takes the real name, so a
 * secret is never readable by others, whatever the umask.
 */
export async function atomicWrite(
  path: string,
  data: string | Uint8Array,
  mode?: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const directory = dirname(path);
  await durableMkdir(directory);
  const temp = join(directory, `.${basename(path)}.${crypto.randomUUID()}.tmp`);
  try {
    signal?.throwIfAborted();
    const handle = await open(temp, "wx", mode);
    try {
      await handle.writeFile(data, signal ? { signal } : {});
      if (mode !== undefined) await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    signal?.throwIfAborted();
    await replaceFile(temp, path, signal);
    await syncDirectory(directory);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}
