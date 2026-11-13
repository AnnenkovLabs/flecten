import { readdir } from "node:fs/promises";
import { join } from "node:path";

const IGNORED = new Set([
  "node_modules",
  ".git",
  "dist",
  "release",
  ".liquid",
  ".kilo",
  ".commandcode",
  ".cache",
  "coverage",
]);

const MAX_FILES = 5000;

async function gitFiles(cwd: string): Promise<string[] | undefined> {
  try {
    const child = Bun.spawn(
      ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd, stdout: "pipe", stderr: "ignore", stdin: "ignore" },
    );
    const text = await new Response(child.stdout).text();
    const code = await child.exited;
    if (code !== 0) return undefined;
    return text.split("\0").filter((path) => path.length > 0);
  } catch {
    return undefined;
  }
}

async function walk(cwd: string, dir: string, files: string[]): Promise<void> {
  if (files.length >= MAX_FILES) return;
  try {
    const entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (IGNORED.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(cwd, absolute, files);
        continue;
      }
      if (entry.isFile()) {
        const rest = absolute.slice(cwd.length);
        const relative = rest.startsWith("/") || rest.startsWith("\\") ? rest.slice(1) : rest;
        files.push(relative.split("\\").join("/"));
      }
    }
  } catch {
    // Unreadable directories are skipped; the picker still works for the rest of the tree.
  }
}

export async function listWorkspaceFiles(cwd: string): Promise<string[]> {
  const git = await gitFiles(cwd);
  if (git) return git.slice(0, MAX_FILES).sort();
  const files: string[] = [];
  await walk(cwd, cwd, files);
  return files.slice(0, MAX_FILES).sort();
}
