import { lstat, readdir, readFile, realpath, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ToolResult } from "../../core/types";
import type { ToolContext } from "../types";
import { defineTool } from "../types";
import { displayPath, ensureInside, isInside, resolveToolPath } from "../util/paths";
import { type DeleteArgs, deleteSpec } from "./schema";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function assertRealPathInside(cwd: string, input: string, start: string): Promise<void> {
  let current = start;
  while (true) {
    if (!isInside(cwd, current)) {
      throw new Error(`Refusing to follow a symbolic link outside the workspace: ${input}`);
    }
    try {
      const real = await realpath(current);
      if (!isInside(cwd, real)) {
        throw new Error(`Refusing to follow a symbolic link outside the workspace: ${input}`);
      }
      return;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = dirname(current);
      if (parent === current) return;
      current = parent;
    }
  }
}

async function mutationPath(cwd: string, input: string, why: string | undefined): Promise<string> {
  const path = resolveToolPath(cwd, input);
  ensureInside(cwd, path, why);
  await assertRealPathInside(cwd, input, dirname(path));
  return path;
}

async function checkSandbox(context: ToolContext, path: string): Promise<void> {
  if (context.sandbox === undefined) return;
  const decision = await context.sandbox.checkWrite(path);
  if (!decision.allowed) throw new Error(decision.reason);
}

async function collectFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) found.push(path);
    }
  };
  await walk(root);
  return found;
}

export async function runDelete(args: DeleteArgs, context: ToolContext): Promise<ToolResult> {
  const recursive = args.recursive === true;
  let path: string;
  try {
    path = await mutationPath(context.cwd, args.path, args.why);
    await checkSandbox(context, path);
  } catch (error) {
    return { ok: false, output: "", error: message(error) };
  }

  const info = await lstat(path).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (info === undefined) {
    return { ok: false, output: "", error: `Path not found: ${args.path}` };
  }
  if (info.isSymbolicLink()) {
    return {
      ok: false,
      output: "",
      error: `Refusing to delete symbolic link: ${args.path}; delete the link target explicitly`,
    };
  }

  let files: string[] = [];
  if (info.isDirectory()) {
    const entries = await readdir(path);
    if (entries.length > 0 && !recursive) {
      return {
        ok: false,
        output: "",
        error: `Directory is not empty: ${args.path}; pass recursive: true to delete it`,
      };
    }
    if (recursive) files = await collectFiles(path);
  } else if (!info.isFile()) {
    return { ok: false, output: "", error: `Not a regular file or directory: ${args.path}` };
  }

  const display = displayPath(context.cwd, path);
  const fileDisplays = files.map((file) => displayPath(context.cwd, file));
  let checkpointId: string | undefined;
  let checkpointNote = "";

  if (context.checkpoints) {
    try {
      const capturePaths = info.isDirectory() ? fileDisplays : [display];
      if (capturePaths.length > 0) {
        const preImages: Record<string, { content: Uint8Array } | null> = {};
        if (!info.isDirectory()) preImages[display] = { content: await readFile(path) };
        else {
          for (const [index, file] of files.entries()) {
            const fileDisplay = fileDisplays[index];
            if (fileDisplay !== undefined) {
              preImages[fileDisplay] = { content: await readFile(file) };
            }
          }
        }
        const checkpoint = await context.checkpoints.capture({
          paths: capturePaths,
          label: `delete ${display}`,
          tool: "delete",
          sessionId: context.sessionId,
          preImages,
        });
        checkpointId = checkpoint.id;
      }
    } catch (error) {
      checkpointNote = `\nCheckpoint не создан: ${message(error)}`;
    }
  }

  try {
    if (info.isDirectory()) await rm(path, { recursive: true });
    else await rm(path);
  } catch (error) {
    return { ok: false, output: "", error: message(error) };
  }

  context.reads.forget(path);
  for (const file of files) context.reads.forget(file);

  const removed = info.isDirectory() ? files.length : 1;
  if (checkpointId && context.checkpoints) {
    try {
      await context.checkpoints.recordAfter(checkpointId);
    } catch (error) {
      checkpointNote += `\nCheckpoint не завершён: ${message(error)}`;
    }
  }

  const kind = info.isDirectory() ? "directory" : "file";
  return {
    ok: true,
    output: `Deleted ${kind} ${display}${recursive && info.isDirectory() ? ` (${removed} files)` : ""}.${checkpointNote}`,
    data: {
      kind: "delete",
      path: display,
      recursive: recursive && info.isDirectory(),
      removed,
      ...(checkpointId ? { checkpointId } : {}),
    },
  };
}

export const deleteTool = defineTool({
  ...deleteSpec,
  mutating: true,
  execute: runDelete,
});
