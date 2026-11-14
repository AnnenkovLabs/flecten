import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, stat, utimes, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import type { Event } from "../../core/types";
import { newId } from "../../util/ids";
import { redact } from "../../util/redact";
import { copyPageArchive } from "../pages";
import { sessionPaths } from "../paths";
import { readTolerant } from "./envelope";
import { assertForkOptions, type ForkSessionOptions, forkCutoff, forkLines } from "./fork";

export type { ForkSessionOptions } from "./fork";

export const SESSION_INDEX_VERSION = 2;

export type { SessionListOptions, SessionSummary } from "../../core/services/storage";

import type { SessionListOptions, SessionSummary } from "../../core/services/storage";

interface SessionIndexFile {
  version: number;
  sessions: SessionSummary[];
}

export const summarySchema = z.object({
  id: z.string(),
  title: z.string(),
  project: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  stopReason: z.enum(["done", "end", "stopped", "error", "max_turns", "budget"]).optional(),
  running: z.boolean().optional(),
  interrupted: z.boolean().optional(),
  messageCount: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative().optional(),
  lastPrompt: z.string(),
});

const indexSchema = z.object({
  version: z.literal(SESSION_INDEX_VERSION),
  sessions: z.array(summarySchema),
});

const locks = new Map<string, Promise<unknown>>();

function serialized<T>(cwd: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(cwd) ?? Promise.resolve();
  const next = previous.then(task, task);
  locks.set(
    cwd,
    next.catch(() => undefined),
  );
  return next;
}

function errorOf(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function isValidSessionId(id: string): boolean {
  return /^[\w-]+$/.test(id);
}

export function assertSessionId(id: string): void {
  if (!isValidSessionId(id)) throw new Error("invalid session id");
}

export function sessionIndexPath(cwd: string): string {
  return join(cwd, ".liquid", "sessions", "index.json");
}

function sessionsRoot(cwd: string): string {
  return join(cwd, ".liquid", "sessions");
}

async function readIndexFile(cwd: string): Promise<SessionSummary[] | undefined> {
  try {
    const text = await readFile(sessionIndexPath(cwd), "utf8");
    return indexSchema.parse(JSON.parse(text) as SessionIndexFile).sessions;
  } catch {
    return undefined;
  }
}

async function writeIndexFile(cwd: string, sessions: SessionSummary[]): Promise<void> {
  const path = sessionIndexPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const body: SessionIndexFile = {
    version: SESSION_INDEX_VERSION,
    sessions: sortSessions(sessions).map((session) => ({
      ...session,
      title: redact(session.title),
      lastPrompt: redact(session.lastPrompt),
    })),
  };
  await writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}

function sortSessions(sessions: readonly SessionSummary[]): SessionSummary[] {
  return [...sessions].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
  );
}

function titleFromPrompt(prompt: string, id: string): string {
  const first = redact(prompt).split("\n")[0]?.trim() ?? "";
  return first.slice(0, 72) || id;
}

function applyLifecycle(
  summary: Pick<SessionSummary, "running" | "interrupted" | "stopReason">,
  event: Event,
): void {
  switch (event.type) {
    case "session.started":
      summary.running = true;
      delete summary.interrupted;
      delete summary.stopReason;
      break;
    case "run.interrupted":
      summary.running = false;
      summary.interrupted = true;
      break;
    case "session.finished":
      summary.running = false;
      delete summary.interrupted;
      summary.stopReason = event.result.stopReason;
      break;
  }
}

async function listSessionIds(cwd: string): Promise<string[]> {
  const entries = await readdir(sessionsRoot(cwd), { withFileTypes: true }).catch(
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    },
  );
  return entries
    .filter((entry) => entry.isDirectory() && isValidSessionId(entry.name))
    .map((entry) => entry.name);
}

async function scanSession(cwd: string, id: string): Promise<SessionSummary | undefined> {
  try {
    const paths = sessionPaths(cwd, id);
    const [read, meta] = await Promise.all([readTolerant(paths.events), stat(paths.events)]);
    const started = read.envelopes.find((envelope) => envelope.event.type === "session.started");
    if (started?.event.type !== "session.started") return undefined;

    let lastPrompt = redact(started.event.prompt);
    let messageCount = 0;
    let tokens = 0;
    const lifecycle: Pick<SessionSummary, "running" | "interrupted" | "stopReason"> = {};
    for (const envelope of read.envelopes) {
      applyLifecycle(lifecycle, envelope.event);
      switch (envelope.event.type) {
        case "session.started":
          if (!envelope.event.internal) lastPrompt = redact(envelope.event.prompt);
          break;
        case "message.finished":
          messageCount += 1;
          break;
        case "session.finished":
          tokens += envelope.event.result.usage.input + envelope.event.result.usage.output;
          break;
      }
    }

    const createdAt =
      started.schemaVersion > 0
        ? started.ts
        : (meta.birthtimeMs > 0 ? meta.birthtime : meta.mtime).toISOString();
    return {
      id,
      title: titleFromPrompt(started.event.prompt, id),
      project: basename(cwd),
      createdAt,
      updatedAt: meta.mtime.toISOString(),
      ...lifecycle,
      messageCount,
      tokens,
      lastPrompt,
    };
  } catch {
    return undefined;
  }
}

