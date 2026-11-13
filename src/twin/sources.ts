import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, relative } from "node:path";
import type { TwinSource, TwinSourceId } from "../../shared/twin";
import { memoryDigest, safeMemoryText } from "../core/memory/sources";
import { assistantWords, jsonDocuments, userWords } from "./source-formats";
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
  database?: string;
}
export const TWIN_LIMITS = {
  maxSessions: 100,
  maxMessages: 160,
  maxInputCharacters: 64_000,
  maxCandidates: 12,
  maxProfileEntries: 64,
};
const FILE_LIMIT = 4 * 1024 * 1024;
const ENTRY_LIMIT = 20_000;

export function sourceDefinitions(cwd: string, home = homedir()): TwinSource[] {
  const values: [TwinSourceId, string, string][] = [
    ["claude", "Claude Code", join(home, ".claude/projects")],
    ["codex", "Codex", join(home, ".codex/sessions")],
    ["cursor", "Cursor", join(home, ".cursor/chats")],
    ["omp", "Oh My Pi", join(home, ".omp/agent/sessions")],
    ["kilo", "Kilo Code", join(home, ".kilocode/tasks")],
    ["deepseek", "DeepSeek Harness", join(home, ".dsh/sessions")],
    ["opencode", "OpenCode", join(home, ".local/share/opencode")],
    ["hermes", "Hermes Agent", join(home, ".hermes/sessions")],
    ["liquid", "Liquid Harness", join(cwd, ".liquid/sessions")],
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

function sessionFile(id: TwinSourceId, file: string): boolean {
  const name = basename(file);
  if (id === "liquid") return name === "events.jsonl";
  if (id === "kilo") return name === "api_conversation_history.json";
  if (id === "opencode") return false;
  if (id === "cursor") return name === "messages.json" || name === "conversation.json";
  if (id === "hermes") return extname(file) === ".jsonl" || name === "messages.json";
  if (id === "deepseek") return [".jsonl", ".json"].includes(extname(file));
  return extname(file) === ".jsonl";
}

/** Discovery visits metadata only. Bodies are opened only by an explicit training action. */
export async function discoverSource(
  source: TwinSource,
  signal: AbortSignal,
): Promise<SourceDiscovery> {
  const files: SourceFile[] = [];
  const warnings: string[] = [];
  let entries = 0;
  let unknown = false;
  const visit = async (directory: string, depth: number): Promise<void> => {
    signal.throwIfAborted();
    if (depth > 7 || entries >= ENTRY_LIMIT) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      signal.throwIfAborted();
      entries += 1;
      if (entries > ENTRY_LIMIT) break;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (source.id === "claude" && entry.name === "subagents") continue;
        await visit(path, depth + 1);
      } else if (entry.isFile() && sessionFile(source.id, path)) {
        const metadata = await lstat(path);
        if (metadata.isFile() && metadata.size <= FILE_LIMIT)
          files.push({
            path,
            modified: metadata.mtimeMs,
            sessionId: memoryDigest(relative(source.path, path)).slice(0, 32),
          });
        else warnings.push(`Skipped oversized session: ${relative(source.path, path)}`);
      } else if (entry.isFile() && [".db", ".sqlite"].includes(extname(path))) unknown = true;
    }
  };
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
          database,
        };
    }
    const metadata = await lstat(source.path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      throw new Error("Source must be a regular directory, not a symbolic link");
    if (source.id === "opencode") {
      const database = join(source.path, "opencode.db");
      const count = await scanDatabase(source.id, database);
      if (count !== undefined)
        return {
          source: { ...source, available: true, sessions: count, status: "ready", warnings: [] },
          files,
          database,
        };
      return {
        source: {
          ...source,
          available: true,
          status: "unsupported",
          warnings: ["This OpenCode store is not a supported message/part SQLite schema."],
        },
        files,
      };
    }
    await visit(source.path, 0);
    if (entries >= ENTRY_LIMIT) warnings.push("Discovery stopped at 20,000 filesystem entries.");
    if (unknown)
      warnings.push(
        "Native databases outside the documented adapter schema were not read. JSON exports can be imported where supported.",
      );
    if (source.id === "cursor")
      warnings.push(
        "Only messages.json and conversation.json exports with explicit user roles are supported. Cursor native blob databases are not decoded.",
      );
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
    };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      source: {
        ...source,
        available: !missing,
        status: missing ? "missing" : "error",
        warnings: missing ? [] : [error instanceof Error ? error.message : String(error)],
      },
      files: [],
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
    raw = await handle.readFile({ encoding: "utf8", signal });
  } finally {
    await handle.close();
  }
  const result: SourceMessage[] = [];
  const documents = extname(file.path) === ".jsonl" ? raw.split("\n") : [raw];
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
  return source.database ? readDatabase(source.source.id, source.database, secrets, signal) : [];
}
