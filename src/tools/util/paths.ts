import { isAbsolute, relative, resolve, sep } from "node:path";

export function resolveToolPath(cwd: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

export function isInside(cwd: string, path: string): boolean {
  const rel = relative(resolve(cwd), resolve(path));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function displayPath(cwd: string, path: string): string {
  if (!isInside(cwd, path)) return path;
  const rel = relative(resolve(cwd), resolve(path));
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
