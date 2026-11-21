import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import type { TwinSourceId } from "../../shared/twin";
import { memoryDigest } from "../core/memory/sources";
import { isAuxiliarySessionRecord } from "./source-formats";
import type { SourceFile } from "./sources";

const FILE_LIMIT = 16 * 1024 * 1024;
const ENTRY_LIMIT = 20_000;

export function kiloCandidateRoots(home: string): string[] {
  return [
    join(home, ".local/share/kilo"),
    join(home, ".local/share/kilo-desktop-light/data/kilo"),
    join(home, ".kilocode/tasks"),
    join(home, ".config/Code/User/globalStorage/kilocode.kilo-code/tasks"),
    join(home, ".config/Cursor/User/globalStorage/kilocode.kilo-code/tasks"),
    join(home, ".config/Antigravity IDE/User/globalStorage/kilocode.kilo-code/tasks"),
  ];
}

function sessionFile(id: TwinSourceId, file: string, sourceRoot: string): boolean {
  const name = basename(file);
  const rel = relative(sourceRoot, file).split(sep).join("/");
  const segments = rel.split("/");
  if (
    segments.some((part) =>
      ["subagents", "subagent", "memory", "pages", "checkpoints", "tmp", "cache"].includes(part),
    )
  )
    return false;
  if (
    name.startsWith("subagent") ||
    name.startsWith("request_dump_") ||
    name.endsWith(".checkpoints.jsonl")
  )
    return false;
  if (id === "flecten") {
    const parent = basename(dirname(file));
    if (parent.endsWith("_worker") || parent.includes("_sub_") || parent.startsWith("sub_"))
      return false;
    return name === "events.jsonl";
  }
  if (id === "omp" || id === "commandcode") {
    if (segments.length > 2) return false;
    return extname(file) === ".jsonl";
  }
  if (id === "kilo") return name === "api_conversation_history.json";
  if (id === "opencode") return false;
  if (id === "cursor") return name === "messages.json" || name === "conversation.json";
  if (id === "hermes") return extname(file) === ".jsonl" || name === "messages.json";
  if (id === "deepseek")
    return (
      name.endsWith(".jsonl.zst") ||
      name.endsWith(".jsonl.zstd") ||
      [".jsonl", ".json"].includes(extname(file))
    );
  if (id === "codex") return name.endsWith(".jsonl.zst") || extname(file) === ".jsonl";
  return extname(file) === ".jsonl";
}

async function isAuxiliaryFileHeader(
  id: TwinSourceId,
  path: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (id !== "codex" && id !== "omp" && id !== "claude" && id !== "commandcode") return false;
  if (path.endsWith(".zst") || path.endsWith(".zstd")) return false;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(16_384);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead === 0) return false;
    for (const line of buffer.subarray(0, bytesRead).toString("utf8").split("\n").slice(0, 5)) {
      signal.throwIfAborted();
      if (!line.trim()) continue;
      try {
        if (isAuxiliarySessionRecord(id, JSON.parse(line))) return true;
      } catch {}
    }
    return false;
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

export async function visitSourceDirectory(
  sourceId: TwinSourceId,
  directory: string,
  rootDir: string,
  startEntries: number,
  signal: AbortSignal,
): Promise<{ files: SourceFile[]; warnings: string[]; entries: number; unknown: boolean }> {
  const files: SourceFile[] = [];
  const warnings: string[] = [];
  let entries = startEntries;
  let unknown = false;

  const walk = async (dir: string, depth: number): Promise<void> => {
    signal.throwIfAborted();
    if (depth > 7 || entries >= ENTRY_LIMIT) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      signal.throwIfAborted();
      entries += 1;
      if (entries > ENTRY_LIMIT) break;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (["subagents", "subagent", "memory", "pages"].includes(entry.name)) continue;
        if (
          sourceId === "flecten" &&
          (entry.name.endsWith("_worker") || entry.name.includes("_sub_"))
        )
          continue;
        if ((sourceId === "omp" || sourceId === "commandcode") && depth >= 1) continue;
        await walk(path, depth + 1);
      } else if (entry.isFile() && sessionFile(sourceId, path, rootDir)) {
        const metadata = await lstat(path);
        if (metadata.isFile() && metadata.size <= FILE_LIMIT) {
          if (await isAuxiliaryFileHeader(sourceId, path, signal)) continue;
          files.push({
            path,
            modified: metadata.mtimeMs,
            sessionId: memoryDigest(relative(rootDir, path)).slice(0, 32),
          });
        } else warnings.push(`Skipped oversized session: ${relative(rootDir, path)}`);
      } else if (entry.isFile() && [".db", ".sqlite"].includes(extname(path))) {
        if (sourceId === "kilo" && basename(path) === "kilo.db") continue;
        unknown = true;
      }
    }
  };

  await walk(directory, 0);
  return { files, warnings, entries, unknown };
}
