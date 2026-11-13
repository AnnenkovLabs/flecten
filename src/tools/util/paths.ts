import { isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalPath } from "../../util/canonical-path";

export function resolveToolPath(cwd: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

export function isInside(cwd: string, path: string): boolean {
  return inside(resolve(cwd), path) || inside(canonicalPath(cwd), path);
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

// ponytail: no sandbox yet. Outside paths need a written why; add read-only/workspace modes in the sandbox layer.
export function outsideWhy(cwd: string, path: string, why: string | undefined): string | undefined {
  if (isInside(cwd, path)) return undefined;
  if (why && why.trim().length > 0) return undefined;
  return `path "${path}" is outside the project; pass why`;
}

export function ensureInside(cwd: string, path: string, why: string | undefined): void {
  const reason = outsideWhy(cwd, path, why);
  if (reason) throw new Error(reason);
}
