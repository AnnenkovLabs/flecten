import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import type { ToolResult } from "../../core/types";
import { readGitignore } from "../glob/gitignore";
import { tokenizeIdentifierTerms } from "../util/code-symbols";
import { displayPath, resolveToolPath } from "../util/paths";
import { canReadSearchPath, type SearchContext } from "../util/read-permission";
import { enrichTopRankedBlocks, expandFileMatchIndices, findBm25LinesInFile } from "./bm25";
import { createLineMatcher } from "./line-matcher";
import { type GrepBlock, rankGrepBlocks, renderGrepBlocks } from "./ranking";
import { runRipgrep, runRipgrepBm25Fallback } from "./ripgrep";
import type { GrepArgs } from "./schema";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_LINE = 500;
const IGNORED = [
  "node_modules",
  ".git",
  "dist",
  "release",
  ".flecten",
  ".liquid",
  ".flecten-migration",
  ".flecten-scratch",
  ".kilo",
];

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
  blocks: GrepBlock[],
  bm25State?: { readonly queryTerms: readonly string[]; readonly blocks: GrepBlock[] },
  reads?: { record(path: string, content: string): void },
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

  const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const indices = await matches(lines);
  if (indices.length === 0) {
    if (
      bm25State &&
      !args.literal &&
      !args.filesWithMatches &&
      !args.count &&
      blocks.length === 0 &&
      bm25State.queryTerms.length >= 2
    ) {
      const hits = findBm25LinesInFile(lines, bm25State.queryTerms, display);
      if (hits.length > 0) {
        reads?.record(fullPath, text);
        const expanded = expandFileMatchIndices(
          lines,
          hits.map((hit) => hit.index),
          context,
          limit,
          display,
          lineText,
        );
        bm25State.blocks.push(...expanded.blocks);
      }
    }
    return { truncated: false };
  }

  reads?.record(fullPath, text);

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

  const expanded = expandFileMatchIndices(
    lines,
    indices,
    context,
    Math.max(1, limit * 4 - state.matches),
    display,
    lineText,
  );
  blocks.push(...expanded.blocks);
  state.matches += expanded.matchesUsed;
  return { truncated: expanded.truncated };
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
  const blocks: GrepBlock[] = [];
  const queryTerms = tokenizeIdentifierTerms(args.pattern);
  const bm25State =
    !args.literal && queryTerms.length >= 2 ? { queryTerms, blocks: [] as GrepBlock[] } : undefined;
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
      blocks,
      bm25State,
      context.reads,
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
        blocks,
        bm25State,
        context.reads,
      );
      if (outcome.truncated) {
        truncated = true;
        break;
      }
    }
  }

  const usedBm25 = blocks.length === 0 && (bm25State?.blocks.length ?? 0) > 0;
  const candidateBlocks = blocks.length > 0 ? blocks : (bm25State?.blocks ?? []);

  if (!filesWithMatches && !count && candidateBlocks.length > 0) {
    const ranked = rankGrepBlocks(candidateBlocks, args.pattern);
    const fileLinesCache = new Map<string, { fullPath: string; lines: string[] } | null>();
    for (let i = 0; i < Math.min(5, ranked.length); i += 1) {
      const b = ranked[i];
      if (!b || fileLinesCache.has(b.path)) continue;
      try {
        const fullPath = resolveToolPath(context.cwd, b.path);
        const text = await Bun.file(fullPath).text();
        const lines = text
          .split("\n")
          .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
        fileLinesCache.set(b.path, { fullPath, lines });
      } catch {
        fileLinesCache.set(b.path, null);
      }
    }
    const enriched = enrichTopRankedBlocks(
      ranked,
      contextLines,
      args.pattern,
      (relPath) => fileLinesCache.get(relPath) ?? undefined,
      lineText,
      context.reads,
    );
    const rendered = renderGrepBlocks(enriched, contextLines > 0, limit);
    output.push(...rendered.lines);
    state.matches = rendered.count;
    if (rendered.truncated) truncated = true;
  }

  const parts: string[] = [];
  if (output.length === 0) parts.push("No matches found");
  else parts.push(output.join("\n"));
  if (usedBm25 && output.length > 0) {
    parts.push("[No exact regex matches; showing BM25 identifier matches]");
  }
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

function matchLiteralLines(
  lines: readonly string[],
  needle: string,
  caseSensitive: boolean,
  multiline: boolean,
): number[] {
  if (!multiline) {
    const indices: number[] = [];
    for (const [index, line] of lines.entries()) {
      if ((caseSensitive ? line : line.toLowerCase()).includes(needle)) indices.push(index);
    }
    return indices;
  }
  if (lines.length === 0 || needle.length === 0) return [];
  const hayLines = caseSensitive ? lines : lines.map((line) => line.toLowerCase());
  const joined = hayLines.join("\n");
  const starts: number[] = new Array(hayLines.length);
  let offset = 0;
  for (let i = 0; i < hayLines.length; i += 1) {
    starts[i] = offset;
    offset += (hayLines[i]?.length ?? 0) + 1;
  }
  const lineFor = (pos: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] ?? 0) <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const hit = new Set<number>();
  let fromPos = joined.indexOf(needle, 0);
  while (fromPos >= 0) {
    const from = lineFor(fromPos);
    const to = lineFor(fromPos + needle.length - 1);
    for (let i = from; i <= to; i += 1) hit.add(i);
    fromPos = joined.indexOf(needle, fromPos + needle.length);
  }
  return [...hit].sort((a, b) => a - b);
}

export async function runGrepFallback(args: GrepArgs, context: SearchContext): Promise<ToolResult> {
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(10_000)]);
  const matcher = args.literal
    ? undefined
    : createLineMatcher(
        args.pattern,
        args.caseSensitive !== false,
        signal,
        args.multiline === true,
      );
  const needle = args.caseSensitive === false ? args.pattern.toLowerCase() : args.pattern;
  try {
    await matcher?.ready;
    return await searchFallback(args, { ...context, signal }, async (lines) => {
      if (matcher) return matcher.match(lines);
      return matchLiteralLines(
        lines,
        needle,
        args.caseSensitive !== false,
        args.multiline === true,
      );
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

  if (isFile && (context.permissions || context.sandbox)) {
    if (!(await canReadSearchPath(context, searchPath, "grep"))) {
      return { ok: false, output: "", error: "Search path is denied by the active permissions" };
    }
  }

  const rg = Bun.which("rg");
  if (rg) {
    const verifyPath =
      context.permissions || context.sandbox
        ? (fullPath: string) => canReadSearchPath(context, fullPath, "grep")
        : undefined;
    const res = await runRipgrep(
      rg,
      args.pattern,
      searchPath,
      isFile,
      args,
      context.cwd,
      context.signal,
      context.reads,
      verifyPath,
    );
    if (!args.literal && res.ok && res.output === "No matches found") {
      const queryTerms = tokenizeIdentifierTerms(args.pattern);
      if (queryTerms.length >= 2) {
        const fastBm25 = await runRipgrepBm25Fallback(
          rg,
          queryTerms,
          searchPath,
          isFile,
          args,
          context.cwd,
          context.signal,
          context.reads,
          verifyPath,
        );
        if (fastBm25) return fastBm25;
        return runGrepFallback(args, context);
      }
    }
    return res;
  }
  return runGrepFallback(args, context);
}
