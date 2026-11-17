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
  process.stderr.write("[WINPROBE] src/util/atomic.ts 0\n");
  await durableMkdir(directory);
  process.stderr.write("[WINPROBE] src/util/atomic.ts 1\n");
  const temp = join(directory, `.${basename(path)}.${crypto.randomUUID()}.tmp`);
  try {
    signal?.throwIfAborted();
    process.stderr.write("[WINPROBE] src/util/atomic.ts 2\n");
  const handle = await open(temp, "wx", mode);
    try {
      process.stderr.write("[WINPROBE] src/util/atomic.ts 3\n");
  await handle.writeFile(data, signal ? { signal } : {});
      if (mode !== undefined) await handle.chmod(mode);
      process.stderr.write("[WINPROBE] src/util/atomic.ts 4\n");
  await handle.sync();
    } finally {
      await handle.close();
    }
    signal?.throwIfAborted();
    process.stderr.write("[WINPROBE] src/util/atomic.ts 5\n");
  await replaceFile(temp, path, signal);
    process.stderr.write("[WINPROBE] src/util/atomic.ts 6\n");
  await syncDirectory(directory);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}
