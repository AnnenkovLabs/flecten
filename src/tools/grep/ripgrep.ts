import { basename, dirname } from "node:path";
import { z } from "zod";
import type { ToolResult } from "../../core/types";
import { withoutPrefix } from "../../util/text";
import { displayPath } from "../util/paths";
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

function result(
  args: GrepArgs,
  stdout: { text: string; capped: boolean },
  prefix: string,
): ToolResult {
  const limit = args.maxResults ?? 200;
  const fileMode = args.filesWithMatches || args.count;
  const output: string[] = [];
  const files = new Map<string, { count: number; complete: boolean }>();
  let count = 0;
  let truncated = false;
  let previous: { path: string; line: number } | undefined;
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
      if (end.data.stats.matched_lines > 0) {
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
    const matched = event.data.type === "match";
    if (fileMode) {
      if (matched) {
        const entry = files.get(path);
        files.set(path, { count: (entry?.count ?? 0) + 1, complete: false });
      }
      continue;
    }
    if (matched) {
      if (count >= limit) {
        truncated = true;
        break;
      }
      count += 1;
    }
    if (
      args.context &&
      previous &&
      (previous.path !== path || line.data.line_number > previous.line + 1)
    ) {
      output.push("--");
    }
    let text = decoded(line.data.lines);
    if (text.endsWith("\n")) text = text.slice(0, -1);
    if (text.endsWith("\r")) text = text.slice(0, -1);
    if (text.length > MAX_LINE) text = `${text.slice(0, MAX_LINE)}... [truncated]`;
    const separator = matched ? ":" : "-";
    output.push(`${path}${separator}${line.data.line_number}${separator} ${text}`);
    previous = { path, line: line.data.line_number };
  }

  if (fileMode) {
    const entries = [...files.entries()].sort(([left], [right]) => left.localeCompare(right));
    truncated = entries.length > limit;
    for (const [path, entry] of entries.slice(0, limit)) {
      output.push(
        args.filesWithMatches ? path : `${path}:${entry.count}${entry.complete ? "" : "+"}`,
      );
    }
    count = Math.min(entries.length, limit);
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
): Promise<ToolResult> {
  const limit = args.maxResults ?? 200;
  const command = [rg, "--json", "--no-config", "--no-require-git", "--color=never"];
  if (args.glob) command.push("--glob", args.glob);
  if (args.type) command.push("--type", args.type);
  if (args.literal) command.push("--fixed-strings");
  if (args.caseSensitive === false) command.push("--ignore-case");
  if (args.hidden) command.push("--hidden");
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
  return result(args, stdout, displayPath(cwd, isFile ? dirname(searchPath) : searchPath));
}
