import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative as relativePath, resolve } from "node:path";
import { z } from "zod";
import { isInside } from "../tools/util/paths";
import { Mutex } from "../util/mutex";

const PROTECTED_ROOTS = new Set([".git", ".flecten", ".liquid", ".flecten-migration"]);

function isProtectedRoot(root: string, target: string): boolean {
  const rel = relativePath(root, target).replaceAll("\\", "/");
  const top = rel.split("/")[0] ?? "";
  return PROTECTED_ROOTS.has(process.platform === "win32" ? top.toLowerCase() : top);
}

const Path = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes("\0"));
const Operation = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), path: Path, directory: z.boolean() }),
  z.object({ operation: z.literal("rename"), path: Path, destination: Path }),
  z.object({ operation: z.literal("trash"), path: Path, confirm: z.literal(true) }),
]);
const mutations = new Mutex();

async function checkedPath(root: string, path: string): Promise<string> {
  const target = resolve(root, path);
  if (!isInside(root, target) || target === root || isProtectedRoot(root, target))
    throw new Error("Choose a path inside the project, outside .git and .flecten.");
  const parent = await realpath(dirname(target));
  if (!isInside(root, parent)) throw new Error("Target folder is outside the project.");
  const canonical = join(parent, basename(target));
  if (!isInside(root, canonical) || isProtectedRoot(root, canonical))
    throw new Error("Protected internal folders cannot be modified here.");
  return canonical;
}

async function absent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("A file or folder with that name already exists.");
}

/** Explicit user operations never overwrite a destination; deletion moves data to local trash. */
export async function changeWorkspaceFile(cwd: string, input: unknown): Promise<void> {
  const operation = Operation.parse(input);
  await mutations.run(async () => {
    const root = await realpath(cwd);
    const target = await checkedPath(root, operation.path);
    if (operation.operation === "create") {
      if (operation.directory) await mkdir(target);
      else await writeFile(target, "", { flag: "wx" });
      return;
    }
    const info = await lstat(target);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
      throw new Error("Symlinks cannot be modified from the explorer.");
    if (operation.operation === "rename") {
      const destination = await checkedPath(root, operation.destination);
      await absent(destination);
      // ponytail: serialized IDE operations; OS-level no-replace rename is needed against external writers.
      await rename(target, destination);
    } else {
      const trash = resolve(root, ".flecten/ide-trash");
      await mkdir(trash, { recursive: true, mode: 0o700 });
      if (!isInside(root, await realpath(trash)))
        throw new Error("Trash path resolves outside the project.");
      await rename(target, join(trash, `${randomUUID()}-${basename(target)}`));
    }
  });
}
