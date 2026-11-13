const ELLIPSIS = "\n\n[... {removed} chars omitted ...]\n\n";

export interface Truncation {
  text: string;
  truncated: boolean;
  removed: number;
  totalLines: number;
  outputLines: number;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function lineCount(text: string): number {
  if (text.length === 0) return 0;
  let count = 1;
  for (const char of text) {
    if (char === "\n") count += 1;
  }
  return count;
}

function isContinuationByte(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

function cutHead(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && isContinuationByte(buffer[end] ?? 0)) end -= 1;
  return buffer.subarray(0, end).toString("utf8");
}

function cutTail(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) return text;
  let start = buffer.length - maxBytes;
  while (start < buffer.length && isContinuationByte(buffer[start] ?? 0)) start += 1;
  return buffer.subarray(start).toString("utf8");
}

export function truncateMiddle(text: string, maxBytes: number): Truncation {
  const totalBytes = Buffer.byteLength(text, "utf8");
  const totalLines = lineCount(text);
  if (totalBytes <= maxBytes) {
    return {
      text,
      truncated: false,
      removed: 0,
      totalLines,
      outputLines: totalLines,
    };
  }

  const markerBytes = 80;
  const budget = Math.max(0, maxBytes - markerBytes);
  const head = cutHead(text, Math.floor(budget / 2));
  const tail = cutTail(text, budget - Math.floor(budget / 2));
  const removed = Math.max(0, text.length - head.length - tail.length);
  return {
    text: `${head}${ELLIPSIS.replace("{removed}", String(removed))}${tail}`,
    truncated: true,
    removed,
    totalLines,
    outputLines: lineCount(head) + lineCount(tail),
  };
}

export function truncateLines(text: string, maxLines: number): Truncation {
  const lines = text.split("\n");
  const totalLines = lines.length;
  if (totalLines <= maxLines) {
    return {
      text,
      truncated: false,
      removed: 0,
      totalLines,
      outputLines: totalLines,
    };
  }
  const half = Math.max(1, Math.floor(maxLines / 2));
  const head = lines.slice(0, half).join("\n");
  const tail = lines.slice(-half).join("\n");
  const removed = totalLines - half * 2;
  return {
    text: `${head}\n\n[... ${removed} lines omitted ...]\n\n${tail}`,
    truncated: true,
    removed,
    totalLines,
    outputLines: half * 2,
  };
}

export function truncateHead(text: string, maxLines: number, maxBytes: number): Truncation {
  const lines = text.split("\n");
  const totalLines = lines.length;
  const output: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    if (output.length >= maxLines) break;
    const size = Buffer.byteLength(line, "utf8") + 1;
    if (bytes + size > maxBytes) break;
    output.push(line);
    bytes += size;
  }

  const truncated = output.length < totalLines;
  return {
    text: output.join("\n"),
    truncated,
    removed: totalLines - output.length,
    totalLines,
    outputLines: output.length,
  };
}
