import { lstat, mkdir, readFile, realpath, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolResult } from "../../core/types";
import type { ToolContext } from "../types";
import { defineTool } from "../types";
import { displayPath, ensureInside, isInside, resolveToolPath } from "../util/paths";
import { type MoveArgs, moveSpec } from "./schema";

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
  const info = await lstat(path).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (info?.isSymbolicLink()) {
    const target = await realpath(path);
    if (!isInside(cwd, target)) {
      throw new Error(`Refusing to follow a symbolic link outside the workspace: ${input}`);
    }
  }
  return path;
}

async function checkSandbox(context: ToolContext, path: string): Promise<void> {
  if (context.sandbox === undefined) return;
  const decision = await context.sandbox.checkWrite(path);
  if (!decision.allowed) throw new Error(decision.reason);
}

async function statOrNull(path: string) {
  return lstat(path).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
}

export async function runMove(args: MoveArgs, context: ToolContext): Promise<ToolResult> {
  let from: string;
  let to: string;
  try {
    from = await mutationPath(context.cwd, args.from, args.why);
    to = await mutationPath(context.cwd, args.to, args.why);
    await checkSandbox(context, from);
    await checkSandbox(context, to);
  } catch (error) {
    return { ok: false, output: "", error: message(error) };
  }

  if (from === to) {
    return { ok: false, output: "", error: "from and to are the same path" };
  }

  const source = await statOrNull(from);
  if (source === undefined) {
    return { ok: false, output: "", error: `File not found: ${args.from}` };
  }
  if (source.isSymbolicLink()) {
    return { ok: false, output: "", error: `Refusing to move symbolic link: ${args.from}` };
  }
  if (!source.isFile()) {
    return { ok: false, output: "", error: `Move supports regular files only: ${args.from}` };
  }

  const target = await statOrNull(to);
  if (target?.isSymbolicLink()) {
    return { ok: false, output: "", error: `Refusing to overwrite symbolic link: ${args.to}` };
  }
  if (target !== undefined && !target.isFile()) {
    return { ok: false, output: "", error: `Destination is not a regular file: ${args.to}` };
  }
  if (target !== undefined && args.overwrite !== true) {
    return {
      ok: false,
      output: "",
      error: `Destination already exists: ${args.to}; pass overwrite: true to replace it`,
    };
  }

  const displayFrom = displayPath(context.cwd, from);
  const displayTo = displayPath(context.cwd, to);
  const content = await readFile(from);

  let checkpointId: string | undefined;
  let checkpointNote = "";
  if (context.checkpoints) {
    try {
      const checkpoint = await context.checkpoints.capture({
        paths: target === undefined ? [displayFrom] : [displayFrom, displayTo],
        label: `move ${displayFrom} -> ${displayTo}`,
        tool: "move",
        sessionId: context.sessionId,
        preImages:
          target === undefined
            ? { [displayFrom]: { content } }
            : { [displayFrom]: { content }, [displayTo]: { content: await readFile(to) } },
      });
      checkpointId = checkpoint.id;
    } catch (error) {
      checkpointNote = `\nCheckpoint не создан: ${message(error)}`;
    }
  }

  try {
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
  } catch (error) {
    return { ok: false, output: "", error: message(error) };
  }

  context.reads.forget(from);
  context.reads.record(to, content.toString("utf8"));

  if (checkpointId && context.checkpoints) {
    try {
      await context.checkpoints.recordAfter(checkpointId);
    } catch (error) {
      checkpointNote += `\nCheckpoint не завершён: ${message(error)}`;
    }
  }

  return {
    ok: true,
    output: `Moved ${displayFrom} -> ${displayTo}.${checkpointNote}`,
    data: {
      kind: "move",
      from: displayFrom,
      to: displayTo,
      overwritten: target !== undefined,
      ...(checkpointId ? { checkpointId } : {}),
    },
  };
}

export const moveTool = defineTool({
  ...moveSpec,
  mutating: true,
  execute: runMove,
});
