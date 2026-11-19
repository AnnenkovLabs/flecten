import { createReadStream } from "node:fs";
import type { ToolResult } from "../../core/types";
import type { Encoding } from "../util/encoding";

/** A long physical line has its own advancing character cursor; UTF-8 output remains intact.
 * ponytail: a character cursor rescans preceding bytes; add an inode-bound byte cursor for multi-GB lines.
 */
export async function readLineSlice(
  path: string,
  encoding: Encoding,
  bomBytes: number,
  offset: number,
  characterOffset: number,
  maxBytes: number,
  signal?: AbortSignal,
  reads?: { record(path: string, content: string): void },
): Promise<ToolResult> {
  if (signal?.aborted) return { ok: false, output: "", error: "Read aborted" };
  const decoder = new TextDecoder(encoding);
  const budget = Math.max(0, maxBytes - Buffer.byteLength(`${offset}: `) - 1);
  if (budget < 4)
    return { ok: false, output: "", error: "Read output budget is too small for a character." };
  let line = 1;
  let skipped = 0;
  let text = "";
  let bytes = 0;
  let complete = false;
  let more = false;
  let found = false;
  for await (const chunk of createReadStream(path, { start: bomBytes, highWaterMark: 64 * 1024 })) {
    if (signal?.aborted) return { ok: false, output: "", error: "Read aborted" };
    const decoded = decoder.decode(chunk, { stream: true });
    let cursor = 0;
    while (cursor < decoded.length) {
      const newline = decoded.indexOf("\n", cursor);
      const end = newline < 0 ? decoded.length : newline;
      if (line === offset) {
        found = true;
        const part = decoded.slice(cursor, end);
        for (const character of part) {
          if (skipped < characterOffset) {
            if (skipped + character.length > characterOffset)
              return { ok: false, output: "", error: "Read cursor splits a Unicode character." };
            skipped += character.length;
            continue;
          }
          const size = Buffer.byteLength(character);
          if (bytes + size > budget) {
            more = true;
            break;
          }
          text += character;
          bytes += size;
        }
        if (more) break;
        if (newline >= 0) {
          complete = true;
          break;
        }
      }
      if (newline < 0) break;
      line++;
      cursor = newline + 1;
    }
    if (more || complete) break;
  }
  if (!found || line < offset || skipped < characterOffset)
    return { ok: false, output: "", error: "Read cursor is beyond the requested line." };
  if (reads) {
    try {
      const file = Bun.file(path);
      if (file.size <= 20 * 1024 * 1024) {
        const raw = Buffer.from(await file.arrayBuffer()).toString("utf8");
        reads.record(path, raw);
      }
    } catch {
      // Ignore read tracker recording failure on unstatable files.
    }
  }
  const nextCharacterOffset = skipped + text.length;
  const cursor = more ? { offset, characterOffset: nextCharacterOffset } : { offset: offset + 1 };
  return {
    ok: true,
    output: `${offset}: ${text.replaceAll("\r", "")}\n\n${more ? `[Long lines clipped. Line continues. Use offset=${offset}, characterOffset=${nextCharacterOffset}.]` : `[Line complete. Use offset=${offset + 1} for the next line.]`}`,
    data: {
      kind: "read",
      path,
      start: offset,
      end: offset,
      characterOffset,
      nextCursor: cursor,
      longLine: true,
    },
  };
}