export async function scanSessions(cwd: string): Promise<SessionSummary[]> {
  const ids = await listSessionIds(cwd);
  const sessions = await Promise.all(ids.map((id) => scanSession(cwd, id)));
  return sortSessions(
    sessions.filter((session): session is SessionSummary => session !== undefined),
  );
}

async function loadForWrite(cwd: string): Promise<SessionSummary[]> {
  return (await readIndexFile(cwd)) ?? scanSessions(cwd);
}

async function indexedSessions(cwd: string): Promise<SessionSummary[]> {
  const indexed = await readIndexFile(cwd);
  if (!indexed) {
    const scanned = await scanSessions(cwd);
    await writeIndexFile(cwd, scanned).catch(() => undefined);
    return sortSessions(scanned);
  }

  const known = new Set(indexed.map((session) => session.id));
  const missing = (await listSessionIds(cwd)).filter((id) => !known.has(id));
  if (missing.length === 0) return sortSessions(indexed);

  const legacy = await Promise.all(missing.map((id) => scanSession(cwd, id)));
  const merged = [
    ...indexed,
    ...legacy.filter((session): session is SessionSummary => session !== undefined),
  ];
  if (merged.length > indexed.length) await writeIndexFile(cwd, merged).catch(() => undefined);
  return sortSessions(merged);
}

function applyOptions(
  sessions: readonly SessionSummary[],
  options: SessionListOptions,
): SessionSummary[] {
  const needle = options.query?.trim().toLocaleLowerCase("ru") ?? "";
  const matched = needle
    ? sessions.filter((session) =>
        [session.id, session.title, session.project, session.lastPrompt].some((value) =>
          value.toLocaleLowerCase("ru").includes(needle),
        ),
      )
    : [...sessions];
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const limit =
    options.limit === undefined ? matched.length : Math.max(0, Math.trunc(options.limit));
  return matched.slice(offset, offset + limit).map((session) => ({
    ...session,
    title: redact(session.title),
    lastPrompt: redact(session.lastPrompt),
  }));
}

export async function listSessions(
  cwd: string,
  options: SessionListOptions = {},
): Promise<SessionSummary[]> {
  const sessions = await serialized(cwd, () => indexedSessions(cwd));
  return applyOptions(sessions, options);
}

// ponytail: index file is rewritten per finished message; batch writes if sessions reach tens of thousands of messages.
export async function recordSessionEvent(cwd: string, event: Event): Promise<void> {
  const id = event.sessionId;
  if (!id || !isValidSessionId(id)) return;
  if (
    event.type !== "session.started" &&
    event.type !== "message.finished" &&
    event.type !== "session.finished" &&
    event.type !== "run.interrupted"
  ) {
    return;
  }

  await serialized(cwd, async () => {
    const sessions = await loadForWrite(cwd);
    const index = sessions.findIndex((session) => session.id === id);
    const current = index >= 0 ? sessions[index] : undefined;
    const now = new Date().toISOString();

    let next: SessionSummary;
    if (!current) {
      if (event.type !== "session.started") return;
      next = {
        id,
        title: titleFromPrompt(event.prompt, id),
        project: basename(cwd),
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        tokens: 0,
        lastPrompt: redact(event.prompt),
      };
    } else {
      next = { ...current, updatedAt: now };
      if (event.type === "session.started") {
        next.project = basename(cwd);
        if (!event.internal) next.lastPrompt = redact(event.prompt);
      } else if (event.type === "message.finished") {
        next.messageCount += 1;
      } else if (event.type === "session.finished") {
        next.tokens = (current.tokens ?? 0) + event.result.usage.input + event.result.usage.output;
      }
    }
    applyLifecycle(next, event);

    if (index >= 0) sessions[index] = next;
    else sessions.push(next);
    await writeIndexFile(cwd, sessions);
  });
}

