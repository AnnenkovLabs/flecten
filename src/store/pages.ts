import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { type PageArchive, PageReadSchema, PageSearchSchema } from "../core/pages/archive";
import type { PageSink } from "../core/pages/writer";
import type { ToolResult } from "../core/types";
import { atomicWrite } from "../util/atomic";
import { markdownValue } from "../util/markdown";
import { redactKnown } from "../util/redact";
import type { SessionPaths } from "./paths";

const MAX_OUTPUT = 32_000;

function pageNumber(name: string): number {
  if (!name.endsWith(".md")) return 0;
  const value = Number(name.slice(0, -3));
  return Number.isSafeInteger(value) && value > 0 && name === `${value}.md` ? value : 0;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function directory(paths: SessionPaths): Promise<string> {
  const root = await realpath(paths.root);
  const actual = await realpath(paths.pages);
  if (actual !== resolve(root, relative(paths.root, paths.pages)))
    throw new Error("Page archive must remain inside its original session directory");
  return actual;
}

async function archiveFile(paths: SessionPaths, page: number, kind: string): Promise<string> {
  const root = await directory(paths);
  const path = join(root, kind === "summary" ? `${page}.md` : `${page}.transcript.md`);
  const info = await lstat(path);
  if (!info.isFile()) throw new Error("Page archive entries must be regular files");
  return path;
}

async function pageNumbers(paths: SessionPaths): Promise<number[]> {
  try {
    const names = await readdir(await directory(paths), { withFileTypes: true });
    return names
      .filter((entry) => entry.isFile())
      .map((entry) => pageNumber(entry.name))
      .filter((page) => page > 0)
      .sort((left, right) => left - right);
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
}

async function* fileLines(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    for await (const line of lines) yield line;
  } finally {
    lines.close();
    stream.destroy();
  }
}

function failure(error: unknown): ToolResult {
  return { ok: false, output: "", error: error instanceof Error ? error.message : String(error) };
}

function pageArchive(paths: SessionPaths): PageArchive {
  return {
    async list(access) {
      try {
        const pages = await pageNumbers(paths);
        const entries = await Promise.all(
          pages.map(async (page) => {
            const summary = await archiveFile(paths, page, "summary");
            if (access && !(await access(summary))) return undefined;
            const transcript = await archiveFile(paths, page, "transcript")
              .then(async (path) => !access || (await access(path)))
              .catch((error: unknown) => {
                if (missing(error)) return false;
                throw error;
              });
            return `- Page ${page}: summary${transcript ? " and transcript" : " (legacy summary only)"}`;
          }),
        );
        return {
          ok: true,
          output: entries.filter(Boolean).join("\n") || "No readable archived pages yet.",
          data: { kind: "context_pages", pages: pages.filter((_, index) => entries[index]) },
        };
      } catch (error) {
        return failure(error);
      }
    },
    async read(input, access) {
      try {
        const args = PageReadSchema.parse(input);
        const kind = args.kind ?? "summary";
        const path = await archiveFile(paths, args.page, kind);
        if (access && !(await access(path))) throw new Error("Page archive read denied");
        const offset = args.offset ?? 1;
        const limit = args.limit ?? 200;
        const output: string[] = [];
        let total = 0;
        let size = 0;
        for await (const line of fileLines(path)) {
          total += 1;
          if (total < offset || output.length >= limit || size >= MAX_OUTPUT) continue;
          const text = line.slice(0, Math.max(0, MAX_OUTPUT - size));
          const row = `${total}: ${text}${text.length < line.length ? " [line clipped; use search]" : ""}`;
          output.push(row);
          size += row.length + 1;
        }
        if (total > 0 && offset > total) throw new Error(`Offset exceeds ${total} archive lines`);
        const end = offset + output.length - 1;
        if (end < total)
          output.push(
            `[Showing lines ${offset}-${end} of ${total}; use offset=${end + 1} to continue.]`,
          );
        return {
          ok: true,
          output: output.join("\n") || "(empty archive)",
          provenance: { source: "file", ref: path },
          data: { kind: "context_page", page: args.page, document: kind, totalLines: total },
        };
      } catch (error) {
        return failure(error);
      }
    },
    async search(input, access) {
      try {
        const args = PageSearchSchema.parse(input);
        const pages = args.page === undefined ? await pageNumbers(paths) : [args.page];
        const limit = args.limit ?? 50;
        const output: string[] = [];
        let size = 0;
        let truncated = false;
        for (const page of pages) {
          for (const kind of ["summary", "transcript"]) {
            let path: string;
            try {
              path = await archiveFile(paths, page, kind);
              if (access && !(await access(path))) continue;
            } catch (error) {
              if (kind === "transcript" && missing(error)) continue;
              throw error;
            }
            let number = 0;
            for await (const line of fileLines(path)) {
              number += 1;
              const index = line.indexOf(args.query);
              if (index < 0) continue;
              if (output.length >= limit || size >= MAX_OUTPUT) {
                truncated = true;
                break;
              }
              const start = Math.max(0, index - 80);
              const excerpt = line.slice(start, start + 600);
              const row = `Page ${page} ${kind}:${number}: ${start ? "..." : ""}${excerpt}`;
              output.push(row);
              size += row.length + 1;
            }
            if (truncated) break;
          }
          if (truncated) break;
        }
        const count = output.length;
        if (truncated) output.push("[More matches available; narrow query or select a page.]");
        return {
          ok: true,
          output: output.join("\n") || `No archived matches for ${markdownValue(args.query)}.`,
          provenance: { source: "file", ref: paths.pages },
          data: { kind: "context_search", count, truncated },
        };
      } catch (error) {
        return failure(error);
      }
    },
  };
}

/** A summary commits an archive page; an interrupted transcript write never creates one. */
export function pageSink(
  paths: SessionPaths,
  secrets: () => readonly string[] = () => [],
): PageSink {
  return {
    logsDir: paths.logs,
    archive: pageArchive(paths),
    async write(page, markdown, transcript, signal) {
      if (!Number.isSafeInteger(page) || page < 1) throw new Error("Invalid page number");
      signal?.throwIfAborted();
      await mkdir(paths.pages, { recursive: true });
      const root = await directory(paths);
      const file = join(root, `${page}.md`);
      if (transcript !== undefined)
        await atomicWrite(
          join(root, `${page}.transcript.md`),
          redactKnown(transcript, secrets()),
          0o600,
          signal,
        );
      await atomicWrite(file, redactKnown(markdown, secrets()), 0o600, signal);
      return file;
    },
    async count() {
      return (await pageNumbers(paths)).at(-1) ?? 0;
    },
  };
}

/** A fork carries only pages committed before its selected event boundary. */
export async function copyPageArchive(
  source: SessionPaths,
  target: SessionPaths,
  lastPage: number,
): Promise<void> {
  const pages = (await pageNumbers(source)).filter((page) => page <= lastPage);
  if (pages.length === 0) return;
  await mkdir(target.pages, { recursive: true });
  const root = await directory(target);
  for (const page of pages) {
    for (const kind of ["transcript", "summary"]) {
      try {
        const path = await archiveFile(source, page, kind);
        await atomicWrite(join(root, basename(path)), await Bun.file(path).text(), 0o600);
      } catch (error) {
        if (kind === "transcript" && missing(error)) continue;
        throw error;
      }
    }
  }
}
