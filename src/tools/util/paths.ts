import { isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalPath } from "../../util/canonical-path";

const WINDOWS_RESERVED_DEVICES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

/** Rejects Windows reserved device names (CON, NUL, COM1, ...) and trailing space/dot segments. */
export function windowsReservedPathError(
  input: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform !== "win32") return undefined;
  const normalized = input.replaceAll("\\", "/");
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === "." || segment === "..") continue;
    // Skip drive letter prefixes like "C:".
    if (segment.length === 2 && segment[1] === ":") continue;
    if (segment.endsWith(" ") || segment.endsWith(".")) {
      return `Invalid Windows path segment "${segment}": names cannot end with a space or dot.`;
    }
    const dot = segment.indexOf(".");
    const stem = (dot >= 0 ? segment.slice(0, dot) : segment).toUpperCase();
    if (WINDOWS_RESERVED_DEVICES.has(stem)) {
      return `Refusing reserved Windows device name "${segment}" in path "${input}".`;
    }
  }
  return undefined;
}

export function resolveToolPath(cwd: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

export function isInside(
  cwd: string,
  path: string,
  externalPaths: readonly string[] = [],
): boolean {
  return [cwd, ...externalPaths].some(
    (root) => inside(resolve(root), path) || inside(canonicalPath(root), path),
  );
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, resolve(path));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function displayPath(cwd: string, path: string): string {
  if (!isInside(cwd, path)) return path;
  const root = inside(resolve(cwd), path) ? resolve(cwd) : canonicalPath(cwd);
  const rel = relative(root, resolve(path));
  return rel === "" ? "." : rel.split(sep).join("/");
}

// Standalone tool callers retain the legacy reason check; guarded calls carry directory authority.
export function outsideWhy(
  cwd: string,
  path: string,
  why: string | undefined,
  externalPaths: readonly string[] = [],
): string | undefined {
  if (isInside(cwd, path, externalPaths)) return undefined;
  if (why && why.trim().length > 0) return undefined;
  return `path "${path}" is outside the project; pass why`;
}

export function ensureInside(
  cwd: string,
  path: string,
  why: string | undefined,
  externalPaths: readonly string[] = [],
): void {
  const reason = outsideWhy(cwd, path, why, externalPaths);
  if (reason) throw new Error(reason);
}
