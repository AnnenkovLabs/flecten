import { stat } from "node:fs/promises";
import type { ToolResult } from "../../core/types";
import type { SandboxPolicy } from "../../security/sandbox";
import type { CheckpointStore } from "../../store/checkpoints";
import { atomicWrite } from "../../util/atomic";
import { diffText } from "../util/diff";
import { decodeFileBytes, type Encoding, encodeFileText } from "../util/encoding";
import { mutationPath } from "../util/mutation-path";
import { displayPath } from "../util/paths";
import type { WriteArgs } from "./schema";

export async function runWrite(
  args: WriteArgs,
  context: {
    cwd: string;
    authorizedExternalPaths?: string[];
    signal?: AbortSignal;
    sessionId?: string;
    sandbox?: SandboxPolicy | undefined;
    reads: {
      record(path: string, content: string): void;
      verify?(path: string, content: string): "ok" | "unread" | "changed";
    };
    checkpoints?: CheckpointStore;
  },
): Promise<ToolResult> {
  let path: string;
  try {
    path = await mutationPath(context.cwd, args.path, args.why, context.authorizedExternalPaths);
    if (context.sandbox) {
      const decision = await context.sandbox.checkWrite(path);
      if (!decision.allowed) return { ok: false, output: "", error: decision.reason };
    }
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : String(error) };
  }

  let previous = "";
  let existed = false;
  let encoding: Encoding = "utf-8";
  let bomBytes = 0;
  try {
    const info = await stat(path);
    if (info.isDirectory()) {
      return { ok: false, output: "", error: `${args.path} is a directory` };
    }
    if (!info.isFile()) {
      return { ok: false, output: "", error: `${args.path} is not a regular file` };
    }
    const decoded = decodeFileBytes(new Uint8Array(await Bun.file(path).arrayBuffer()));
    previous = decoded.text;
    encoding = decoded.encoding;
    bomBytes = decoded.bomBytes;
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
      checkpointNote = `\nCheckpoint skipped: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  try {
    const payload = existed ? encodeFileText(args.content, encoding, bomBytes) : args.content;
    await atomicWrite(path, payload, undefined, context.signal);
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
      checkpointNote += `\nCheckpoint incomplete: ${error instanceof Error ? error.message : String(error)}`;
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
