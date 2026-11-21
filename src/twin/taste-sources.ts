import type { Dirent } from "node:fs";
import { constants } from "node:fs";
import { type FileHandle, lstat, open, readdir } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { TwinSourceId } from "../../shared/twin";
import { memoryDigest, safeMemoryText } from "../core/memory/sources";
import type { SourceMessage } from "./sources";

const MAX_MEMORY_BYTES = 2 * 1024 * 1024;
const MAX_ITEM_CHARS = 16_000;

export async function readRegularText(
  path: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  signal.throwIfAborted();
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const meta = await handle.stat();
    if (!meta.isFile() || meta.size === 0 || meta.size > MAX_MEMORY_BYTES) return undefined;
    return await handle.readFile({ encoding: "utf8", signal });
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

export async function listMatchingFiles(
  root: string,
  signal: AbortSignal,
  predicate: (path: string) => boolean,
  maxDepth = 5,
): Promise<string[]> {
  const results: string[] = [];
  const visit = async (dir: string, depth: number): Promise<void> => {
    signal.throwIfAborted();
    if (depth > maxDepth) return;
    let entries: Dirent[];
    try {
      const meta = await lstat(dir);
      if (!meta.isDirectory() || meta.isSymbolicLink()) return;
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      signal.throwIfAborted();
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".git", "cache", "tmp", "checkpoints"].includes(entry.name)) continue;
        await visit(full, depth + 1);
      } else if (entry.isFile() && predicate(full)) {
        results.push(full);
      }
    }
  };
  await visit(root, 0);
  return results.sort();
}

export function makeMemoryMessage(
  sourceId: TwinSourceId,
  sessionKey: string,
  reference: string,
  text: string,
  secrets: readonly string[],
): SourceMessage | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_ITEM_CHARS || safeMemoryText(trimmed, secrets) !== trimmed) {
    return undefined;
  }
  const digest = memoryDigest(trimmed);
  return {
    id: `source-${sourceId}-${digest.slice(0, 24)}`,
    sourceId,
    sessionId: memoryDigest(sessionKey).slice(0, 32),
    reference,
    text: trimmed,
    digest,
  };
}

/**
 * Parse Command Code Taste markdown files (`taste.md` and `<category>/taste.md`).
 * Preserves category headers, section headings, and individual `- ...` learning entries.
 * Skips category redirect placeholders like `See [tooling/taste.md](tooling/taste.md)`.
 */
export function parseTasteMarkdown(
  content: string,
  filePath: string,
  scopeLabel: string,
  secrets: readonly string[],
): SourceMessage[] {
  const out: SourceMessage[] = [];
  let topCategory = "";
  let subSection = "";
  let lineNo = 0;

  const flushBullet = (bullet: string, startLine: number) => {
    const clean = bullet.trim();
    if (!clean) return;
    if (clean.startsWith("See [") && clean.includes("taste.md)")) return;
    const prefixParts = [scopeLabel, topCategory, subSection].filter(Boolean);
    const body = prefixParts.length > 0 ? `[Taste: ${prefixParts.join(" / ")}]\n${clean}` : clean;
    const item = makeMemoryMessage(
      "commandcode",
      `taste:${scopeLabel}:${topCategory || "root"}`,
      `${filePath}:${startLine}`,
      body,
      secrets,
    );
    if (item) out.push(item);
  };

  let pendingBullet = "";
  let pendingLine = 1;
  for (const rawLine of content.split("\n")) {
    lineNo += 1;
    const trimmed = rawLine.trimEnd().trim();
    if (trimmed.startsWith("# ")) {
      flushBullet(pendingBullet, pendingLine);
      pendingBullet = "";
      topCategory = trimmed.slice(2).trim();
      subSection = "";
      continue;
    }
    if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) {
      flushBullet(pendingBullet, pendingLine);
      pendingBullet = "";
      subSection = trimmed.slice(trimmed.indexOf(" ") + 1).trim();
      continue;
    }
    if (trimmed.startsWith("- ")) {
      flushBullet(pendingBullet, pendingLine);
      pendingBullet = trimmed.slice(2);
      pendingLine = lineNo;
      continue;
    }
    if (pendingBullet && trimmed) {
      pendingBullet += `\n${trimmed}`;
    } else if (!trimmed && pendingBullet) {
      flushBullet(pendingBullet, pendingLine);
      pendingBullet = "";
    }
  }
  flushBullet(pendingBullet, pendingLine);
  return out;
}

