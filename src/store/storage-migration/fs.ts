import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { type ContentScope, rebuildable } from "./content";
import { forEachConcurrent } from "./parallel";

const pathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !isAbsolute(path) &&
      !path.includes("\0") &&
      path
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".." && !part.includes("\\")),
  );
export const EntrySchema = z.discriminatedUnion("kind", [
  z.object({ path: pathSchema, kind: z.literal("directory"), mode: z.number().int() }),
  z.object({
    path: pathSchema,
    kind: z.literal("file"),
    mode: z.number().int(),
    hash: z.string().length(64),
    size: z.number().int().nonnegative(),
  }),
  z.object({ path: pathSchema, kind: z.literal("symlink"), target: z.string() }),
]);
export async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse((await readBytes(path)).toString("utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export type Entry = z.infer<typeof EntrySchema>;

export async function info(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      try {
        await handle.sync();
      } catch (error) {
        if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM")
          return;
        throw error;
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    // ponytail: Windows filesystems may not support directory fsync; retain synced files and verify on resume.
    const code = (error as NodeJS.ErrnoException).code;
    if (
      process.platform === "win32" &&
      ["EISDIR", "EINVAL", "ENOTSUP", "ENOSYS"].includes(code ?? "")
    )
      return;
    throw error;
  }
}

export async function ensureDirectory(path: string): Promise<void> {
  const existing = await info(path);
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink())
      throw new Error(`Expected a regular migration directory: ${path}`);
    return;
  }
  const parent = dirname(path);
  if (parent !== path) await ensureDirectory(parent);
  await mkdir(path, { mode: 0o700 }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  const created = await lstat(path);
  if (!created.isDirectory() || created.isSymbolicLink())
    throw new Error(`Unsafe migration directory: ${path}`);
  await syncDirectory(path);
  await syncDirectory(parent);
}

export async function readBytes(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!(await handle.stat()).isFile())
      throw new Error(`Expected a regular migration file: ${path}`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function renameWithWindowsRetry(source: string, target: string): Promise<void> {
  const deadline = Date.now() + 1000;
  for (;;) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        process.platform !== "win32" ||
        !["EPERM", "EACCES", "EBUSY"].includes(code ?? "") ||
        Date.now() >= deadline
      )
        throw error;
      await delay(20);
    }
  }
}

export async function durableWrite(path: string, bytes: Uint8Array | string): Promise<void> {
  await ensureDirectory(dirname(path));
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithWindowsRetry(temp, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function hashFile(path: string) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const hash = createHash("sha256");
  let size = 0;
  try {
    const item = await handle.stat();
    if (!item.isFile()) throw new Error(`Storage changed while hashing: ${path}`);
    const buffer = Buffer.allocUnsafe(Math.max(1, Math.min(1024 * 1024, item.size)));
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, size);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      size += bytesRead;
    }
    return { hash: hash.digest("hex"), size };
  } finally {
    await handle.close();
  }
}

export async function manifest(root: string, scope: ContentScope = "full"): Promise<Entry[]> {
  const result: Entry[] = [];
  const files: { absolute: string; entry: Extract<Entry, { kind: "file" }> }[] = [];
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error(`Unsafe storage directory: ${root}`);
  async function visit(directory: string, prefix: string) {
    const names = (await readdir(directory))
      .filter((name) => scope === "full" || !rebuildable(prefix ? `${prefix}/${name}` : name))
      .sort();
    const items = new Map<string, Stats>();
    await forEachConcurrent(names, async (name) => {
      items.set(name, await lstat(join(directory, name)));
    });
    for (const name of names) {
      const path = prefix ? `${prefix}/${name}` : name;
      pathSchema.parse(path);
      const absolute = join(directory, name);
      const item = items.get(name);
      if (!item) throw new Error(`Storage changed while listing: ${absolute}`);
      if (item.isSymbolicLink())
        result.push({ path, kind: "symlink", target: await readlink(absolute) });
      else if (item.isDirectory()) {
        result.push({ path, kind: "directory", mode: item.mode & 0o777 });
        await visit(absolute, path);
      } else if (item.isFile()) {
        const entry = { path, kind: "file" as const, mode: item.mode & 0o777, hash: "", size: 0 };
        result.push(entry);
        files.push({ absolute, entry });
      } else
        throw new Error(
          `Unsupported storage entry, preserve and resolve it before retrying: ${absolute}`,
        );
    }
  }
  await visit(root, "");
  await forEachConcurrent(files, async ({ absolute, entry }) => {
    Object.assign(entry, await hashFile(absolute));
  });
  return result;
}

export function sameManifest(left: readonly Entry[], right: readonly Entry[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Copy into a prepared private tree; callers sync directories and verify its full manifest. */
export async function copyEntry(
  sourceRoot: string,
  targetRoot: string,
  entry: Entry,
): Promise<void> {
  const target = join(targetRoot, ...entry.path.split("/"));
  if (entry.kind === "directory") {
    await ensureDirectory(target);
    return;
  }
  if (entry.kind === "symlink") {
    await symlink(entry.target, target);
    return;
  }
  const source = await open(
    join(sourceRoot, ...entry.path.split("/")),
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    if (!(await source.stat()).isFile())
      throw new Error(`Storage changed during backup: ${entry.path}`);
    const output = await open(target, "wx", 0o600);
    try {
      // Native fd-to-fd copying retains O_NOFOLLOW and exclusive destination creation.
      await Bun.write(Bun.file(output.fd), Bun.file(source.fd));
      await output.chmod(entry.mode);
      await output.sync();
    } finally {
      await output.close();
    }
  } finally {
    await source.close();
  }
}

/** Private copies become durable together before the transaction advances. */
export async function copyEntries(
  sourceRoot: string,
  targetRoot: string,
  entries: readonly Entry[],
): Promise<void> {
  for (const entry of entries)
    if (entry.kind === "directory") await copyEntry(sourceRoot, targetRoot, entry);
  await forEachConcurrent(entries, async (entry) => {
    if (entry.kind !== "directory") await copyEntry(sourceRoot, targetRoot, entry);
  });
  await finishDirectories(targetRoot, entries);
}

export async function finishDirectories(root: string, entries: readonly Entry[]): Promise<void> {
  for (const entry of [...entries].reverse()) {
    if (entry.kind !== "directory") continue;
    const path = join(root, ...entry.path.split("/"));
    await chmod(path, entry.mode);
    await syncDirectory(path);
  }
  await syncDirectory(root);
}

export async function durableRename(source: string, target: string): Promise<void> {
  await renameWithWindowsRetry(source, target);
  // Persist the destination name before allowing the source name's removal to become durable.
  await syncDirectory(dirname(target));
  if (dirname(source) !== dirname(target)) await syncDirectory(dirname(source));
}
