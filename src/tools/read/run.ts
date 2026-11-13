import type { Stats } from "node:fs";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { imageMediaType } from "../../core/image";
import type { ToolResult } from "../../core/types";
import { truncateHead } from "../../util/truncate";
import type { ToolContext } from "../types";
import { detectEncoding, type Encoding, SAMPLE_BYTES, sampleFile } from "../util/encoding";
import { displayPath, resolveToolPath } from "../util/paths";
import { runReadImage } from "./image";
import type { ReadArgs } from "./schema";

const MAX_FULL_READ_BYTES = 20 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;

interface Streamed {
  lines: string[];
  total: number;
  complete: boolean;
  hasMore: boolean;
  clipped: boolean;
  fullText?: string;
}

function stripCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

// ponytail: a full read scans to EOF to keep exact totals; files above the
// threshold stop at the requested range, so they are not recorded for edit.
async function streamLines(
  path: string,
  start: number,
  encoding: Encoding,
  offset: number,
  limit: number,
  wantFull: boolean,
  maxOutputBytes: number,
): Promise<Streamed> {
  const decoder = new TextDecoder(encoding);
  const lines: string[] = [];
  let fullText: string | undefined = wantFull ? "" : undefined;
  let partial = "";
  let total = 0;
  let hasMore = false;
  let stopped = false;
  let clipped = false;
  let lineHasContent = false;
  let remaining = maxOutputBytes;

  const append = (text: string): void => {
    if (text.length > 0) lineHasContent = true;
    if (total + 1 < offset || total + 1 >= offset + limit) return;
    const take = Math.min(text.length, Math.max(0, remaining - partial.length));
    partial += text.slice(0, take);
    if (take < text.length) clipped = true;
  };

  const push = (): void => {
    total += 1;
    if (total >= offset && total < offset + limit) {
      lines.push(stripCarriageReturn(partial));
      remaining -= partial.length;
    }
    if (total >= offset + limit) hasMore = true;
    partial = "";
    lineHasContent = false;
  };

  for await (const chunk of createReadStream(path, {
    start,
    highWaterMark: CHUNK_BYTES,
  })) {
    const text = decoder.decode(chunk, { stream: true });
    if (fullText !== undefined) fullText += text;
    let cursor = 0;
    let newline = text.indexOf("\n");
    while (newline >= 0) {
      append(text.slice(cursor, newline));
      push();
      cursor = newline + 1;
      newline = text.indexOf("\n", cursor);
    }
    append(text.slice(cursor));
    if (!wantFull && hasMore) {
      stopped = true;
      break;
    }
  }

  if (!stopped) {
    append(decoder.decode());
    if (lineHasContent) push();
  }

  return {
    lines,
    total,
    complete: !stopped,
    hasMore,
    clipped,
    ...(fullText === undefined ? {} : { fullText }),
  };
}

export async function runRead(
  args: ReadArgs,
  context: Pick<ToolContext, "inspectImage" | "saveMedia" | "signal"> & {
    cwd: string;
    limits: { readLimitLines: number; maxOutputBytes: number };
    reads: { record(path: string, content: string): void };
  },
): Promise<ToolResult> {
  const path = resolveToolPath(context.cwd, args.path);
  let info: Stats;
  try {
    info = await stat(path);
  } catch {
    return { ok: false, output: "", error: `File not found: ${args.path}` };
  }
  if (info.isDirectory()) {
    return { ok: false, output: "", error: `${args.path} is a directory; use glob to list files` };
  }
  if (!info.isFile()) {
    return {
      ok: false,
      output: "",
      error: `${args.path} is not a regular file (FIFO or device); refusing to read it`,
    };
  }

  let sample: Uint8Array;
  try {
    sample = await sampleFile(path, info.size);
  } catch {
    return { ok: false, output: "", error: `Cannot read ${args.path}` };
  }
  if (imageMediaType(sample)) return runReadImage(path, args.focus, context);
  const detected = detectEncoding(sample);
  if (detected.binary) {
    return {
      ok: false,
      output: "",
      error: `${args.path} looks binary (NUL bytes in the first ${SAMPLE_BYTES} bytes); refusing to read it`,
    };
  }

  const notes: string[] = [];
  let offset = args.offset ?? 1;
  let limit = args.limit;

  if (args.limit !== undefined && args.offset === undefined) {
    notes.push("Note: offset was not provided; defaulted to 1.");
  }
  if (args.offset !== undefined && args.limit === undefined) {
    limit = context.limits.readLimitLines;
    notes.push(`Note: limit was not provided; defaulted to ${limit} lines.`);
  }
  if (limit === undefined || limit < 1) {
    if (args.limit === 0) notes.push("Note: limit 0 was treated as the default.");
    limit = context.limits.readLimitLines;
  }
  if (offset < 1) {
    if (args.offset === 0) notes.push("Note: offset 0 was treated as 1.");
    offset = 1;
  }

  const streamed = await streamLines(
    path,
    detected.bomBytes,
    detected.encoding,
    offset,
    limit,
    info.size <= MAX_FULL_READ_BYTES,
    context.limits.maxOutputBytes,
  );
  const total = streamed.total;

  if (total === 0) {
    if (streamed.fullText !== undefined) {
      context.reads.record(
        path,
        detected.bomBytes === 3 ? `\uFEFF${streamed.fullText}` : streamed.fullText,
      );
    }
    return {
      ok: true,
      output: "(empty file)",
      data: { kind: "read", path: displayPath(context.cwd, path), totalLines: 0, start: 0, end: 0 },
    };
  }
  if (offset > total) {
    return {
      ok: false,
      output: "",
      error: `Offset ${offset} is beyond the end of the file (${total} lines)`,
    };
  }

  const numbered = streamed.lines.map((line, index) => `${offset + index}: ${line}`).join("\n");
  const truncation = truncateHead(numbered, limit, context.limits.maxOutputBytes);
  const shownEnd = offset + truncation.outputLines - 1;
  const parts = [truncation.text];
  if (streamed.clipped) {
    parts.push("[Long lines clipped to the output budget. Narrow the search with grep.]");
  }

  if (truncation.truncated) {
    parts.push(
      `[Showing lines ${offset}-${shownEnd} of ${total}. Use offset=${shownEnd + 1} to continue.]`,
    );
  } else if (streamed.complete && shownEnd < total) {
    parts.push(`[${total - shownEnd} more lines. Use offset=${shownEnd + 1} to continue.]`);
  } else if (streamed.hasMore) {
    parts.push(`[File continues after line ${shownEnd}. Use offset=${shownEnd + 1} to continue.]`);
  }
  if (notes.length > 0) parts.push(notes.join(" "));

  if (streamed.fullText !== undefined) {
    context.reads.record(
      path,
      detected.bomBytes === 3 ? `\uFEFF${streamed.fullText}` : streamed.fullText,
    );
  }

  return {
    ok: true,
    output: parts.join("\n\n"),
    data: {
      kind: "read",
      path: displayPath(context.cwd, path),
      totalLines: streamed.complete ? total : null,
      start: offset,
      end: shownEnd,
    },
  };
}
