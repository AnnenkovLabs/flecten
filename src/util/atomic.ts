import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

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
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}
