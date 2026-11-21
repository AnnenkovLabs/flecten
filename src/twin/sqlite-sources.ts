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

type OpenCodeSchemaKind = "v1" | "v2";

async function database(path: string): Promise<Database | undefined> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 8 * 1024 * 1024 * 1024)
      return undefined;
    return new Database(path, { readonly: true, strict: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function tableColumns(db: Database, table: string): string[] {
  return z
    .array(z.object({ name: z.string() }))
    .parse(db.query(`PRAGMA table_info(${table})`).all())
    .map((item) => item.name);
}

function openCodeSchema(db: Database): OpenCodeSchemaKind | undefined {
  const messages = tableColumns(db, "message");
  const parts = tableColumns(db, "part");
  if (
    ["id", "session_id", "data"].every((name) => messages.includes(name)) &&
    ["id", "message_id", "data"].every((name) => parts.includes(name))
  ) {
    return "v1";
  }
  const v2 = tableColumns(db, "session_message");
  if (["id", "session_id", "type", "data"].every((name) => v2.includes(name))) {
    return "v2";
  }
  return undefined;
}

function supported(db: Database, id: TwinSourceId): boolean {
  if (id === "opencode" || id === "kilo") return openCodeSchema(db) !== undefined;
  if (id === "hermes")
    return ["id", "session_id", "role", "content"].every((name) =>
      tableColumns(db, "messages").includes(name),
    );
  return false;
}

function openCodeSubagentPredicate(db: Database, alias: string): string {
  const sessionCols = tableColumns(db, "session");
  if (sessionCols.includes("id") && sessionCols.includes("parent_id")) {
    return sessionCols.includes("data")
      ? `NOT EXISTS (SELECT 1 FROM session s WHERE s.id = ${alias}.session_id AND (s.parent_id IS NOT NULL OR json_extract(s.data, '$.parentID') IS NOT NULL))`
      : `NOT EXISTS (SELECT 1 FROM session s WHERE s.id = ${alias}.session_id AND s.parent_id IS NOT NULL)`;
  }
  const v2Cols = tableColumns(db, "session_v2");
  if (v2Cols.includes("id") && v2Cols.includes("parent_id")) {
    return `NOT EXISTS (SELECT 1 FROM session_v2 s WHERE s.id = ${alias}.session_id AND s.parent_id IS NOT NULL)`;
  }
  return "1 = 1";
}

function hermesSubagentPredicate(db: Database, alias: string): string {
  const sessionCols = tableColumns(db, "sessions");
  const messageCols = tableColumns(db, "messages");
  const checks: string[] = [];
  if (messageCols.includes("display_kind")) {
    checks.push(`${alias}.display_kind IS NULL`);
  }
  if (sessionCols.includes("id")) {
    const subChecks: string[] = [];
    if (sessionCols.includes("parent_session_id"))
      subChecks.push("s.parent_session_id IS NOT NULL");
    if (sessionCols.includes("source"))
      subChecks.push("s.source IN ('subagent', 'internal', 'service', 'cron')");
    if (sessionCols.includes("created_source"))
      subChecks.push("s.created_source IN ('subagent', 'internal', 'service', 'cron')");
    if (subChecks.length > 0) {
      checks.push(
        `NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = ${alias}.session_id AND (${subChecks.join(" OR ")}))`,
      );
    }
  }
  return checks.length > 0 ? checks.join(" AND ") : "1 = 1";
}

/** Fixed read-only queries cover published OpenCode, Kilo, and Hermes stores, never arbitrary SQL. */
export async function scanDatabase(id: TwinSourceId, path: string): Promise<number | undefined> {
  const db = await database(path);
  if (!db) return undefined;
  try {
    if (!supported(db, id)) return undefined;
    if (id === "opencode" || id === "kilo") {
      const kind = openCodeSchema(db);
      const filter = openCodeSubagentPredicate(db, "m");
      const sql =
        kind === "v2"
          ? `SELECT count(DISTINCT m.session_id) AS count FROM session_message m WHERE m.type = 'user' AND ${filter}`
          : `SELECT count(DISTINCT m.session_id) AS count FROM message m WHERE json_extract(m.data, '$.role') = 'user' AND ${filter}`;
      return count.parse(db.query(sql).get()).count;
    }
    const filter = hermesSubagentPredicate(db, "m");
    const sql = `SELECT count(DISTINCT m.session_id) AS count FROM messages m WHERE m.role = 'user' AND ${filter}`;
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
    let sql: string;
    const ocKind = id === "opencode" || id === "kilo" ? openCodeSchema(db) : undefined;
    if (id === "opencode" || id === "kilo") {
      const filter = openCodeSubagentPredicate(db, "message");
      sql =
        ocKind === "v2"
          ? `SELECT message.session_id AS session, message.id AS reference, message.data AS data, message.type AS metadata FROM session_message AS message WHERE message.type IN ('user', 'assistant') AND ${filter} ORDER BY message.rowid ASC`
          : `SELECT message.session_id AS session, part.id AS reference, part.data AS data, message.data AS metadata FROM part JOIN message ON part.message_id = message.id WHERE json_extract(message.data, '$.role') IN ('user', 'assistant') AND json_extract(part.data, '$.type') = 'text' AND ${filter} ORDER BY part.rowid ASC`;
    } else {
      const filter = hermesSubagentPredicate(db, "m");
      sql = `SELECT m.session_id AS session, m.id AS reference, json_object('role', m.role, 'content', m.content) AS data FROM messages AS m WHERE m.role IN ('user', 'assistant') AND ${filter} ORDER BY m.rowid ASC`;
    }
    const values = z
      .array(row.extend({ metadata: z.string().optional() }))
      .parse(db.query(sql).all());
    const result: SourceMessage[] = [];
    const preceding = new Map<string, string>();
    for (const value of values) {
      signal.throwIfAborted();
      let parsed: unknown;
      try {
        parsed = JSON.parse(value.data);
      } catch {
        continue;
      }
      let text: string;
      let role: "user" | "assistant";
      if ((id === "opencode" || id === "kilo") && ocKind === "v2") {
        if (value.metadata !== "user" && value.metadata !== "assistant") continue;
        role = value.metadata;
        if (role === "user") {
          const msg = z
            .object({
              text: z.string(),
              synthetic: z.boolean().optional(),
              ignored: z.boolean().optional(),
            })
            .safeParse(parsed);
          if (!msg.success || msg.data.synthetic || msg.data.ignored) continue;
          text = msg.data.text;
        } else {
          const msg = z
            .object({
              content: z.array(
                z.object({ type: z.string(), text: z.string().optional() }).passthrough(),
              ),
            })
            .safeParse(parsed);
          if (!msg.success) continue;
          text = msg.data.content
            .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
            .join("\n");
        }
      } else if (id === "opencode" || id === "kilo") {
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
