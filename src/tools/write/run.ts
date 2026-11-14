import { stat } from "node:fs/promises";
import type { ToolResult } from "../../core/types";
import type { CheckpointStore } from "../../store/checkpoints";
import { atomicWrite } from "../../util/atomic";
import { diffText } from "../util/diff";
import { displayPath, ensureInside, resolveToolPath } from "../util/paths";
import type { WriteArgs } from "./schema";

export async function runWrite(
  args: WriteArgs,
  context: {
    cwd: string;
    signal?: AbortSignal;
    sessionId?: string;
    reads: {
      record(path: string, content: string): void;
      verify?(path: string, content: string): "ok" | "unread" | "changed";
    };
    checkpoints?: CheckpointStore;
  },
): Promise<ToolResult> {
  const path = resolveToolPath(context.cwd, args.path);
  try {
    ensureInside(context.cwd, path, args.why);
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : String(error) };
  }

  let previous = "";
  let existed = false;
  try {
    const info = await stat(path);
    if (info.isDirectory()) {
      return { ok: false, output: "", error: `${args.path} is a directory` };
    }
    if (!info.isFile()) {
      return { ok: false, output: "", error: `${args.path} is not a regular file` };
    }
    previous = await Bun.file(path).text();
    existed = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return {
        ok: false,
        output: "",
        error: `Cannot read ${args.path} before writing: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (existed && context.reads.verify) {
    const state = context.reads.verify(path, previous);
    if (state === "unread") {
      return {
        ok: false,
        output: "",
        error: `Read ${args.path} before overwriting it. This protects the file from an accidental clobber.`,
      };
    }
    if (state === "changed") {
      return {
        ok: false,
        output: "",
        error: `${args.path} changed since it was read. Read it again before overwriting.`,
      };
    }
  }

  const display = displayPath(context.cwd, path);
  let checkpointId: string | undefined;
  let checkpointNote = "";
  if (context.checkpoints) {
    try {
      const checkpoint = await context.checkpoints.capture({
        ...(context.signal ? { signal: context.signal } : {}),
        paths: [display],
        label: `write ${display}`,
        tool: "write",
        ...(context.sessionId ? { sessionId: context.sessionId } : {}),
        preImages: { [display]: existed ? { content: previous } : null },
      });
      checkpointId = checkpoint.id;
    } catch (error) {
      checkpointNote = `\nCheckpoint не создан: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  try {
    await atomicWrite(path, args.content, undefined, context.signal);
  } catch (error) {
    return {
      ok: false,
      output: "",
      error: `Cannot write ${args.path}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  context.reads.record(path, args.content);

  if (checkpointId && context.checkpoints) {
    try {
      await context.checkpoints.recordAfter(checkpointId);
    } catch (error) {
      checkpointNote += `\nCheckpoint не завершён: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const diff = diffText(previous, args.content);
  return {
    ok: true,
    output: `Wrote ${display} (${Buffer.byteLength(args.content, "utf8")} bytes, +${diff.add} -${diff.del}).${checkpointNote}`,
    data: {
      kind: "file",
      path: display,
      state: existed ? "M" : "A",
      add: diff.add,
      del: diff.del,
      hunks: diff.hunks,
      ...(checkpointId ? { checkpointId } : {}),
    },
  };
}
