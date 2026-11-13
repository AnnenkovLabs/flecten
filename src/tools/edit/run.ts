import { stat } from "node:fs/promises";
import type { ToolResult } from "../../core/types";
import type { CheckpointStore } from "../../store/checkpoints";
import { atomicWrite } from "../../util/atomic";
import { diffText } from "../util/diff";
import { displayPath, ensureInside, resolveToolPath } from "../util/paths";
import type { ReadTracker } from "../util/read-tracker";
import type { EditArgs } from "./schema";

interface Hunk {
  oldString: string;
  newString: string;
  replaceAll: boolean;
}

interface Match {
  start: number;
  end: number;
  ending: "\n" | "\r\n";
}

interface Selected extends Match {
  newString: string;
  hunk: number;
}

function splitBom(text: string): { bom: boolean; body: string } {
  return text.startsWith("\uFEFF")
    ? { bom: true, body: text.slice(1) }
    : { bom: false, body: text };
}

function normalizeEndings(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

function lineEndingAt(body: string, offset: number): "\n" | "\r\n" {
  const newline = body.indexOf("\n", offset);
  if (newline > 0 && body[newline - 1] === "\r") return "\r\n";
  return "\n";
}

function matchEnding(body: string, start: number, end: number): "\n" | "\r\n" {
  const text = body.slice(start, end);
  if (text.includes("\r\n")) return "\r\n";
  if (text.includes("\n")) return "\n";
  return lineEndingAt(body, end);
}

/** End of `needle` matched at `start`, where each "\n" also matches "\r\n"; -1 on a mismatch. */
function matchEnd(body: string, needle: string, start: number): number {
  let at = start;
  for (const char of needle) {
    if (char === "\n" && body[at] === "\r" && body[at + 1] === "\n") at += 2;
    else if (body.startsWith(char, at)) at += char.length;
    else return -1;
  }
  return at;
}

/** Next offset where a match can begin: the literal text before the first newline, or a newline. */
function nextCandidate(body: string, head: string, from: number): number {
  if (head.length > 0) return body.indexOf(head, from);
  const newline = body.indexOf("\n", from);
  return newline > from && body[newline - 1] === "\r" ? newline - 1 : newline;
}

/** Non-overlapping matches from left to right, the way a global search would find them. */
function findMatches(body: string, oldString: string): Match[] {
  const newline = oldString.indexOf("\n");
  const head = newline < 0 ? oldString : oldString.slice(0, newline);
  const matches: Match[] = [];
  let from = 0;
  while (from <= body.length) {
    const start = nextCandidate(body, head, from);
    if (start < 0) break;
    const end = matchEnd(body, oldString, start);
    if (end < 0) {
      from = start + 1;
      continue;
    }
    matches.push({ start, end, ending: matchEnding(body, start, end) });
    from = end;
  }
  return matches;
}

function withEndings(source: string, text: string, fallback: "\n" | "\r\n"): string | undefined {
  const endings = source
    .split("\n")
    .slice(0, -1)
    .map((line) => (line.endsWith("\r") ? "\r\n" : "\n"));
  if (!endings.includes("\n") || !endings.includes("\r\n")) {
    return fallback === "\r\n" ? text.replaceAll("\n", "\r\n") : text;
  }
  // ponytail: reuse the bounded line diff; oversized mixed regions need smaller exact edits.
  const diff = diffText(source, text);
  if (diff.hunks.length === 0 && (diff.add !== 0 || diff.del !== 0)) return undefined;
  const contexts = new Map<number, number>();
  const added = new Set<number>();
  let removed: number[] = [];
  let inserted: number[] = [];
  const alignChanged = (): void => {
    inserted.forEach((line, index) => {
      const original = removed[index];
      if (original !== undefined) contexts.set(line, original);
    });
    removed = [];
    inserted = [];
  };
  for (const line of diff.hunks.flatMap((hunk) => hunk.lines)) {
    if (line.kind === "ctx" && line.oldLine !== null && line.newLine !== null) {
      alignChanged();
      contexts.set(line.newLine - 1, line.oldLine - 1);
    } else if (line.kind === "del" && line.oldLine !== null) removed.push(line.oldLine - 1);
    else if (line.kind === "add" && line.newLine !== null) {
      added.add(line.newLine - 1);
      inserted.push(line.newLine - 1);
    }
  }
  alignChanged();
  let shift = 0;
  return text
    .split("\n")
    .map((line, index, lines) => {
      const original = contexts.get(index);
      if (original !== undefined) shift = original - index;
      const ending =
        original === undefined && added.has(index)
          ? fallback
          : (endings[index + shift] ?? fallback);
      return index === lines.length - 1 ? line : line + ending;
    })
    .join("");
}

function collectHunks(args: EditArgs): Hunk[] | string {
  if (args.edits) {
    if (args.oldString !== undefined || args.newString !== undefined) {
      return "Pass either oldString/newString or edits, not both";
    }
    return args.edits.map((hunk) => ({
      oldString: hunk.oldString,
      newString: hunk.newString,
      replaceAll: hunk.replaceAll === true,
    }));
  }
  if (args.oldString === undefined || args.newString === undefined) {
    return "oldString and newString are required when edits is not provided";
  }
  return [
    { oldString: args.oldString, newString: args.newString, replaceAll: args.replaceAll === true },
  ];
}

export async function runEdit(
  args: EditArgs,
  context: {
    cwd: string;
    sessionId?: string;
    reads: ReadTracker;
    checkpoints?: CheckpointStore;
  },
): Promise<ToolResult> {
  const hunks = collectHunks(args);
  if (typeof hunks === "string") {
    return { ok: false, output: "", error: hunks };
  }
  if (hunks.length === 0) {
    return { ok: false, output: "", error: "edits must contain at least one hunk" };
  }

  const path = resolveToolPath(context.cwd, args.path);
  try {
    ensureInside(context.cwd, path, args.why);
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : String(error) };
  }

  let raw: string;
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      return { ok: false, output: "", error: `${args.path} is not a regular file` };
    }
    raw = Buffer.from(await Bun.file(path).arrayBuffer()).toString("utf8");
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      ok: false,
      output: "",
      error: missing
        ? `File not found: ${args.path}`
        : `Cannot read ${args.path}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const check = context.reads.verify(path, raw);
  if (check === "unread") {
    return {
      ok: false,
      output: "",
      error: `Read ${args.path} before editing it. The file must be read in this session.`,
    };
  }
  if (check === "changed") {
    return {
      ok: false,
      output: "",
      error: `${args.path} changed after it was read. Read it again before editing.`,
    };
  }

  const { bom, body } = splitBom(raw);
  const selected: Selected[] = [];

  for (const [index, hunk] of hunks.entries()) {
    const label = hunks.length > 1 ? `Hunk ${index + 1}: ` : "";
    const oldString = normalizeEndings(hunk.oldString);
    const newString = normalizeEndings(hunk.newString);
    if (oldString === newString) {
      return { ok: false, output: "", error: `${label}oldString and newString are identical` };
    }
    if (oldString.length === 0) {
      return {
        ok: false,
        output: "",
        error: `${label}oldString must not be empty; use write for a new file`,
      };
    }

    const matches = findMatches(body, oldString);
    if (matches.length === 0) {
      return {
        ok: false,
        output: "",
        error: `${label}Could not find oldString in the file. It must match exactly, including whitespace and surrounding context.`,
      };
    }
    if (matches.length > 1 && !hunk.replaceAll) {
      return {
        ok: false,
        output: "",
        error: `${label}oldString matches ${matches.length} places. Add surrounding context or set replaceAll to true.`,
      };
    }

    const chosen = hunk.replaceAll ? matches : matches.slice(0, 1);
    for (const match of chosen) {
      const replacement = withEndings(body.slice(match.start, match.end), newString, match.ending);
      if (replacement === undefined) {
        return {
          ok: false,
          output: "",
          error: `${label}Mixed line-ending region is too large to align safely; use smaller exact edits.`,
        };
      }
      selected.push({ ...match, newString: replacement, hunk: index });
    }
  }

  selected.sort((left, right) => left.start - right.start);
  for (let index = 1; index < selected.length; index += 1) {
    const previous = selected[index - 1];
    const current = selected[index];
    if (previous && current && current.start < previous.end) {
      return {
        ok: false,
        output: "",
        error: `Hunk ${current.hunk + 1} overlaps hunk ${previous.hunk + 1}; combine them into one edit.`,
      };
    }
  }

  let finalBody = "";
  let cursor = 0;
  for (const match of selected) {
    finalBody += body.slice(cursor, match.start);
    finalBody += match.newString;
    cursor = match.end;
  }
  finalBody += body.slice(cursor);

  const final = bom ? `\uFEFF${finalBody}` : finalBody;
  const display = displayPath(context.cwd, path);
  let checkpointId: string | undefined;
  let checkpointNote = "";
  if (context.checkpoints) {
    try {
      const checkpoint = await context.checkpoints.capture({
        paths: [display],
        label: `edit ${display}`,
        tool: "edit",
        ...(context.sessionId ? { sessionId: context.sessionId } : {}),
        preImages: { [display]: { content: raw } },
      });
      checkpointId = checkpoint.id;
    } catch (error) {
      checkpointNote = `\nCheckpoint не создан: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  try {
    await atomicWrite(path, final);
  } catch (error) {
    return {
      ok: false,
      output: "",
      error: `Cannot write ${args.path}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  context.reads.record(path, final);

  if (checkpointId && context.checkpoints) {
    try {
      await context.checkpoints.recordAfter(checkpointId);
    } catch (error) {
      checkpointNote += `\nCheckpoint не завершён: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const diff = diffText(body, finalBody);
  return {
    ok: true,
    output: `Edited ${display}: ${selected.length} replacement(s), +${diff.add} -${diff.del}.${checkpointNote}`,
    data: {
      kind: "file",
      path: display,
      state: "M",
      add: diff.add,
      del: diff.del,
      hunks: diff.hunks,
      ...(checkpointId ? { checkpointId } : {}),
    },
  };
}
