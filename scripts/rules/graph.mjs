// Module graph for rule checks. Parses imports with the TypeScript and Svelte compilers,
// never with regular expressions.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parse as parseSvelte } from "svelte/compiler";
import ts from "typescript";

export const root = resolve(import.meta.dir, "../..");
export const CODE_EXTENSIONS = [".ts", ".mts", ".mjs", ".cjs", ".js", ".svelte"];

export function rel(file) {
  return relative(root, file).split(sep).join("/");
}

export function walk(dir, accept) {
  const out = [];
  const start = join(root, dir);
  if (!existsSync(start)) return out;
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const name of readdirSync(current)) {
      if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
      const path = join(current, name);
      const stat = statSync(path);
      if (stat.isDirectory()) stack.push(path);
      else if (accept(path)) out.push(path);
    }
  }
  return out.sort();
}

export function isCodeFile(path) {
  if (path.endsWith(".d.ts")) return false;
  return CODE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

const sourceCache = new Map();

/** Script source of a module. For Svelte files only the instance and module scripts. */
export function scriptSource(file) {
  const cached = sourceCache.get(file);
  if (cached !== undefined) return cached;
  const text = readFileSync(file, "utf8");
  let source = text;
  if (file.endsWith(".svelte")) {
    const ast = parseSvelte(text, { modern: true });
    source = [ast.module, ast.instance]
      .filter((script) => script !== null && script !== undefined)
      .map((script) => text.slice(script.content.start, script.content.end))
      .join("\n");
  }
  sourceCache.set(file, source);
  return source;
}

export function sourceFile(file) {
  return ts.createSourceFile(
    file,
    scriptSource(file),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

export function importSpecifiers(file) {
  const info = ts.preProcessFile(scriptSource(file), true, true);
  return info.importedFiles.map((entry) => entry.fileName);
}

const RESOLVE_SUFFIXES = [
  "",
  ".ts",
  ".svelte.ts",
  ".mjs",
  ".cjs",
  ".js",
  ".svelte",
  "/index.ts",
  "/index.mjs",
];

export function resolveImport(from, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(from), specifier);
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = resolve(base + suffix);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  if (base.endsWith(".js")) {
    const tsFile = `${base.slice(0, -3)}.ts`;
    if (existsSync(tsFile)) return tsFile;
  }
  return undefined;
}

/** Relative imports of a module that resolve to files inside the repository. */
export function localImports(file) {
  const out = [];
  for (const specifier of importSpecifiers(file)) {
    const target = resolveImport(file, specifier);
    if (target !== undefined) out.push({ specifier, target });
  }
  return out;
}

export function reachableFrom(entries) {
  const seen = new Set();
  const stack = entries.map((entry) => join(root, entry));
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    if (!isCodeFile(file)) continue;
    for (const { target } of localImports(file)) if (!seen.has(target)) stack.push(target);
  }
  return seen;
}
