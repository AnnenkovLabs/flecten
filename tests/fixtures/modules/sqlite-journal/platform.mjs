import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { cp, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

/** A complete journal adapter, independent of the default JSONL backend. */
export default async ({ workspace, services, contracts, effect, z }) => {
  await mkdir(join(workspace, ".liquid"), { recursive: true });
  const db = new Database(join(workspace, ".liquid", "module-journal.sqlite"));
  await effect(() => () => db.close());
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, title TEXT, archived INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS events (session TEXT, seq INTEGER, ts TEXT, payload TEXT, PRIMARY KEY(session, seq));`);
  const rowSchema = z.object({ seq: z.number().int(), ts: z.string(), payload: z.string() });
  const metaSchema = z.object({ id: z.string(), title: z.string().nullable() });
  function read(id) {
    return z.array(rowSchema).parse(db.query("SELECT seq, ts, payload FROM events WHERE session = ? ORDER BY seq").all(id)).map((row) => ({
      seq: row.seq, ts: row.ts, schemaVersion: 1, sessionId: id, event: JSON.parse(row.payload),
    }));
  }
  const append = db.transaction((event) => {
    const id = event.sessionId ?? "system";
    db.query("INSERT OR IGNORE INTO sessions (id) VALUES (?)").run(id);
    db.query("INSERT INTO events VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE session = ?), ?, ?)").run(id, id, new Date().toISOString(), JSON.stringify(event));
  });
  function summary(meta) {
    const events = read(meta.id);
    const first = events.find((e) => e.event.type === "session.started");
    if (!first) return undefined;
    const starts = events.filter((e) => e.event.type === "session.started" && !e.event.internal);
    const boundary = events.findLast((e) => ["session.started", "session.finished", "run.interrupted"].includes(e.event.type));
    const finished = events.filter((e) => e.event.type === "session.finished");
    return {
      id: meta.id, title: meta.title ?? (first.event.prompt.split("\n")[0].trim().slice(0, 72) || meta.id),
      project: basename(workspace), createdAt: first.ts, updatedAt: events.at(-1).ts,
      lastPrompt: starts.at(-1)?.event.prompt ?? first.event.prompt,
      messageCount: events.filter((e) => e.event.type === "message.finished").length,
      tokens: finished.reduce((sum, e) => sum + e.event.result.usage.input + e.event.result.usage.output, 0),
      running: boundary?.event.type === "session.started",
      interrupted: boundary?.event.type === "run.interrupted",
      ...(boundary?.event.type === "session.finished" ? { stopReason: boundary.event.result.stopReason } : {}),
    };
  }
  // ponytail: scan journals for summaries; maintain an SQL summary table for large archives.
  function list(options = {}) {
    const items = z.array(metaSchema).parse(db.query("SELECT id, title FROM sessions WHERE archived = 0").all()).map(summary).filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    const query = options.query?.trim().toLocaleLowerCase() ?? "";
    const matched = query ? items.filter((s) => [s.id, s.title, s.lastPrompt, s.project].some((v) => v.toLocaleLowerCase().includes(query))) : items;
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));
    return matched.slice(offset, options.limit === undefined ? undefined : offset + Math.max(0, Math.trunc(options.limit)));
  }
  services.replace(contracts.storage, async (request) => {
    switch (request.operation) {
      case "append": append(request.event); return null;
      case "read": return read(request.sessionId);
      case "list": return list(request.options);
      case "rename": {
        const title = z.string().trim().min(1).max(72).parse(request.title);
        if (!list().some((s) => s.id === request.sessionId)) throw new Error("Unknown session");
        db.query("UPDATE sessions SET title = ? WHERE id = ?").run(title, request.sessionId);
        return list().find((s) => s.id === request.sessionId);
      }
      case "delete": {
        if (!list().some((s) => s.id === request.sessionId)) throw new Error("Unknown session");
        db.query("UPDATE sessions SET archived = 1 WHERE id = ?").run(request.sessionId);
        return { id: request.sessionId, trash: `module-journal.sqlite#${request.sessionId}` };
      }
      case "fork": {
        const source = list().find((s) => s.id === request.sessionId);
        if (!source) throw new Error("Unknown session");
        let rows = read(request.sessionId);
        if (request.options.turn !== undefined) {
          const turn = rows.findLast((e) => e.event.type === "turn.finished" && e.event.turn === request.options.turn);
          if (!turn) throw new Error("Turn not found");
          rows = rows.filter((e) => e.seq <= turn.seq);
        }
        if (request.options.sequence !== undefined) rows = rows.filter((e) => e.seq <= request.options.sequence);
        const kept = rows.filter((e) => e.event.type !== "session.finished");
        if (!kept.some((e) => e.event.type === "session.started")) throw new Error("Nothing to fork");
        const id = `s_fork_${randomUUID()}`;
        for (const { event } of kept) append({ ...event, sessionId: id });
        append({ type: "session.finished", sessionId: id, result: { sessionId: id, pass: false, stopReason: "end", summary: `Forked from ${request.sessionId}.`, turns: 0, usage: { input: 0, output: 0, cached: 0 } } });
        db.query("UPDATE sessions SET title = ? WHERE id = ?").run(request.options.title ?? `${source.title} (fork)`, id);
        for (const folder of ["attachments", "logs"]) {
          await cp(join(workspace, ".liquid/sessions", request.sessionId, folder), join(workspace, ".liquid/sessions", id, folder), { recursive: true }).catch((error) => { if (error.code !== "ENOENT") throw error; });
        }
        return list().find((s) => s.id === id);
      }
      default: throw new Error("Unknown journal operation");
    }
  });
};
