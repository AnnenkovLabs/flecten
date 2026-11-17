import type { Dirent } from "node:fs";
import { opendir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const NAMES = new Set(["AGENTS.md", "CLAUDE.md"]);
const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "build", "coverage", "vendor"]);
const MAX_DIRECTORIES = 1_000;
const MAX_ENTRIES = 10_000;

export async function discoverNestedInstructions(
  root: string,
  maxDepth: number,
  maxFiles: number,
): Promise<{ paths: string[]; limited: boolean }> {
  const paths: string[] = [];
  let directories = 0;
  let entries = 0;
  let limited = false;

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    if (directories >= MAX_DIRECTORIES || entries >= MAX_ENTRIES || paths.length >= maxFiles) {
      limited = true;
      return;
    }
    directories += 1;
    const children: Dirent[] = [];
    try {
      const handle = await opendir(directory);
      for await (const entry of handle) {
        if (entries >= MAX_ENTRIES) {
          limited = true;
          break;
        }
        entries += 1;
        children.push(entry);
      }
    } catch {
      limited = true;
      return;
    }
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of children) {
      if (paths.length >= maxFiles) {
        limited = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walk(join(directory, entry.name), depth + 1);
      } else if (entry.isFile() && NAMES.has(entry.name)) {
        paths.push(join(directory, entry.name));
      }
    }
  }

  await walk(root, 1);
  paths.sort((left, right) => {
    const difference =
      relative(root, left).split(sep).length - relative(root, right).split(sep).length;
    return difference === 0 ? left.localeCompare(right) : difference;
  });
  return { paths, limited };
}
