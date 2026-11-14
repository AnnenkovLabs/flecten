import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import type { ToolResult } from "../../core/types";
import { readGitignore } from "../glob/gitignore";
import { displayPath, resolveToolPath } from "../util/paths";
import { canReadSearchPath, type SearchContext } from "../util/read-permission";
import { createLineMatcher } from "./line-matcher";
import { runRipgrep } from "./ripgrep";
import type { GrepArgs } from "./schema";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_LINE = 500;
const IGNORED = ["node_modules", ".git", "dist", "release", ".liquid", ".kilo"];

const TYPE_EXTENSIONS: Record<string, string[]> = {
  ts: [".ts", ".tsx", ".mts", ".cts"],
  js: [".js", ".jsx", ".mjs", ".cjs"],
  py: [".py"],
  go: [".go"],
  rust: [".rs"],
  java: [".java"],
  c: [".c", ".h"],
  cpp: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"],
  json: [".json"],
  md: [".md", ".markdown"],
  css: [".css", ".scss"],
  html: [".html", ".htm"],
  yaml: [".yaml", ".yml"],
  sh: [".sh", ".bash"],
  svelte: [".svelte"],
};

function ignored(path: string): boolean {
  return path.split("/").some((segment) => IGNORED.includes(segment));
}

function scanPattern(pattern: string): string {
  return pattern.includes("/") ? pattern : `**/${pattern}`;
}

