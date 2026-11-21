import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { zstdDecompress } from "node:zlib";
import type { TwinSource, TwinSourceId } from "../../shared/twin";

const decompressZstd = promisify(zstdDecompress);

import { memoryDigest, safeMemoryText } from "../core/memory/sources";
import { collectCommandCodeTaste, collectHarnessMemories } from "./memory-sources";
import { kiloCandidateRoots, visitSourceDirectory } from "./source-discovery";
import {
  assistantWords,
  isAuxiliarySessionRecord,
  jsonDocuments,
  userWords,
} from "./source-formats";
import { readDatabase, scanDatabase } from "./sqlite-sources";

export interface SourceFile {
  path: string;
  modified: number;
  sessionId: string;
}
export interface SourceMessage {
  id: string;
  sourceId: TwinSourceId;
  sessionId: string;
  reference: string;
  text: string;
  digest: string;
  precedingAssistant?: string;
}
export interface SourceDiscovery {
  source: TwinSource;
  files: SourceFile[];
  databases?: string[];
  cwd?: string;
  home?: string;
}
export const TWIN_LIMITS = {
  maxCandidates: 12,
  maxProfileEntries: 200,
};
export const FILE_LIMIT = 16 * 1024 * 1024;
export const ENTRY_LIMIT = 20_000;

export function sourceDefinitions(cwd: string, home = homedir()): TwinSource[] {
  const values: [TwinSourceId, string, string][] = [
    ["claude", "Claude Code", join(home, ".claude/projects")],
    ["codex", "Codex", join(home, ".codex/sessions")],
    ["cursor", "Cursor", join(home, ".cursor/chats")],
    ["omp", "Oh My Pi", join(home, ".omp/agent/sessions")],
    ["kilo", "Kilo Code", join(home, ".local/share/kilo")],
    ["deepseek", "DeepSeek Harness", join(home, ".dsh/sessions")],
    ["opencode", "OpenCode", join(home, ".local/share/opencode")],
    ["hermes", "Hermes Agent", join(home, ".hermes/sessions")],
    ["commandcode", "Command Code", join(home, ".commandcode/projects")],
    ["flecten", "Flecten", join(cwd, ".flecten/sessions")],
  ];
  return values.map(([id, name, path]) => ({
    id,
    name,
    path,
    available: false,
    sessions: 0,
    selected: false,
    status: "not-scanned",
    warnings: [],
  }));
}

function isZstdFile(path: string): boolean {
  return path.endsWith(".zst") || path.endsWith(".zstd");
}

function uniqueDatabases(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

async function existingDirectories(candidates: readonly string[]): Promise<string[]> {
  const dirs: string[] = [];
  for (const dir of candidates) {
    try {
      const metadata = await lstat(dir);
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) dirs.push(dir);
    } catch {}
  }
  return dirs;
}

