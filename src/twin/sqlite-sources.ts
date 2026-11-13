import { Database } from "bun:sqlite";
import { lstat } from "node:fs/promises";
import { z } from "zod";
import type { TwinSourceId } from "../../shared/twin";
import { memoryDigest, safeMemoryText } from "../core/memory/sources";
import { OpenCodePartSchema } from "./source-formats";
import type { SourceMessage } from "./sources";

const row = z.object({
  session: z.string(),
  reference: z.union([z.string(), z.number()]),
  data: z.string(),
});
const count = z.object({ count: z.number().int().min(0) });

async function database(path: string): Promise<Database | undefined> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 512 * 1024 * 1024)
      return undefined;
    return new Database(path, { readonly: true, strict: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function supported(db: Database, id: TwinSourceId): boolean {
  const columns = (sql: string) =>
    z
      .array(z.object({ name: z.string() }))
      .parse(db.query(sql).all())
      .map((item) => item.name);
  if (id === "opencode") {
    const messages = columns("PRAGMA table_info(message)");
    const parts = columns("PRAGMA table_info(part)");
    return (
      ["id", "session_id", "data"].every((name) => messages.includes(name)) &&
      ["id", "message_id", "data"].every((name) => parts.includes(name))
    );
  }
  if (id === "hermes")
    return ["id", "session_id", "role", "content"].every((name) =>
      columns("PRAGMA table_info(messages)").includes(name),
    );
  return false;
}

/** Fixed read-only queries cover published OpenCode and Hermes stores, never arbitrary SQL. */
export async function scanDatabase(id: TwinSourceId, path: string): Promise<number | undefined> {
  const db = await database(path);
  if (!db) return undefined;
  try {
    if (!supported(db, id)) return undefined;
    const sql =
      id === "opencode"
        ? "SELECT count(DISTINCT session_id) AS count FROM message WHERE json_extract(data, '$.role') = 'user'"
        : "SELECT count(DISTINCT session_id) AS count FROM messages WHERE role = 'user'";
    return count.parse(db.query(sql).get()).count;
  } finally {
    db.close();
  }
}

export async function readDatabase(
  id: TwinSourceId,
  path: string,
  secrets: readonly string[],
  signal: AbortSignal,
): Promise<SourceMessage[]> {
  signal.throwIfAborted();
  const db = await database(path);
  if (!db) return [];
  try {
    if (!supported(db, id)) throw new Error("Unsupported session database schema");
    const sql =
      id === "opencode"
        ? "SELECT message.session_id AS session, part.id AS reference, part.data AS data, message.data AS metadata FROM part JOIN message ON part.message_id = message.id WHERE json_extract(message.data, '$.role') IN ('user', 'assistant') ORDER BY part.rowid DESC LIMIT 1000"
        : "SELECT session_id AS session, id AS reference, json_object('role', role, 'content', content) AS data FROM messages WHERE role IN ('user', 'assistant') ORDER BY rowid DESC LIMIT 1000";
    const values = z
      .array(row.extend({ metadata: z.string().optional() }))
      .parse(db.query(sql).all());
    const result: SourceMessage[] = [];
    const sessions = new Set<string>();
    const preceding = new Map<string, string>();
    for (const value of values.reverse()) {
      signal.throwIfAborted();
      sessions.add(value.session);
      if (sessions.size > 100) break;
      let parsed: unknown;
      try {
        parsed = JSON.parse(value.data);
      } catch {
        continue;
      }
      let text: string;
      let role: "user" | "assistant";
      if (id === "opencode") {
        if (!value.metadata) continue;
        let metadata: unknown;
        try {
          metadata = JSON.parse(value.metadata);
        } catch {
          continue;
        }
        const message = z.object({ role: z.enum(["user", "assistant"]) }).safeParse(metadata);
        if (!message.success) continue;
        role = message.data.role;
        const part = OpenCodePartSchema.safeParse(parsed);
        if (!part.success || part.data.synthetic || part.data.ignored) continue;
        text = part.data.text;
      } else {
        const message = z
          .object({ role: z.enum(["user", "assistant"]), content: z.string() })
          .safeParse(parsed);
        if (!message.success) continue;
        text = message.data.content;
        role = message.data.role;
      }
      if (role === "assistant") {
        preceding.set(value.session, safeMemoryText(text.slice(-4000), secrets));
        continue;
      }
      if (!text.trim() || text.length > 16_000 || safeMemoryText(text, secrets) !== text) continue;
      const digest = memoryDigest(text);
      const precedingAssistant = preceding.get(value.session);
      result.push({
        id: `source-${id}-${digest.slice(0, 24)}`,
        sourceId: id,
        sessionId: memoryDigest(value.session).slice(0, 32),
        reference: `${path}#${value.reference}`,
        text,
        digest,
        ...(precedingAssistant === undefined ? {} : { precedingAssistant }),
      });
    }
    return result;
  } finally {
    db.close();
  }
}