export async function commandCodeTasteDirs(
  cwd: string,
  home: string,
  signal: AbortSignal,
): Promise<{ dir: string; scope: string }[]> {
  const seen = new Set<string>();
  const dirs: { dir: string; scope: string }[] = [];
  const addIfDir = async (dir: string, scope: string) => {
    if (seen.has(dir)) return;
    try {
      const meta = await lstat(dir);
      if (meta.isDirectory() && !meta.isSymbolicLink()) {
        seen.add(dir);
        dirs.push({ dir, scope });
      }
    } catch {}
  };

  await addIfDir(join(home, ".commandcode/taste"), "global");
  await addIfDir(join(cwd, ".commandcode/taste"), `project:${basename(cwd)}`);

  try {
    const homeEntries = await readdir(home, { withFileTypes: true });
    for (const entry of homeEntries) {
      signal.throwIfAborted();
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
      await addIfDir(join(home, entry.name, ".commandcode/taste"), `project:${entry.name}`);
    }
  } catch {}

  return dirs;
}

export async function collectCommandCodeTaste(
  cwd: string,
  home: string,
  secrets: readonly string[],
  signal: AbortSignal,
): Promise<{ messages: SourceMessage[]; fileCount: number }> {
  const dirs = await commandCodeTasteDirs(cwd, home, signal);
  const messages: SourceMessage[] = [];
  let fileCount = 0;
  for (const { dir, scope } of dirs) {
    const files = await listMatchingFiles(dir, signal, (f) => basename(f) === "taste.md", 3);
    for (const file of files) {
      const text = await readRegularText(file, signal);
      if (!text?.trim()) continue;
      fileCount += 1;
      const rel = relative(dir, file);
      const category = rel === "taste.md" ? "" : dirname(rel);
      const scopeLabel = category ? `${scope}/${category}` : scope;
      messages.push(...parseTasteMarkdown(text, file, scopeLabel, secrets));
    }
  }
  return { messages, fileCount };
}

export function splitMarkdownMemory(
  content: string,
  sourceId: TwinSourceId,
  filePath: string,
  label: string,
  secrets: readonly string[],
): SourceMessage[] {
  const out: SourceMessage[] = [];
  let section = "";
  let buffer: string[] = [];
  let startLine = 1;
  let lineNo = 0;

  const flush = () => {
    const body = buffer.join("\n").trim();
    buffer = [];
    if (!body) return;
    const text = section
      ? `[Memory: ${label} / ${section}]\n${body}`
      : `[Memory: ${label}]\n${body}`;
    if (text.length <= MAX_ITEM_CHARS) {
      const item = makeMemoryMessage(
        sourceId,
        `memory:${filePath}`,
        `${filePath}:${startLine}`,
        text,
        secrets,
      );
      if (item) out.push(item);
      return;
    }
    for (const chunk of body.split("\n\n")) {
      const prefixed = section
        ? `[Memory: ${label} / ${section}]\n${chunk.trim()}`
        : `[Memory: ${label}]\n${chunk.trim()}`;
      const item = makeMemoryMessage(
        sourceId,
        `memory:${filePath}`,
        `${filePath}:${startLine}`,
        prefixed.slice(0, MAX_ITEM_CHARS),
        secrets,
      );
      if (item) out.push(item);
    }
  };

  for (const raw of content.split("\n")) {
    lineNo += 1;
    const trimmed = raw.trim();
    if (trimmed.startsWith("#")) {
      flush();
      const firstSpace = trimmed.indexOf(" ");
      section = firstSpace >= 0 ? trimmed.slice(firstSpace + 1).trim() : trimmed;
      startLine = lineNo;
    } else {
      if (buffer.length === 0) startLine = lineNo;
      buffer.push(raw);
    }
  }
  flush();
  return out;
}
