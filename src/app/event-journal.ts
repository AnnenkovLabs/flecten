import type { Event, SessionId } from "../core/types";
import { redactKnown } from "../util/redact";
import { RedactionStream } from "../util/redaction-stream";

/** UI metadata survives replay so every window resumes the same sequence and clock. */
export type StampedEvent = Event & { seq: number; timestamp: number; reasoningStartedAt?: number };

export interface JournalReplay {
  sessionId: SessionId;
  /** Events of the current (or last) run of the session, from its session.started. */
  events: StampedEvent[];
  /** Highest sequence number sent so far; live events at or below it are already in `events`. */
  seq: number;
  running: boolean;
}

/** Deltas a finished message makes redundant: its text, reasoning and tool-call progress. */
const STREAM_EVENTS: ReadonlySet<Event["type"]> = new Set([
  "message.delta",
  "reasoning.delta",
  "tool_call.progress",
]);
const MAX_EVENTS_PER_RUN = 20_000;
const MAX_SESSIONS = 32;

function leafEvent(event: Event): Event {
  return event.type === "worker.event" || event.type === "subagent.event"
    ? leafEvent(event.event)
    : event;
}
function streamScope(event: Event): string {
  if (event.type === "worker.event") return `${event.sessionId}:worker:${streamScope(event.event)}`;
  if (event.type === "subagent.event")
    return `${event.sessionId}:${event.id}:${streamScope(event.event)}`;
  return event.sessionId ?? "system";
}

interface RunLog {
  events: StampedEvent[];
  running: boolean;
}

/**
 * Numbers every event and keeps the events of each session's current run in memory, so a
 * reloaded or second window rebuilds a live run without losing a delta. Deltas of finished
 * messages are dropped: the finished message carries the same text. Secrets are masked here,
 * before the live stream and the replay, the same way `events.jsonl` masks them on disk.
 */
export class EventJournal {
  #seq = 0;
  readonly #runs = new Map<SessionId, RunLog>();
  readonly #streams = new Map<string, { stream: RedactionStream; event: Event }>();

  constructor(private readonly secrets: () => readonly string[] = () => []) {}

  /** Flushes incomplete words before structural events while retaining append-only deltas. */
  accept(event: Event): StampedEvent[] {
    const flushed: StampedEvent[] = [];
    const leaf = leafEvent(event);
    if (
      leaf.type === "message.finished" ||
      leaf.type === "message.reset" ||
      leaf.type === "session.finished" ||
      leaf.type === "session.started"
    ) {
      for (const [key, entry] of this.#streams) {
        if (streamScope(entry.event) !== streamScope(event)) continue;
        const text = entry.stream.finish();
        this.#streams.delete(key);
        if (text && leaf.type !== "message.reset" && leaf.type !== "session.started")
          flushed.push(this.#record(this.#withText(entry.event, text)));
      }
    }
    flushed.push(this.stamp(event));
    return flushed;
  }

  stamp(event: Event): StampedEvent {
    const leaf = leafEvent(event);
    if (STREAM_EVENTS.has(leaf.type)) {
      const key = `${streamScope(event)}:${leaf.type}:${leaf.type === "tool_call.progress" ? leaf.index : ""}`;
      let entry = this.#streams.get(key);
      if (!entry) {
        entry = { stream: new RedactionStream(this.secrets()), event };
        this.#streams.set(key, entry);
      }
      const text =
        leaf.type === "tool_call.progress" ? (leaf.delta ?? "") : "text" in leaf ? leaf.text : "";
      entry.event = event;
      return this.#record(this.#withText(event, entry.stream.push(text)));
    }
    return this.#record(event);
  }

  #withText(event: Event, text: string): Event {
    if (event.type === "worker.event")
      return { ...event, event: this.#withText(event.event, text) as typeof event.event };
    if (event.type === "subagent.event")
      return { ...event, event: this.#withText(event.event, text) as typeof event.event };
    if (event.type === "message.delta" || event.type === "reasoning.delta")
      return { ...event, text };
    if (event.type === "tool_call.progress") return { ...event, delta: text };
    return event;
  }

  #record(event: Event): StampedEvent {
    this.#seq += 1;
    const stamped = {
      ...redactKnown(event, this.secrets()),
      seq: this.#seq,
      timestamp: Date.now(),
    } as StampedEvent;
    const sessionId = event.sessionId;
    if (sessionId === undefined) return stamped;
    if (event.type === "session.started") {
      this.#runs.delete(sessionId);
      this.#runs.set(sessionId, { events: [stamped], running: true });
      this.#evict();
      return stamped;
    }
    const run = this.#runs.get(sessionId);
    if (!run) return stamped;
    const leaf = leafEvent(event);
    // A finished message replaces its deltas, but replay still needs the reasoning clock.
    if (leaf.type === "message.finished") {
      for (let index = run.events.length - 1; index >= 0; index -= 1) {
        const entry = run.events[index];
        if (!entry || streamScope(entry) !== streamScope(event)) continue;
        const previous = leafEvent(entry);
        if (previous.type === "reasoning.delta") stamped.reasoningStartedAt = entry.timestamp;
        if (
          previous.type === "message.finished" ||
          previous.type === "message.reset" ||
          previous.type === "turn.started"
        )
          break;
      }
    }
    if (leaf.type === "message.finished" || leaf.type === "message.reset") {
      run.events = run.events.filter(
        (entry) =>
          streamScope(entry) !== streamScope(event) || !STREAM_EVENTS.has(leafEvent(entry).type),
      );
    }
    if (event.type === "session.finished") run.running = false;
    run.events.push(stamped);
    if (run.events.length > MAX_EVENTS_PER_RUN) {
      // ponytail: a run with more than 20k structural events keeps its newest ones; the disk log has all of them.
      run.events.splice(1, run.events.length - MAX_EVENTS_PER_RUN);
    }
    return stamped;
  }

  get seq(): number {
    return this.#seq;
  }

  replay(sessionId: SessionId): JournalReplay {
    const run = this.#runs.get(sessionId);
    return {
      sessionId,
      events: run ? [...run.events] : [],
      seq: this.#seq,
      running: run?.running ?? false,
    };
  }

  forget(sessionId: SessionId): void {
    this.#runs.delete(sessionId);
    for (const [key, entry] of this.#streams)
      if (entry.event.sessionId === sessionId) this.#streams.delete(key);
  }

  #evict(): void {
    for (const [id, run] of this.#runs) {
      if (this.#runs.size <= MAX_SESSIONS) return;
      if (!run.running) this.forget(id);
    }
  }
}