/** Discovery visits metadata only. Bodies are opened only by an explicit training action. */
export async function discoverSource(
  source: TwinSource,
  signal: AbortSignal,
  context?: { cwd?: string; home?: string },
): Promise<SourceDiscovery> {
  const files: SourceFile[] = [];
  const warnings: string[] = [];
  const databases: string[] = [];
  let entries = 0;
  let unknown = false;
  const cwd = context?.cwd ?? process.cwd();
  const home = context?.home ?? homedir();

  try {
    if (source.id === "hermes") {
      const database = join(source.path, "..", "state.db");
      const count = await scanDatabase(source.id, database);
      if (count !== undefined)
        return {
          source: {
            ...source,
            path: database,
            available: true,
            sessions: count,
            status: "ready",
            warnings: [],
          },
          files,
          databases: [database],
          cwd,
          home,
        };
    }
    if (source.id === "kilo") {
      const roots = await existingDirectories(kiloCandidateRoots(home));
      if (roots.length === 0)
        return {
          source: { ...source, available: false, status: "missing", warnings: [] },
          files: [],
          cwd,
          home,
        };
      let dbSessions = 0;
      const seenInodes = new Set<string>();
      for (const root of roots) {
        const dbPath = join(root, "kilo.db");
        try {
          const st = await lstat(dbPath);
          const key = `${st.dev}:${st.ino}`;
          if (!seenInodes.has(key)) {
            seenInodes.add(key);
            const count = await scanDatabase("kilo", dbPath);
            if (count !== undefined) {
              databases.push(dbPath);
              dbSessions += count;
            }
          }
        } catch {}
        const visited = await visitSourceDirectory(source.id, root, root, entries, signal);
        entries = visited.entries;
        unknown ||= visited.unknown;
        files.push(...visited.files);
        warnings.push(...visited.warnings);
      }
      files.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
      const total = dbSessions + files.length;
      return {
        source: {
          ...source,
          path: databases[0] ?? roots[0] ?? source.path,
          available: true,
          sessions: total,
          status: total > 0 ? "ready" : "unsupported",
          warnings,
        },
        files,
        databases: uniqueDatabases(databases),
        cwd,
        home,
      };
    }
    const metadata = await lstat(source.path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      throw new Error("Source must be a regular directory, not a symbolic link");
    if (source.id === "opencode") {
      const database = join(source.path, "opencode.db");
      const count = await scanDatabase(source.id, database);
      return {
        source:
          count !== undefined
            ? { ...source, available: true, sessions: count, status: "ready", warnings: [] }
            : {
                ...source,
                available: true,
                status: "unsupported",
                warnings: ["This OpenCode store is not a supported message/part SQLite schema."],
              },
        files,
        ...(count !== undefined ? { databases: [database] } : {}),
        cwd,
        home,
      };
    }
    const visited = await visitSourceDirectory(
      source.id,
      source.path,
      source.path,
      entries,
      signal,
    );
    entries = visited.entries;
    unknown = visited.unknown;
    files.push(...visited.files);
    warnings.push(...visited.warnings);
    if (entries >= ENTRY_LIMIT) warnings.push("Discovery stopped at 20,000 filesystem entries.");
    if (unknown)
      warnings.push(
        "Native databases outside the documented adapter schema were not read. JSON exports can be imported where supported.",
      );
    if (source.id === "cursor")
      warnings.push(
        "Only messages.json and conversation.json exports with explicit user roles are supported. Cursor native blob databases are not decoded.",
      );
    if (source.id === "commandcode") {
      const taste = await collectCommandCodeTaste(cwd, home, [], signal).catch(() => ({
        messages: [],
        fileCount: 0,
      }));
      if (taste.fileCount > 0) {
        warnings.push(
          `Found ${taste.fileCount} Taste file(s) with ${taste.messages.length} entries across global and project categories.`,
        );
      }
    }
    files.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
    return {
      source: {
        ...source,
        available: true,
        sessions: files.length,
        status: entries >= ENTRY_LIMIT ? "limited" : files.length ? "ready" : "unsupported",
        warnings,
      },
      files,
      cwd,
      home,
    };
  } catch (error) {
    if (source.id === "commandcode") {
      const taste = await collectCommandCodeTaste(cwd, home, [], signal).catch(() => ({
        messages: [],
        fileCount: 0,
      }));
      if (taste.fileCount > 0) {
        return {
          source: {
            ...source,
            available: true,
            sessions: taste.fileCount,
            status: "ready",
            warnings: [
              `Found ${taste.fileCount} Taste file(s) with ${taste.messages.length} entries.`,
            ],
          },
          files: [],
          cwd,
          home,
        };
      }
    }
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      source: {
        ...source,
        available: !missing,
        status: missing ? "missing" : "error",
        warnings: missing ? [] : [error instanceof Error ? error.message : String(error)],
      },
      files: [],
      cwd,
      home,
    };
  }
}

