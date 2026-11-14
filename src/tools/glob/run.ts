import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { join, sep } from "node:path";
import type { ToolResult } from "../../core/types";
import { withoutPrefix } from "../../util/text";
import { displayPath, resolveToolPath } from "../util/paths";
import { canReadSearchPath, type SearchContext } from "../util/read-permission";
import { readGitignore } from "./gitignore";
import type { GlobArgs } from "./schema";

const MAX_COLLECT = 2 * 1024 * 1024;
const IGNORED = ["node_modules", ".git", "dist", "release", ".liquid", ".kilo"];

function ignored(path: string): boolean {
  return path.split("/").some((segment) => IGNORED.includes(segment));
}

function scanPattern(pattern: string): string {
  return pattern.includes("/") ? pattern : `**/${pattern}`;
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
    if (bytes + chunk.length > MAX_COLLECT) {
      capped = true;
      const slice = chunk.subarray(0, MAX_COLLECT - bytes);
      text += decoder.decode(slice, { stream: true });
      bytes = MAX_COLLECT;
      continue;
    }
    text += decoder.decode(chunk, { stream: true });
    bytes += chunk.length;
  }
  return { text: text + decoder.decode(), capped };
}

function finish(args: GlobArgs, results: string[], limit: number, capped: boolean): ToolResult {
  results.sort();
  if (results.length === 0) {
    return {
      ok: true,
      output: "No files found matching pattern",
      data: { kind: "glob", pattern: args.pattern, count: 0 },
    };
  }
  const total = results.length;
  const shown = results.slice(0, limit);
  const parts = [shown.join("\n")];
  if (total > limit) {
    parts.push(`[Showing ${limit} of ${total} files; refine the pattern or raise maxResults.]`);
  } else if (capped) {
    parts.push(`[File list capped at ${MAX_COLLECT} bytes; refine the pattern.]`);
  }
  return {
    ok: true,
    output: parts.join("\n\n"),
    data: { kind: "glob", pattern: args.pattern, count: shown.length },
  };
}

async function validateDirectory(path: string, label: string): Promise<string | undefined> {
  let info: Stats;
  try {
    info = await stat(path);
  } catch {
    return `Path not found: ${label}`;
  }
  if (!info.isDirectory()) return `${label} is a file; glob searches directories`;
  return undefined;
}

export async function runGlobFallback(args: GlobArgs, context: SearchContext): Promise<ToolResult> {
  const searchPath = resolveToolPath(context.cwd, args.path ?? ".");
  const problem = await validateDirectory(searchPath, args.path ?? ".");
  if (problem) return { ok: false, output: "", error: problem };

  const limit = args.maxResults ?? 500;
  const prefix = displayPath(context.cwd, searchPath);
  const matcher = await readGitignore(context.cwd);
  const glob = new Bun.Glob(scanPattern(args.pattern));
  const results: string[] = [];

  for await (const nativePath of glob.scan({
    cwd: searchPath,
    onlyFiles: true,
    dot: args.hidden === true,
  })) {
    const relative = nativePath.split(sep).join("/");
    if (context.signal.aborted) {
      return { ok: false, output: "", error: "Glob aborted" };
    }
    if (ignored(relative) || (await matcher(prefix === "." ? relative : `${prefix}/${relative}`)))
      continue;
    if (!(await canReadSearchPath(context, join(searchPath, relative), "glob"))) continue;
    results.push(prefix === "." ? relative : `${prefix}/${relative}`);
  }

  return finish(args, results, limit, false);
}

export async function runGlob(args: GlobArgs, context: SearchContext): Promise<ToolResult> {
  const searchPath = resolveToolPath(context.cwd, args.path ?? ".");
  const problem = await validateDirectory(searchPath, args.path ?? ".");
  if (problem) return { ok: false, output: "", error: problem };

  const rg = Bun.which("rg");
  if (!rg || context.permissions || context.sandbox) return runGlobFallback(args, context);

  const limit = args.maxResults ?? 500;
  const prefix = displayPath(context.cwd, searchPath);
  const command = [
    rg,
    "--files",
    "--no-config",
    "--no-require-git",
    "--sort=path",
    "--path-separator=/",
  ];
  if (args.hidden) command.push("--hidden");
  for (const directory of IGNORED) command.push("--glob", `!**/${directory}/**`);
  command.push(".");
  const proc = Bun.spawn({
    cmd: command,
    cwd: searchPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  const abort = () => proc.kill("SIGKILL");
  if (context.signal.aborted) abort();
  else context.signal.addEventListener("abort", abort, { once: true });

  const [stdout, stderr, exitCode] = await Promise.all([
    collect(proc.stdout),
    collect(proc.stderr),
    proc.exited,
  ]);
  context.signal.removeEventListener("abort", abort);
  if (context.signal.aborted) return { ok: false, output: "", error: "Glob aborted" };
  if (exitCode !== 0 && exitCode !== 1) {
    return {
      ok: false,
      output: "",
      error: stderr.text.trim() || `ripgrep exited with code ${exitCode}`,
    };
  }

  const results: string[] = [];
  const filter = new Bun.Glob(scanPattern(args.pattern));
  for (const line of stdout.text.split("\n")) {
    if (!line) continue;
    const clean = withoutPrefix(line, "./");
    if (ignored(clean) || !filter.match(clean)) continue;
    results.push(prefix === "." ? clean : `${prefix}/${clean}`);
  }
  return finish(args, results, limit, stdout.capped);
}
