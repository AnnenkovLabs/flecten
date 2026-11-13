// Which events a fork keeps and how they are rewritten for the new session id.
import { basename } from "node:path";
import type { Event, SessionId } from "../../core/types";
import { redactValue } from "../../util/redact";
import { type SessionPaths, sessionPaths } from "../paths";
import { type EventEnvelope, SCHEMA_VERSION } from "./envelope";

export type { ForkSessionOptions } from "../../core/services/storage";

import type { ForkSessionOptions } from "../../core/services/storage";

export function assertForkOptions(options: ForkSessionOptions): void {
  if (
    options.sequence !== undefined &&
    (!Number.isInteger(options.sequence) || options.sequence < 0)
  ) {
    throw new Error("sequence must be a non-negative integer");
  }
  if (options.turn !== undefined && (!Number.isInteger(options.turn) || options.turn < 1)) {
    throw new Error("turn must be a positive integer");
  }
}

/** Last sequence the fork keeps: an explicit one, the end of a turn, or everything. */
export function forkCutoff(
  envelopes: readonly EventEnvelope[],
  options: ForkSessionOptions,
  sourceId: string,
): number {
  if (options.sequence !== undefined) return options.sequence;
  if (options.turn === undefined) return Number.POSITIVE_INFINITY;
  const targetTurn = options.turn;
  const latest = [...envelopes].reverse();
  const finishedTurn = latest.find(
    (envelope) => envelope.event.type === "turn.finished" && envelope.event.turn === targetTurn,
  );
  if (finishedTurn) return finishedTurn.seq;
  const startedTurn = latest.find(
    (envelope) => envelope.event.type === "turn.started" && envelope.event.turn === targetTurn,
  );
  if (!startedTurn) throw new Error(`turn ${targetTurn} not found in session ${sourceId}`);
  const nextTurn = envelopes.find(
    (envelope) =>
      envelope.seq > startedTurn.seq &&
      envelope.event.type === "turn.started" &&
      envelope.event.turn > targetTurn,
  );
  return nextTurn ? nextTurn.seq - 1 : Number.POSITIVE_INFINITY;
}

function rewriteEventSession(event: Event, sessionId: SessionId): Event {
  if (event.type === "error") {
    return event.sessionId === undefined ? event : { ...event, sessionId };
  }
  return { ...event, sessionId };
}

function forkPageReferences(
  event: Event,
  paths?: { source: SessionPaths; target: SessionPaths },
): Event {
  if (event.type === "worker.event" && paths) {
    const workerId = `${basename(paths.target.session)}_worker`;
    const child = forkPageReferences(event.event, {
      source: sessionPaths(paths.source.root, `${event.sessionId}_worker`),
      target: sessionPaths(paths.target.root, workerId),
    });
    if (child.type === "worker.event") throw new Error("Nested Workers cannot be forked");
    return { ...event, event: { ...child, sessionId: workerId } };
  }
  if (event.type !== "context.compacted" || !paths) return event;
  return {
    ...event,
    summary: event.summary
      .replaceAll(paths.source.pages, paths.target.pages)
      .replaceAll(paths.source.logs, paths.target.logs),
    ...(event.path ? { path: event.path.replaceAll(paths.source.pages, paths.target.pages) } : {}),
  };
}

/** Journal lines of the fork, closed with a finished session so it opens as a past task. */
export function forkLines(
  selected: readonly EventEnvelope[],
  id: SessionId,
  sourceId: string,
  paths?: { source: SessionPaths; target: SessionPaths },
): { lines: unknown[]; messageCount: number } {
  let lastSeq = 0;
  const lines: unknown[] = selected.map((envelope) => {
    lastSeq = Math.max(lastSeq, envelope.seq);
    return redactValue({
      seq: envelope.seq,
      ts: envelope.schemaVersion > 0 ? envelope.ts : new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
      sessionId: id,
      event: rewriteEventSession(forkPageReferences(envelope.event, paths), id),
    });
  });
  const turns = selected.reduce(
    (max, envelope) =>
      envelope.event.type === "turn.finished" ? Math.max(max, envelope.event.turn) : max,
    0,
  );
  const messageCount = selected.filter(
    (envelope) => envelope.event.type === "message.finished",
  ).length;
  lines.push({
    seq: lastSeq + 1,
    ts: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    sessionId: id,
    event: {
      type: "session.finished",
      sessionId: id,
      result: {
        sessionId: id,
        pass: false,
        stopReason: "end",
        summary: `Forked from ${sourceId}.`,
        turns,
        usage: { input: 0, output: 0, cached: 0 },
      },
    },
  });
  return { lines, messageCount };
}