export async function readSession(
  source: SourceDiscovery,
  file: SourceFile,
  secrets: readonly string[],
  signal: AbortSignal,
): Promise<SourceMessage[]> {
  signal.throwIfAborted();
  const handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let raw: string;
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > FILE_LIMIT)
      throw new Error("Source file is oversized or not regular");
    if (isZstdFile(file.path)) {
      const bytes = await handle.readFile({ signal });
      raw = Buffer.from(await decompressZstd(bytes)).toString("utf8");
    } else {
      raw = await handle.readFile({ encoding: "utf8", signal });
    }
  } finally {
    await handle.close();
  }
  const result: SourceMessage[] = [];
  const documents =
    extname(file.path) === ".jsonl" || file.path.includes(".jsonl.") ? raw.split("\n") : [raw];
  let line = 0;
  let precedingAssistant = "";
  for (const document of documents) {
    signal.throwIfAborted();
    line += 1;
    if (!document.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(document);
    } catch {
      continue;
    }
    for (const record of jsonDocuments(value)) {
      if (isAuxiliarySessionRecord(source.source.id, record)) return [];
      const assistant = assistantWords(source.source.id, record).join("\n");
      if (assistant) precedingAssistant = safeMemoryText(assistant.slice(-4000), secrets);
      for (const text of userWords(source.source.id, record)) {
        if (!text.trim() || text.length > 16_000 || safeMemoryText(text, secrets) !== text)
          continue;
        const digest = memoryDigest(text);
        result.push({
          id: `source-${source.source.id}-${digest.slice(0, 24)}`,
          sourceId: source.source.id,
          sessionId: file.sessionId,
          reference: `${file.path}:${line}`,
          text,
          digest,
          ...(precedingAssistant ? { precedingAssistant } : {}),
        });
      }
    }
  }
  return result;
}

export async function sourceMessages(
  source: SourceDiscovery,
  secrets: readonly string[],
  signal: AbortSignal,
): Promise<SourceMessage[]> {
  const out: SourceMessage[] = [];
  for (const dbPath of source.databases ?? []) {
    out.push(...(await readDatabase(source.source.id, dbPath, secrets, signal)));
  }
  return out;
}

export async function collectTrainingMessages(
  selected: readonly SourceDiscovery[],
  processed: readonly string[],
  secrets: readonly string[],
  signal: AbortSignal,
  onProgress?: (progress: {
    sessions: number;
    messages: number;
    samples: Array<{ sourceId: TwinSourceId; sessionId: string; quote: string }>;
    sourceName: string;
  }) => void,
): Promise<{ messages: SourceMessage[]; sessions: Set<string> }> {
  const messages: SourceMessage[] = [];
  const seen = new Set(processed);
  const sessions = new Set<string>();
  const samples: Array<{ sourceId: TwinSourceId; sessionId: string; quote: string }> = [];
  let lastReport = 0;
  const report = (sourceName: string, force = false) => {
    const now = performance.now();
    if (!force && now - lastReport < 250) return;
    lastReport = now;
    onProgress?.({
      sessions: sessions.size,
      messages: messages.length,
      samples: [...samples],
      sourceName,
    });
  };
  const add = (items: SourceMessage[]) => {
    for (const message of items) {
      if (seen.has(message.digest)) continue;
      const sessionKey = `${message.sourceId}:${message.sessionId}`;
      messages.push(message);
      seen.add(message.digest);
      sessions.add(sessionKey);
      if (samples.length < 16) {
        samples.push({
          sourceId: message.sourceId,
          sessionId: message.sessionId,
          quote: safeMemoryText(message.text, secrets).slice(0, 4000),
        });
      }
    }
  };
  for (const source of selected) {
    signal.throwIfAborted();
    const cwd = source.cwd ?? process.cwd();
    const home = source.home ?? homedir();
    try {
      add(await collectHarnessMemories(source.source.id, cwd, home, secrets, signal));
      report(source.source.name, true);
    } catch (error) {
      signal.throwIfAborted();
      const warning = safeMemoryText(
        `Memory store could not be read: ${error instanceof Error ? error.message : String(error)}`,
        secrets,
      ).slice(0, 1000);
      if (!source.source.warnings.includes(warning)) source.source.warnings.push(warning);
    }
    if (source.databases?.length) {
      add(await sourceMessages(source, secrets, signal));
      report(source.source.name, true);
    }
    const CONCURRENCY = 8;
    for (let index = 0; index < source.files.length; index += CONCURRENCY) {
      signal.throwIfAborted();
      const chunk = source.files.slice(index, index + CONCURRENCY);
      const batch = await Promise.all(
        chunk.map(async (file) => {
          try {
            return await readSession(source, file, secrets, signal);
          } catch (error) {
            signal.throwIfAborted();
            const warning = safeMemoryText(
              `Session could not be read: ${error instanceof Error ? error.message : String(error)}`,
              secrets,
            ).slice(0, 1000);
            if (!source.source.warnings.includes(warning)) source.source.warnings.push(warning);
            return [];
          }
        }),
      );
      for (const items of batch) add(items);
      report(source.source.name);
    }
  }
  return { messages, sessions };
}
