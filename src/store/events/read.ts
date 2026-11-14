import type { Event } from "../../core/types";
import { eventSchema } from "../../core/types/event-schema";
import { sessionPaths } from "../paths";
import { readTolerant } from "./envelope";
import {
  assertSessionId,
  listSessions as listIndexedSessions,
  type SessionListOptions,
  type SessionSummary,
} from "./index";

export type { StoredEventType } from "../../core/types/event-schema";
export { eventSchema } from "../../core/types/event-schema";
export type { SessionSummary } from "./index";

export async function readSession(
  cwd: string,
  id: string,
): Promise<(Event & { timestamp?: number })[]> {
  assertSessionId(id);
  const { envelopes } = await readTolerant(sessionPaths(cwd, id).events);
  const events: (Event & { timestamp?: number })[] = [];
  for (const envelope of envelopes) {
    try {
      events.push({
        ...(eventSchema.parse(envelope.event) as Event),
        ...(envelope.schemaVersion > 0 ? { timestamp: Date.parse(envelope.ts) } : {}),
      });
    } catch {
      // ponytail: invalid payloads are skipped; expose them through readSessionDetailed when the UI needs diagnostics.
    }
  }
  return events;
}

export async function listSessions(
  cwd: string,
  options: SessionListOptions = {},
): Promise<SessionSummary[]> {
  return listIndexedSessions(cwd, options);
}
