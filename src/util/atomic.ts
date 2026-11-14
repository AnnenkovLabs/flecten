import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

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
 * Writes through a temp file and a rename, so a reader or a crash never sees half a file.
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
  await mkdir(directory, { recursive: true });
  const temp = join(directory, `.${basename(path)}.${crypto.randomUUID()}.tmp`);
  try {
    signal?.throwIfAborted();
    await writeFile(temp, data, {
      ...(mode === undefined ? {} : { mode }),
      ...(signal ? { signal } : {}),
    });
    if (mode !== undefined) await chmod(temp, mode);
    signal?.throwIfAborted();
    await replaceFile(temp, path, signal);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}
