/** Parsers for the NUL-separated plumbing formats the shadow repository reads. */

export function nulList(output: Buffer): string[] {
  const out: string[] = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    if (index > start) out.push(output.toString("utf8", start, index));
    start = index + 1;
  }
  if (start < output.length) out.push(output.toString("utf8", start));
  return out;
}

export const GITLINK_MODE = "160000";
export const SYMLINK_MODE = "120000";
export const ZERO_ID = "0000000000000000000000000000000000000000";

export interface TreeChange {
  path: string;
  status: "A" | "D" | "M" | "T";
  beforeMode: string;
  afterMode: string;
  beforeId?: string;
  afterId?: string;
}

const STATUSES = new Set(["A", "D", "M", "T"]);

/** `git diff-tree -r -z --raw`: `:mode mode id id status\0path\0` per entry. */
export function parseRawDiff(output: Buffer): TreeChange[] {
  const fields = nulList(output);
  const changes: TreeChange[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const meta = fields[index] ?? "";
    const path = fields[index + 1] ?? "";
    if (!meta.startsWith(":")) continue;
    const [beforeMode = "", afterMode = "", beforeId = "", afterId = "", status = ""] = meta
      .slice(1)
      .split(" ");
    if (!STATUSES.has(status)) continue;
    changes.push({
      path,
      status: status as TreeChange["status"],
      beforeMode,
      afterMode,
      ...(beforeId === ZERO_ID ? {} : { beforeId }),
      ...(afterId === ZERO_ID ? {} : { afterId }),
    });
  }
  return changes;
}

/** `git check-attr -z`: `path\0attribute\0value\0` triples; returns paths with any value set. */
export function attributedPaths(output: Buffer): Set<string> {
  const fields = nulList(output);
  const out = new Set<string>();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const path = fields[index];
    const value = fields[index + 2];
    if (path === undefined || value === undefined) continue;
    if (value !== "unspecified" && value !== "unset") out.add(path);
  }
  return out;
}

/** `git cat-file --batch-check`: `id type size` per line. */
export function parseBatchCheck(output: Buffer): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const line of output.toString("utf8").split("\n")) {
    const [id, type, size] = line.split(" ");
    if (id === undefined || type !== "blob" || size === undefined) continue;
    const value = Number(size);
    if (Number.isSafeInteger(value)) sizes.set(id, value);
  }
  return sizes;
}

/** `git cat-file --batch`: `id type size\n<content>\n` per object. */
export function parseBatch(output: Buffer): Map<string, Buffer> {
  const blobs = new Map<string, Buffer>();
  let offset = 0;
  while (offset < output.length) {
    const newline = output.indexOf(10, offset);
    if (newline < 0) break;
    const [id, type, size] = output.toString("utf8", offset, newline).split(" ");
    offset = newline + 1;
    if (id === undefined || type === "missing" || size === undefined) continue;
    const length = Number(size);
    if (!Number.isSafeInteger(length) || offset + length > output.length) break;
    if (type === "blob") blobs.set(id, output.subarray(offset, offset + length));
    offset += length + 1;
  }
  return blobs;
}

export function nulInput(paths: readonly string[]): string {
  return paths.length === 0 ? "" : `${paths.join("\0")}\0`;
}
