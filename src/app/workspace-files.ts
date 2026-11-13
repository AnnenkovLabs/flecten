import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { isInside } from "../tools/util/paths";
import { Mutex } from "../util/mutex";

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
  const relative = target
    .slice(root.length + 1)
    .split("\\")
    .join("/");
  if (
    !isInside(root, target) ||
    target === root ||
    [".git", ".liquid"].includes(relative.split("/")[0] ?? "")
  )
    throw new Error("Выберите файл или папку внутри проекта, вне .git и .liquid.");
  const parent = await realpath(dirname(target));
  if (!isInside(root, parent)) throw new Error("Папка находится вне проекта.");
  const canonical = join(parent, basename(target));
  if (
    !isInside(root, canonical) ||
    [".git", ".liquid"].includes(canonical.slice(root.length + 1).split("/")[0] ?? "")
  )
    throw new Error("Служебные папки нельзя менять из проводника.");
  return canonical;
}

async function absent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("Такое имя уже существует. Выберите другое имя.");
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
      throw new Error("Выберите обычный файл или папку, без символической ссылки.");
    if (operation.operation === "rename") {
      const destination = await checkedPath(root, operation.destination);
      await absent(destination);
      // ponytail: serialized IDE operations; OS-level no-replace rename is needed against external writers.
      await rename(target, destination);
    } else {
      const trash = resolve(root, ".liquid/ide-trash");
      await mkdir(trash, { recursive: true, mode: 0o700 });
      if (!isInside(root, await realpath(trash))) throw new Error("Корзина находится вне проекта.");
      await rename(target, join(trash, `${randomUUID()}-${basename(target)}`));
    }
  });
}

const SKIP = new Set(["node_modules", ".git", ".liquid", "dist", "release", "coverage", ".cache"]);

/** Empty directories are real explorer entries too. */
export async function workspaceDirectories(cwd: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(path: string, prefix: string): Promise<void> {
    if (result.length >= 2000) return;
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (result.length >= 2000) break;
      if (!entry.isDirectory() || SKIP.has(entry.name)) continue;
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      result.push(name);
      await visit(join(path, entry.name), name);
    }
  }
  await visit(cwd, "");
  return result.sort();
}