export async function renameSession(
  cwd: string,
  id: string,
  title: string,
): Promise<SessionSummary> {
  assertSessionId(id);
  const clean = redact(title.trim()).slice(0, 72);
  if (!clean) throw new Error("title is required");

  return serialized(cwd, async () => {
    const sessions = await loadForWrite(cwd);
    const index = sessions.findIndex((session) => session.id === id);
    let record = index >= 0 ? sessions[index] : await scanSession(cwd, id);
    if (!record) throw new Error(`unknown session: ${id}`);
    record = { ...record, title: clean, updatedAt: new Date().toISOString() };
    if (index >= 0) sessions[index] = record;
    else sessions.push(record);
    await writeIndexFile(cwd, sessions);
    return record;
  });
}

async function sessionRecord(cwd: string, id: string): Promise<SessionSummary | undefined> {
  const sessions = await loadForWrite(cwd);
  return sessions.find((session) => session.id === id) ?? (await scanSession(cwd, id));
}

export async function deleteSession(
  cwd: string,
  id: string,
): Promise<{ id: string; trash: string }> {
  assertSessionId(id);
  const paths = sessionPaths(cwd, id);
  const info = await stat(paths.session).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`unknown session: ${id}`);

  return serialized(cwd, async () => {
    const trashRoot = join(cwd, ".liquid", "trash");
    await mkdir(trashRoot, { recursive: true });
    let trash = join(trashRoot, id);
    if (await stat(trash).catch(() => undefined)) {
      trash = join(trashRoot, `${id}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`);
    }
    await rename(paths.session, trash);
    const deletedAt = new Date();
    await utimes(trash, deletedAt, deletedAt);

    const sessions = await loadForWrite(cwd);
    const remaining = sessions.filter((session) => session.id !== id);
    if (remaining.length !== sessions.length) await writeIndexFile(cwd, remaining);
    return { id, trash };
  });
}

export async function forkSession(
  cwd: string,
  sourceId: string,
  options: ForkSessionOptions = {},
): Promise<SessionSummary> {
  assertSessionId(sourceId);
  assertForkOptions(options);

  const source = await serialized(cwd, () => sessionRecord(cwd, sourceId));
  if (!source) throw new Error(`unknown session: ${sourceId}`);

  const { envelopes } = await readTolerant(sessionPaths(cwd, sourceId).events);
  if (envelopes.length === 0) throw new Error(`session ${sourceId} has no events`);

  const cutoff = forkCutoff(envelopes, options, sourceId);
  const selected = envelopes.filter(
    (envelope) => envelope.seq <= cutoff && envelope.event.type !== "session.finished",
  );
  if (selected.length === 0) throw new Error(`nothing to fork from session ${sourceId}`);

  const id = newId("s_fork");
  const target = sessionPaths(cwd, id);
  const sourcePaths = sessionPaths(cwd, sourceId);
  const { lines, messageCount } = forkLines(selected, id, sourceId, {
    source: sourcePaths,
    target,
  });
  await mkdir(target.session, { recursive: true });
  await cp(sessionPaths(cwd, sourceId).attachments, target.attachments, {
    recursive: true,
    force: true,
  }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw errorOf(error);
  });
  await writeFile(target.events, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await cp(sessionPaths(cwd, sourceId).logs, target.logs, {
    recursive: true,
    force: true,
  }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw errorOf(error);
  });
  const lastPage = selected.reduce(
    (latest, { event }) =>
      event.type === "context.compacted"
        ? Math.max(latest, event.page ?? event.contextSummary?.page ?? 0)
        : latest,
    0,
  );
  await copyPageArchive(sourcePaths, target, lastPage);
  const workerPage = selected.reduce((latest, { event }) => {
    if (event.type !== "worker.event" || event.event.type !== "context.compacted") return latest;
    return Math.max(latest, event.event.page ?? event.event.contextSummary?.page ?? 0);
  }, 0);
  if (workerPage > 0) {
    const sourceWorker = sessionPaths(cwd, `${sourceId}_worker`);
    const targetWorker = sessionPaths(cwd, `${id}_worker`);
    await copyPageArchive(sourceWorker, targetWorker, workerPage);
    await cp(sourceWorker.logs, targetWorker.logs, { recursive: true, force: true }).catch(
      (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw errorOf(error);
      },
    );
  }

  const now = new Date().toISOString();
  const requestedTitle = options.title ? redact(options.title.trim()).slice(0, 72) : "";
  const title = requestedTitle || `${source.title} (fork)`.slice(0, 72);
  const record: SessionSummary = {
    id,
    title,
    project: source.project || basename(cwd),
    createdAt: now,
    updatedAt: now,
    stopReason: "end",
    messageCount,
    lastPrompt: source.lastPrompt,
  };
  await serialized(cwd, async () => {
    const sessions = (await loadForWrite(cwd)).filter((session) => session.id !== id);
    sessions.push(record);
    await writeIndexFile(cwd, sessions);
  });
  return record;
}
