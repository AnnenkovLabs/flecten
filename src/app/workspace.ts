import { opendir } from "node:fs/promises";
import { join } from "node:path";
import { IGNORED_DIRECTORIES, isIgnoredPath } from "./workspace-ignore";

// ponytail: bounded startup index; add lazy directory expansion for larger workspaces.
const MAX_FILES = 5000;
const MAX_DIRECTORIES = 2000;
const MAX_ENTRIES = 10000;
const MAX_DEPTH = 32;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const SCAN_MS = 1500;

export interface WorkspaceFileIndex {
  files: string[];
  directories: string[];
  limited: boolean;
}

async function gitFiles(cwd: string, deadline: number): Promise<WorkspaceFileIndex | undefined> {
  let child: Bun.Subprocess<"ignore", "pipe", "ignore">;
  try {
    child = Bun.spawn(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
  } catch {
    return undefined;
  }
  const result: WorkspaceFileIndex = { files: [], directories: [], limited: false };
  const stop = () => {
    result.limited = true;
    child.kill("SIGKILL");
  };
  const timer = setTimeout(stop, Math.max(1, deadline - Date.now()));
  const decoder = new TextDecoder();
  let pending = "";
  let bytes = 0;
  try {
    for await (const chunk of child.stdout) {
      bytes += chunk.byteLength;
      if (bytes > MAX_OUTPUT_BYTES) {
        stop();
        break;
      }
      pending += decoder.decode(chunk, { stream: true });
      let end = pending.indexOf("\0");
      while (end >= 0) {
        const path = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (path && !isIgnoredPath(path)) result.files.push(path);
        if (result.files.length >= MAX_FILES) {
          stop();
          break;
        }
        end = pending.indexOf("\0");
      }
      if (result.limited) break;
    }
    const code = await child.exited;
    return result.limited || code === 0 ? result : undefined;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
  }
}

/** Streaming breadth-first traversal also bounds empty directories and deeply nested datasets. */
async function walk(cwd: string, result: WorkspaceFileIndex, deadline: number, files: boolean) {
  const queue = [{ path: "", depth: 0 }];
  let visited = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    if (Date.now() >= deadline) {
      result.limited = true;
      return;
    }
    const directory = queue[cursor];
    if (!directory) continue;
    let entries: Awaited<ReturnType<typeof opendir>>;
    try {
      entries = await opendir(join(cwd, directory.path));
    } catch {
      result.limited = true;
      continue;
    }
    for await (const entry of entries) {
      visited += 1;
      if (visited > MAX_ENTRIES || Date.now() >= deadline) {
        result.limited = true;
        return;
      }
      if (IGNORED_DIRECTORIES.has(entry.name) || entry.isSymbolicLink()) continue;
      const path = directory.path ? `${directory.path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (result.directories.length >= MAX_DIRECTORIES) {
          result.limited = true;
          return;
        }
        result.directories.push(path);
        if (directory.depth < MAX_DEPTH) queue.push({ path, depth: directory.depth + 1 });
        else result.limited = true;
      } else if (files && entry.isFile()) {
        result.files.push(path);
        if (result.files.length >= MAX_FILES) {
          result.limited = true;
          return;
        }
      }
    }
  }
}

/** No unbounded tree or subprocess output is materialized when a broad folder is selected. */
export async function listWorkspaceFiles(cwd: string): Promise<WorkspaceFileIndex> {
  const deadline = Date.now() + SCAN_MS;
  const git = await gitFiles(cwd, deadline);
  const result = git ?? { files: [], directories: [], limited: false };
  if (!result.limited) await walk(cwd, result, deadline, git === undefined);
  result.files.sort();
  result.directories.sort();
  return result;
}
