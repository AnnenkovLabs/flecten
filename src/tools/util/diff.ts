export type DiffLineKind = "ctx" | "add" | "del";

export interface DiffLine {
  kind: DiffLineKind;
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffResult {
  add: number;
  del: number;
  hunks: DiffHunk[];
}

interface Op extends DiffLine {
  kind: DiffLineKind;
}

// ponytail: LCS table capped at 4M cells; huge files get counts without hunks.
const MAX_CELLS = 4_000_000;
const CONTEXT = 3;

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function fallback(oldLines: string[], newLines: string[]): DiffResult {
  return { add: newLines.length, del: oldLines.length, hunks: [] };
}

function buildOps(oldLines: string[], newLines: string[]): Op[] | undefined {
  const rows = oldLines.length;
  const cols = newLines.length;
  if (rows === 0) {
    return newLines.map((text, index) => ({
      kind: "add",
      oldLine: null,
      newLine: index + 1,
      text,
    }));
  }
  if (cols === 0) {
    return oldLines.map((text, index) => ({
      kind: "del",
      oldLine: index + 1,
      newLine: null,
      text,
    }));
  }
  if (rows * cols > MAX_CELLS) return undefined;

  const width = cols + 1;
  const table = new Int32Array((rows + 1) * width);
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      const index = row * width + col;
      if (oldLines[row] === newLines[col]) {
        table[index] = (table[(row + 1) * width + col + 1] ?? 0) + 1;
      } else {
        table[index] = Math.max(
          table[(row + 1) * width + col] ?? 0,
          table[row * width + col + 1] ?? 0,
        );
      }
    }
  }

  const ops: Op[] = [];
  let row = 0;
  let col = 0;
  while (row < rows && col < cols) {
    if (oldLines[row] === newLines[col]) {
      ops.push({
        kind: "ctx",
        oldLine: row + 1,
        newLine: col + 1,
        text: oldLines[row] ?? "",
      });
      row += 1;
      col += 1;
      continue;
    }
    const down = table[(row + 1) * width + col] ?? 0;
    const right = table[row * width + col + 1] ?? 0;
    if (down >= right) {
      ops.push({ kind: "del", oldLine: row + 1, newLine: null, text: oldLines[row] ?? "" });
      row += 1;
    } else {
      ops.push({ kind: "add", oldLine: null, newLine: col + 1, text: newLines[col] ?? "" });
      col += 1;
    }
  }
  while (row < rows) {
    ops.push({ kind: "del", oldLine: row + 1, newLine: null, text: oldLines[row] ?? "" });
    row += 1;
  }
  while (col < cols) {
    ops.push({ kind: "add", oldLine: null, newLine: col + 1, text: newLines[col] ?? "" });
    col += 1;
  }
  return ops;
}

function hunkHeader(lines: Op[]): string {
  const first = lines[0];
  let oldStart = first?.oldLine ?? 1;
  let newStart = first?.newLine ?? 1;
  if (oldStart === null) {
    const next = lines.find((line) => line.oldLine !== null);
    oldStart = next?.oldLine ?? 1;
  }
  if (newStart === null) {
    const next = lines.find((line) => line.newLine !== null);
    newStart = next?.newLine ?? 1;
  }
  const oldCount = lines.filter((line) => line.oldLine !== null).length;
  const newCount = lines.filter((line) => line.newLine !== null).length;
  return `@@ -${oldStart},${oldCount || 1} +${newStart},${newCount || 1} @@`;
}

function groupHunks(ops: Op[]): DiffHunk[] {
  const changed: number[] = [];
  for (let index = 0; index < ops.length; index += 1) {
    if (ops[index]?.kind !== "ctx") changed.push(index);
  }
  if (changed.length === 0) return [];

  const ranges: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - CONTEXT);
    const end = Math.min(ops.length, index + CONTEXT + 1);
    const previous = ranges.at(-1);
    if (previous && start <= previous[1]) {
      previous[1] = end;
    } else {
      ranges.push([start, end]);
    }
  }

  return ranges.map(([start, end]) => {
    const lines = ops.slice(start, end);
    return {
      header: hunkHeader(lines),
      lines: lines.map(({ kind, oldLine, newLine, text }) => ({
        kind,
        oldLine,
        newLine,
        text,
      })),
    };
  });
}

export function diffText(oldText: string, newText: string): DiffResult {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  if (oldText === newText) return { add: 0, del: 0, hunks: [] };

  const ops = buildOps(oldLines, newLines);
  if (!ops) return fallback(oldLines, newLines);

  const add = ops.filter((line) => line.kind === "add").length;
  const del = ops.filter((line) => line.kind === "del").length;
  return { add, del, hunks: groupHunks(ops) };
}