function lineText(line: string): string {
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}... [truncated]` : line;
}

interface FileOutcome {
  truncated: boolean;
}

async function runGrepFallbackFile(
  fullPath: string,
  display: string,
  matches: (lines: string[]) => Promise<number[]>,
  args: GrepArgs,
  state: { matches: number; files: number; skipped: number },
  context: number,
  limit: number,
  output: string[],
): Promise<FileOutcome> {
  let info: Stats;
  try {
    info = await stat(fullPath);
  } catch {
    state.skipped += 1;
    return { truncated: false };
  }
  if (!info.isFile() || info.size > MAX_FILE_BYTES) {
    state.skipped += 1;
    return { truncated: false };
  }

  let text: string;
  try {
    text = await Bun.file(fullPath).text();
  } catch {
    state.skipped += 1;
    return { truncated: false };
  }
  if (text.includes("\0")) {
    state.skipped += 1;
    return { truncated: false };
  }

  const lines = text.split("\n");
  const indices = await matches(lines);
  if (indices.length === 0) return { truncated: false };
  const matchingLines = new Set(indices);

  if (args.filesWithMatches) {
    if (state.files >= limit) return { truncated: true };
    output.push(display);
    state.files += 1;
    return { truncated: false };
  }
  if (args.count) {
    if (state.files >= limit) return { truncated: true };
    output.push(`${display}:${indices.length}`);
    state.files += 1;
    return { truncated: false };
  }

  let lastPrinted = -1;
  for (const index of indices) {
    if (state.matches >= limit) return { truncated: true };
    state.matches += 1;
    const from = Math.max(0, index - context);
    if (context > 0 && lastPrinted >= 0 && from > lastPrinted + 1) output.push("--");
    const to = Math.min(lines.length - 1, index + context);
    for (let line = Math.max(from, lastPrinted + 1); line <= to; line += 1) {
      const separator = matchingLines.has(line) ? ":" : "-";
      output.push(`${display}${separator}${line + 1}${separator} ${lineText(lines[line] ?? "")}`);
      lastPrinted = line;
    }
  }
  return { truncated: false };
}

async function searchFallback(
  args: GrepArgs,
  context: SearchContext,
  matches: (lines: string[]) => Promise<number[]>,
): Promise<ToolResult> {
  const searchPath = resolveToolPath(context.cwd, args.path ?? ".");
  let isFile = false;
  try {
    const info = await stat(searchPath);
    isFile = info.isFile();
    if (!isFile && !info.isDirectory()) {
      return {
        ok: false,
        output: "",
        error: `Not a regular file or directory: ${args.path ?? "."}`,
      };
    }
  } catch {
    return { ok: false, output: "", error: `Path not found: ${args.path ?? "."}` };
  }

  const typeExtensions = args.type ? TYPE_EXTENSIONS[args.type] : undefined;
  if (args.type && !typeExtensions) {
    return {
      ok: false,
      output: "",
      error: `File type "${args.type}" is not available without ripgrep; use a glob or install ripgrep`,
    };
  }

  const limit = args.maxResults ?? 200;
  const filesWithMatches = args.filesWithMatches === true;
  const count = args.count === true && !filesWithMatches;
  const contextLines = filesWithMatches || count ? 0 : (args.context ?? 0);
  const glob = args.glob ? new Bun.Glob(scanPattern(args.glob)) : undefined;
  const prefix = displayPath(context.cwd, isFile ? dirname(searchPath) : searchPath);
  const matcher = isFile ? undefined : await readGitignore(context.cwd);
  const state = { matches: 0, files: 0, skipped: 0 };
  const output: string[] = [];
  let truncated = false;

  const accept = async (relative: string): Promise<boolean> => {
    if (ignored(relative)) return false;
    if (!(await canReadSearchPath(context, join(searchPath, relative), "grep"))) return false;
    if (matcher && (await matcher(prefix === "." ? relative : `${prefix}/${relative}`)))
      return false;
    if (glob && !glob.match(relative)) return false;
    if (typeExtensions && !typeExtensions.some((extension) => relative.endsWith(extension))) {
      return false;
    }
    return true;
  };

  if (isFile) {
    if (!(await canReadSearchPath(context, searchPath, "grep")))
      return { ok: false, output: "", error: "Search path is denied by the active permissions" };
    const display = displayPath(context.cwd, searchPath);
    const outcome = await runGrepFallbackFile(
      searchPath,
      display,
      matches,
      { ...args, filesWithMatches, count },
      state,
      contextLines,
      limit,
      output,
    );
    truncated = outcome.truncated;
  } else {
    const relatives: string[] = [];
    const scanner = new Bun.Glob("**/*");
    for await (const nativePath of scanner.scan({
      cwd: searchPath,
      onlyFiles: true,
      dot: args.hidden === true,
    })) {
      const relative = nativePath.split(sep).join("/");
      if (context.signal.aborted) return { ok: false, output: "", error: "Search aborted" };
      if (await accept(relative)) relatives.push(relative);
    }
    relatives.sort();
    for (const relative of relatives) {
      if (context.signal.aborted) return { ok: false, output: "", error: "Search aborted" };
      if (!(await canReadSearchPath(context, join(searchPath, relative), "grep"))) continue;
      const display = prefix === "." ? relative : `${prefix}/${relative}`;
      const outcome = await runGrepFallbackFile(
        join(searchPath, relative),
        display,
        matches,
        { ...args, filesWithMatches, count },
        state,
        contextLines,
        limit,
        output,
      );
      if (outcome.truncated) {
        truncated = true;
        break;
      }
    }
  }

  const parts: string[] = [];
  if (output.length === 0) parts.push("No matches found");
  else parts.push(output.join("\n"));
  if (truncated) {
    const unit = filesWithMatches || count ? "files" : "matches";
    parts.push(`[${limit} ${unit} limit reached; refine the pattern]`);
  }
  if (state.skipped > 0) {
    parts.push(
      `[Skipped ${state.skipped} files: binary, larger than 1MB, unreadable, or special files.]`,
    );
  }
  return {
    ok: true,
    output: parts.join("\n\n"),
    data: {
      kind: "search",
      pattern: args.pattern,
      count: filesWithMatches || count ? state.files : state.matches,
    },
  };
}

export async function runGrepFallback(args: GrepArgs, context: SearchContext): Promise<ToolResult> {
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(10_000)]);
  const matcher = args.literal
    ? undefined
    : createLineMatcher(args.pattern, args.caseSensitive !== false, signal);
  const needle = args.caseSensitive === false ? args.pattern.toLowerCase() : args.pattern;
  try {
    await matcher?.ready;
    return await searchFallback(args, { ...context, signal }, async (lines) => {
      if (matcher) return matcher.match(lines);
      const indices: number[] = [];
      for (const [index, line] of lines.entries()) {
        if ((args.caseSensitive === false ? line.toLowerCase() : line).includes(needle)) {
          indices.push(index);
        }
      }
      return indices;
    });
  } catch (error) {
    return {
      ok: false,
      output: "",
      error: signal.aborted ? "Search aborted" : String(error),
    };
  } finally {
    await matcher?.close();
  }
}

export async function runGrep(args: GrepArgs, context: SearchContext): Promise<ToolResult> {
  // ponytail: per-file guards use native traversal; a curated rg file plan can restore acceleration.
  if (context.permissions || context.sandbox) return runGrepFallback(args, context);
  const searchPath = resolveToolPath(context.cwd, args.path ?? ".");
  let isFile = false;
  try {
    const info = await stat(searchPath);
    isFile = info.isFile();
    if (!isFile && !info.isDirectory()) {
      return {
        ok: false,
        output: "",
        error: `Not a regular file or directory: ${args.path ?? "."}`,
      };
    }
  } catch {
    return { ok: false, output: "", error: `Path not found: ${args.path ?? "."}` };
  }

  const rg = Bun.which("rg");
  if (rg) {
    return runRipgrep(rg, args.pattern, searchPath, isFile, args, context.cwd, context.signal);
  }
  return runGrepFallback(args, context);
}
