import { isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalPath } from "../../util/canonical-path";

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
