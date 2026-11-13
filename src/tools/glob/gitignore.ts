import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

export type IgnoreMatcher = (relativePath: string) => boolean;

interface Rule {
  glob: Bun.Glob;
  basenameOnly: boolean;
  negate: boolean;
  dirOnly: boolean;
}

function compile(line: string): Rule | null {
  let pattern = line.endsWith("\r") ? line.slice(0, -1) : line;
  while (pattern.endsWith(" ") && !pattern.endsWith("\\ ")) pattern = pattern.slice(0, -1);
  if (!pattern || pattern.startsWith("#")) return null;
  const negate = pattern.startsWith("!");
  if (negate) pattern = pattern.slice(1);
  const dirOnly = pattern.endsWith("/");
  if (dirOnly) pattern = pattern.slice(0, -1);
  const anchored = pattern.startsWith("/");
  if (anchored) pattern = pattern.slice(1);
  if (!pattern) return null;
  return {
    glob: new Bun.Glob(pattern),
    basenameOnly: !anchored && !pattern.includes("/"),
    negate,
    dirOnly,
  };
}

function rulesFrom(text: string): Rule[] {
  return text
    .split("\n")
    .map(compile)
    .filter((rule): rule is Rule => rule !== null);
}

function apply(rules: Rule[], path: string, isDirectory: boolean, ignored: boolean): boolean {
  for (const rule of rules) {
    if (rule.dirOnly && !isDirectory) continue;
    const target = rule.basenameOnly ? path.slice(path.lastIndexOf("/") + 1) : path;
    if (rule.glob.match(target)) ignored = !rule.negate;
  }
  return ignored;
}

export function createIgnoreMatcher(text: string): IgnoreMatcher {
  const rules = rulesFrom(text);
  return (relativePath) => {
    const parts = relativePath.split("/");
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const isDirectory = depth < parts.length;
      const ignored = apply(rules, parts.slice(0, depth).join("/"), isDirectory, false);
      // Git cannot reinclude a file beneath an excluded parent directory.
      if (ignored) return true;
    }
    return false;
  };
}

/** Lazily read the ignore files on each candidate's ancestor chain, in Git precedence order. */
export async function readGitignore(
  root: string,
): Promise<(relativePath: string) => Promise<boolean>> {
  const cache = new Map<string, Promise<Rule[]>>();
  const load = (directory: string): Promise<Rule[]> => {
    let pending = cache.get(directory);
    if (pending) return pending;
    pending = (async () => {
      const path = join(root, directory, ".gitignore");
      const info = await lstat(path).catch(() => null);
      if (!info?.isFile() || info.size > 1024 * 1024) return [];
      return rulesFrom(await readFile(path, "utf8").catch(() => ""));
    })();
    cache.set(directory, pending);
    return pending;
  };
  await load("");
  return async (relativePath) => {
    const parts = relativePath.split("/");
    const scopes: { base: string; rules: Rule[] }[] = [{ base: "", rules: await load("") }];
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const path = parts.slice(0, depth).join("/");
      const isDirectory = depth < parts.length;
      let ignored = false;
      for (const scope of scopes) {
        const local = scope.base ? path.slice(scope.base.length + 1) : path;
        ignored = apply(scope.rules, local, isDirectory, ignored);
      }
      if (ignored) return true;
      if (isDirectory) scopes.push({ base: path, rules: await load(path) });
    }
    return false;
  };
}
