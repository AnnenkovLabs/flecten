import { basename, dirname, join } from "node:path";
import { z } from "zod";
import type { ToolResult } from "../../core/types";
import { withoutPrefix } from "../../util/text";
import { displayPath } from "../util/paths";
import { enrichTopRankedBlocks, expandFileMatchIndices, findBm25LinesInFile } from "./bm25";
import { type GrepBlock, type GrepRenderLine, rankGrepBlocks, renderGrepBlocks } from "./ranking";
import type { GrepArgs } from "./schema";

const MAX_COLLECT = 2 * 1024 * 1024;
const MAX_LINE = 500;
const textSchema = z.union([z.object({ text: z.string() }), z.object({ bytes: z.string() })]);
const envelopeSchema = z.object({ type: z.string(), data: z.unknown() });
const lineSchema = z.object({
  path: textSchema,
  lines: textSchema,
  line_number: z.number().int().positive(),
});
const endSchema = z.object({
  path: textSchema,
  stats: z.object({ matched_lines: z.number().int().nonnegative() }),
});

function decoded(value: z.infer<typeof textSchema>): string {
  return "text" in value ? value.text : Buffer.from(value.bytes, "base64").toString("utf8");
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<{
  text: string;
  capped: boolean;
}> {
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  let capped = false;
  for await (const chunk of stream) {
    const slice = chunk.subarray(0, Math.max(0, MAX_COLLECT - bytes));
    if (slice.length < chunk.length) capped = true;
    text += decoder.decode(slice, { stream: true });
    bytes += slice.length;
  }
  return { text: text + decoder.decode(), capped };
}

function formatLineText(line: string): string {
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}... [truncated]` : line;
}

async function attachEnclosingHeaders(
  blocks: readonly GrepBlock[],
  contextLines: number,
  pattern: string,
  cwd: string,
  reads?: {
    record(path: string, content: string): void;
    markSymbolShown?(path: string, startLine: number, endLine: number, body: string): boolean;
  },
): Promise<GrepBlock[]> {
  if (blocks.length === 0) return [...blocks];
  const fileCache = new Map<string, { fullPath: string; lines: string[] } | null>();
  const topCount = Math.min(10, blocks.length);

  for (let i = 0; i < topCount; i += 1) {
    const block = blocks[i];
    if (!block || block.lines.length === 0 || fileCache.has(block.path)) continue;
    try {
      const fullPath = join(cwd, block.path);
      const text = await Bun.file(fullPath).text();
      reads?.record(fullPath, text);
      const lines = text
        .split("\n")
        .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
      fileCache.set(block.path, { fullPath, lines });
    } catch {
      fileCache.set(block.path, null);
    }
  }

  return enrichTopRankedBlocks(
    blocks,
    contextLines,
    pattern,
    (relPath) => fileCache.get(relPath) ?? undefined,
    formatLineText,
    reads,
  );
}

async function result(
  args: GrepArgs,
  stdout: { text: string; capped: boolean },
  prefix: string,
  cwd: string,
  reads?: {
    record(path: string, content: string): void;
    markSymbolShown?(path: string, startLine: number, endLine: number, body: string): boolean;
  },
  verifyPath?: (fullPath: string) => Promise<boolean>,
): Promise<ToolResult> {
  const limit = args.maxResults ?? 200;
  const fileMode = args.filesWithMatches || args.count;
  const output: string[] = [];
  const files = new Map<string, { count: number; complete: boolean }>();
  const blocks: GrepBlock[] = [];
  const allowedCache = new Map<string, boolean>();
  const isAllowed = async (relPath: string): Promise<boolean> => {
    if (!verifyPath) return true;
    const cached = allowedCache.get(relPath);
    if (cached !== undefined) return cached;
    const ok = await verifyPath(join(cwd, relPath));
    allowedCache.set(relPath, ok);
    return ok;
  };
  let currentLines: GrepRenderLine[] = [];
  let currentMatches = 0;
  let count = 0;
  let truncated = false;
  let previous: { path: string; line: number } | undefined;
  const flushBlock = (): void => {
    if (currentLines.length === 0) return;
    blocks.push({
      path: currentLines[0]?.path ?? "",
      firstLine: currentLines[0]?.line ?? 1,
      matchCount: currentMatches,
      lines: currentLines,
    });
    currentLines = [];
    currentMatches = 0;
  };
  const pathFor = (path: z.infer<typeof textSchema>): string => {
    const clean = withoutPrefix(decoded(path), "./");
    return prefix === "." ? clean : `${prefix}/${clean}`;
  };

  // Ripgrep's JSON events distinguish matches from context even when paths contain
  // colons, digits or newlines. Human output cannot carry that distinction safely.
  const records = stdout.text.split("\n");
  if (stdout.capped && records.at(-1) !== "") records.pop();
  for (const record of records) {
    if (record.length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(record);
    } catch {
      return { ok: false, output: "", error: "ripgrep returned invalid JSON output" };
    }
    const event = envelopeSchema.safeParse(raw);
    if (!event.success) {
      return { ok: false, output: "", error: "ripgrep returned an invalid event" };
    }
    if (event.data.type === "end" && fileMode) {
      const end = endSchema.safeParse(event.data.data);
      if (!end.success) {
        return { ok: false, output: "", error: "ripgrep returned invalid file statistics" };
      }
      const path = pathFor(end.data.path);
      if (end.data.stats.matched_lines > 0 && (await isAllowed(path))) {
        files.set(path, { count: end.data.stats.matched_lines, complete: true });
      }
      continue;
    }
    if (event.data.type !== "match" && event.data.type !== "context") continue;
    const line = lineSchema.safeParse(event.data.data);
    if (!line.success) {
      return { ok: false, output: "", error: "ripgrep returned an invalid match" };
    }
    const path = pathFor(line.data.path);
    if (!(await isAllowed(path))) continue;
    const matched = event.data.type === "match";
    if (fileMode) {
      if (matched) {
        const entry = files.get(path);
        files.set(path, { count: (entry?.count ?? 0) + 1, complete: false });
      }
      continue;
    }
    if (
      previous &&
      (previous.path !== path || !args.context || line.data.line_number > previous.line + 1)
    ) {
      flushBlock();
    }
    let text = decoded(line.data.lines);
    if (text.endsWith("\n")) text = text.slice(0, -1);
    if (text.endsWith("\r")) text = text.slice(0, -1);
    if (text.length > MAX_LINE) text = `${text.slice(0, MAX_LINE)}... [truncated]`;
    if (matched) currentMatches += 1;
    currentLines.push({ path, line: line.data.line_number, matched, text });
    previous = { path, line: line.data.line_number };
  }
  flushBlock();

  if (fileMode) {
    const entries = [...files.entries()].sort(([left], [right]) => left.localeCompare(right));
    truncated = entries.length > limit;
    for (const [path, entry] of entries.slice(0, limit)) {
      output.push(
        args.filesWithMatches ? path : `${path}:${entry.count}${entry.complete ? "" : "+"}`,
      );
    }
    count = Math.min(entries.length, limit);
  } else {
    const ranked = rankGrepBlocks(blocks, args.pattern);
    const enriched = await attachEnclosingHeaders(
      ranked,
      args.context ?? 0,
      args.pattern,
      cwd,
      reads,
    );
    const rendered = renderGrepBlocks(enriched, Boolean(args.context), limit);
    output.push(...rendered.lines);
    count = rendered.count;
    truncated = rendered.truncated;
  }
  if (truncated) {
    output.push(`[${limit} ${fileMode ? "files" : "matches"} limit reached; refine the pattern]`);
  } else if (stdout.capped) {
    output.push("[Output capped; refine the pattern]");
  }
  return {
    ok: true,
    output: output.join("\n") || "No matches found",
    data: { kind: "search", pattern: args.pattern, count },
  };
}

export async function runRipgrep(
  rg: string,
  pattern: string,
  searchPath: string,
  isFile: boolean,
  args: GrepArgs,
  cwd: string,
  signal: AbortSignal,
  reads?: {
    record(path: string, content: string): void;
    markSymbolShown?(path: string, startLine: number, endLine: number, body: string): boolean;
  },
  verifyPath?: (fullPath: string) => Promise<boolean>,
): Promise<ToolResult> {
  const limit = args.maxResults ?? 200;
  const command = [rg, "--json", "--no-config", "--no-require-git", "--color=never"];
  if (args.glob) command.push("--glob", args.glob);
  if (args.type) command.push("--type", args.type);
  if (args.literal) command.push("--fixed-strings");
  if (args.caseSensitive === false) command.push("--ignore-case");
  if (args.hidden) command.push("--hidden");
  command.push("--glob", "!**/.flecten-migration/**");
  command.push("--glob", "!**/.flecten-scratch/**");
  command.push("--glob", "!**/.flecten/secrets.json");
  command.push("--glob", "!**/.liquid/secrets.json");
  command.push("--glob", "!**/secrets.json");
  command.push("--glob", "!**/.env");
  command.push("--glob", "!**/.env.*");
  if (!args.filesWithMatches && !args.count) {
    if (args.context) command.push("--context", String(args.context));
    // One extra match is needed to report truncation in a single matching file.
    command.push("--max-count", String(limit + 1));
  } else if (args.filesWithMatches) {
    command.push("--max-count", "1");
  }
  command.push("--", pattern, isFile ? basename(searchPath) : ".");

  const proc = Bun.spawn({
    cmd: command,
    cwd: isFile ? dirname(searchPath) : searchPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  const abort = () => proc.kill("SIGKILL");
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const [stdout, stderr, exitCode] = await Promise.all([
    collect(proc.stdout),
    collect(proc.stderr),
    proc.exited,
  ]);
  signal.removeEventListener("abort", abort);
  if (signal.aborted) return { ok: false, output: "", error: "Search aborted" };
  if (exitCode !== 0 && exitCode !== 1) {
    return {
      ok: false,
      output: "",
      error: stderr.text.trim() || `ripgrep exited with code ${exitCode}`,
    };
  }
  return result(
    args,
    stdout,
    displayPath(cwd, isFile ? dirname(searchPath) : searchPath),
    cwd,
    reads,
    verifyPath,
  );
}

function isAsciiIdentTerm(term: string): boolean {
  if (term.length < 2) return false;
  for (let i = 0; i < term.length; i += 1) {
    const code = term.charCodeAt(i);
    const ok =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 95;
    if (!ok) return false;
  }
  return true;
}

/**
 * Fast ripgrep-prefiltered Okapi BM25 fallback: uses `rg --files-with-matches -i` with an
 * alternation of query subtokens to narrow the workspace in milliseconds, then scores only
 * those candidate files with `findBm25LinesInFile`.
 */
export async function runRipgrepBm25Fallback(
  rg: string,
  queryTerms: readonly string[],
  searchPath: string,
  isFile: boolean,
  args: GrepArgs,
  cwd: string,
  signal: AbortSignal,
  reads?: {
    record(path: string, content: string): void;
    markSymbolShown?(path: string, startLine: number, endLine: number, body: string): boolean;
  },
  verifyPath?: (fullPath: string) => Promise<boolean>,
): Promise<ToolResult | undefined> {
  if (args.filesWithMatches || args.count) return undefined;
  const safeTerms = [...new Set(queryTerms.filter(isAsciiIdentTerm))].slice(0, 12);
  if (safeTerms.length < 2) return undefined;

  const limit = args.maxResults ?? 200;
  const contextLines = args.context ?? 0;
  const prefix = displayPath(cwd, isFile ? dirname(searchPath) : searchPath);

  let candidateRelPaths: string[];
  if (isFile) {
    candidateRelPaths = [basename(searchPath)];
  } else {
    const command = [
      rg,
      "--files-with-matches",
      "--no-config",
      "--no-require-git",
      "--color=never",
      "--ignore-case",
      "--path-separator=/",
    ];
    if (args.glob) command.push("--glob", args.glob);
    if (args.type) command.push("--type", args.type);
    if (args.hidden) command.push("--hidden");
    command.push("--glob", "!**/.flecten-migration/**");
    command.push("--glob", "!**/.flecten-scratch/**");
    command.push("--glob", "!**/.flecten/secrets.json");
    command.push("--glob", "!**/.liquid/secrets.json");
    command.push("--glob", "!**/secrets.json");
    command.push("--glob", "!**/.env");
    command.push("--glob", "!**/.env.*");
    command.push("--", safeTerms.join("|"), ".");

    const proc = Bun.spawn({
      cmd: command,
      cwd: searchPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const abort = () => proc.kill("SIGKILL");
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    const [stdout, , exitCode] = await Promise.all([
      collect(proc.stdout),
      collect(proc.stderr),
      proc.exited,
    ]);
    signal.removeEventListener("abort", abort);
    if (signal.aborted || (exitCode !== 0 && exitCode !== 1)) return undefined;
    candidateRelPaths = stdout.text
      .split("\n")
      .map((line) => withoutPrefix(line.trim(), "./"))
      .filter((line) => line.length > 0)
      .sort()
      .slice(0, 250);
  }

  if (candidateRelPaths.length === 0) return undefined;

  const baseDir = isFile ? dirname(searchPath) : searchPath;
  const blocks: GrepBlock[] = [];
  for (const rel of candidateRelPaths) {
    if (signal.aborted) return undefined;
    const fullPath = join(baseDir, rel);
    if (verifyPath && !(await verifyPath(fullPath))) continue;
    let text: string;
    try {
      const file = Bun.file(fullPath);
      if (file.size > 1024 * 1024) continue;
      text = await file.text();
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    const display = prefix === "." ? rel : `${prefix}/${rel}`;
    const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
    const hits = findBm25LinesInFile(lines, queryTerms, display);
    if (hits.length === 0) continue;
    reads?.record(fullPath, text);
    const expanded = expandFileMatchIndices(
      lines,
      hits.map((hit) => hit.index),
      contextLines,
      limit,
      display,
      formatLineText,
    );
    blocks.push(...expanded.blocks);
  }

  if (blocks.length === 0) return undefined;
  const ranked = rankGrepBlocks(blocks, args.pattern);
  const enriched = await attachEnclosingHeaders(ranked, contextLines, args.pattern, cwd, reads);
  const rendered = renderGrepBlocks(enriched, contextLines > 0, limit);
  const output = [...rendered.lines];
  if (rendered.truncated) {
    output.push(`[${limit} matches limit reached; refine the pattern]`);
  }
  return {
    ok: true,
    output: output.join("\n") || "No matches found",
    data: { kind: "search", pattern: args.pattern, count: rendered.count },
  };
}
