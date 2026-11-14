import { createReadStream } from "node:fs";
import { type FileHandle, mkdir, open as openFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { Event, EventType, SessionId } from "../../core/types";
import { redactValue } from "../../util/redact";

export const SCHEMA_VERSION = 1;

export type { EventEnvelope } from "../../core/services/storage";

import type { EventEnvelope } from "../../core/services/storage";

export interface CorruptLine {
  line: number;
  error: string;
}

export interface TolerantRead {
  envelopes: EventEnvelope[];
  corrupt: CorruptLine[];
}

export interface AppendOptions {
  fsync?: boolean;
}

/**
 * Every core event type a log line may carry. A Record keyed by EventType makes tsc fail when
 * the core gains an event this list misses, so a new event is never dropped on read as corrupt.
 */
const KNOWN_EVENTS: Record<EventType, true> = {
  "twin.activity": true,
  "session.state": true,
  "session.started": true,
  "input.translated": true,
  "translation.failed": true,
  "turn.started": true,
  "message.started": true,
  "message.delta": true,
  "reasoning.delta": true,
  "message.finished": true,
  "message.reset": true,
  "tool_call.progress": true,
  "tool.started": true,
  "tool.output": true,
  "worker.event": true,
  "subagent.started": true,
  "subagent.event": true,
  "subagent.finished": true,
  "tool.finished": true,
  "steer.applied": true,
  "notice.applied": true,
  "memory.context": true,
  "job.started": true,
  "job.finished": true,
  budget: true,
  "run.interrupted": true,
  "approval.requested": true,
  "approval.resolved": true,
  "context.compacted": true,
  "context.usage": true,
  "model.fallback": true,
  "provider.retry": true,
  usage: true,
  "hook.finished": true,
  "turn.finished": true,
  "session.finished": true,
  error: true,
};
const EVENT_TYPES = Object.keys(KNOWN_EVENTS) as [EventType, ...EventType[]];

// ponytail: checks envelope fields and event type, not every payload; reuse read.ts eventSchema when exported.
export const envelopeSchema = z.looseObject({
  seq: z.number().int().nonnegative(),
  ts: z.iso.datetime(),
  schemaVersion: z.number().int().positive(),
  sessionId: z.string().min(1),
  event: z.looseObject({ type: z.enum(EVENT_TYPES) }),
});

function errorOf(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function withEnvelope(
  event: Event,
  seq: number,
  sessionId: SessionId = event.sessionId ?? "system",
  ts: string = new Date().toISOString(),
): EventEnvelope {
  if (event.sessionId !== undefined && event.sessionId !== sessionId) {
    throw new Error(
      `event session ${event.sessionId} does not match envelope session ${sessionId}`,
    );
  }
  return { seq, ts, schemaVersion: SCHEMA_VERSION, sessionId, event };
}

export function validateEnvelope(value: unknown): EventEnvelope {
  const parsed = envelopeSchema.parse(value);
  return parsed as unknown as EventEnvelope;
}

function parseLine(value: unknown, line: number): EventEnvelope {
  if (typeof value !== "object" || value === null) {
    throw new Error("event line must be an object");
  }
  const record = value as Record<string, unknown>;
  if ("event" in record && "seq" in record) {
    return validateEnvelope(value);
  }
  if (typeof record.type !== "string") {
    throw new Error("event line has no type");
  }
  if (!(EVENT_TYPES as readonly string[]).includes(record.type)) {
    throw new Error(`unknown event type: ${record.type}`);
  }
  const event = value as Event;
  return {
    seq: line,
    ts: new Date(0).toISOString(),
    schemaVersion: 0,
    sessionId: typeof record.sessionId === "string" ? record.sessionId : "system",
    event,
  };
}

export async function readTolerant(path: string): Promise<TolerantRead> {
  const envelopes: EventEnvelope[] = [];
  const corrupt: CorruptLine[] = [];
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let line = 0;
  try {
    for await (const text of lines) {
      line += 1;
      if (text.trim().length === 0) continue;
      try {
        envelopes.push(redactValue(parseLine(JSON.parse(text), line)));
      } catch (error) {
        corrupt.push({ line, error: errorOf(error).message });
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  } finally {
    lines.close();
  }
  return { envelopes, corrupt };
}

export class DurableEventLog {
  // ponytail: guards one writer per session in this process; add a lock file when multiple processes share a log.
  private static readonly writers = new Set<SessionId>();
  private tail: Promise<void> = Promise.resolve();
  private nextSeq: number;
  private closed = false;
  private failure: Error | undefined;

  private constructor(
    private readonly sessionId: SessionId,
    private readonly handle: FileHandle,
    startSeq: number,
  ) {
    this.nextSeq = startSeq;
  }

  static async open(path: string, sessionId: SessionId): Promise<DurableEventLog> {
    if (DurableEventLog.writers.has(sessionId)) {
      throw new Error(`event log for session ${sessionId} is already open`);
    }
    DurableEventLog.writers.add(sessionId);
    try {
      const { envelopes } = await readTolerant(path);
      // ponytail: scans the log on open to recover seq; store seq in a sidecar if startup cost matters.
      const lastSeq = envelopes.reduce((max, envelope) => Math.max(max, envelope.seq), 0);
      await mkdir(dirname(path), { recursive: true });
      const handle = await openFile(path, "a+", 0o600);
      try {
        const { size } = await handle.stat();
        if (size > 0) {
          const last = Buffer.alloc(1);
          await handle.read(last, 0, 1, size - 1);
          // Keep an incomplete tail as its own corrupt line, never merge it with a new event.
          if (last[0] !== 10) await handle.appendFile("\n", "utf8");
        }
        return new DurableEventLog(sessionId, handle, lastSeq + 1);
      } catch (error) {
        await handle.close();
        throw error;
      }
    } catch (error) {
      DurableEventLog.writers.delete(sessionId);
      throw error;
    }
  }

  get lastError(): Error | undefined {
    return this.failure;
  }

  append(event: Event, options: AppendOptions = {}): Promise<void> {
    if (this.closed) {
      const error = new Error("event log is closed");
      this.failure = error;
      return Promise.reject(error);
    }
    const seq = this.nextSeq;
    this.nextSeq += 1;
    const write = this.tail.then(async () => {
      const envelope = redactValue(withEnvelope(event, seq, this.sessionId));
      await this.handle.appendFile(`${JSON.stringify(envelope)}\n`, "utf8");
      if (options.fsync) await this.handle.sync();
    });
    const tracked = write.catch((error: unknown) => {
      this.failure = errorOf(error);
      throw error;
    });
    this.tail = tracked.then(
      () => undefined,
      () => undefined,
    );
    return tracked;
  }

  async flush(): Promise<void> {
    if (this.closed) return;
    await this.tail;
    await this.handle.sync();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    DurableEventLog.writers.delete(this.sessionId);
    try {
      await this.tail;
      await this.handle.sync();
    } finally {
      await this.handle.close();
    }
  }
}
