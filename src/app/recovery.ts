import type { HarnessConfig } from "../config/schema";
import type { Event } from "../core/types";
import { readTolerant } from "../store/events/envelope";
import { listSessions } from "../store/events/read";
import { sessionPaths } from "../store/paths";

export interface InterruptedRun {
  sessionId: string;
  /** The interrupted run was itself a resume: resuming again could loop on the same crash. */
  wasResumed: boolean;
}

const LIST_LIMIT = 10_000;

/**
 * Runs that were active when the sidecar stopped. The index marks a session running at
 * session.started and clears it at session.finished, so a running mark at startup means
 * the process died mid-run. Each one gets a run.interrupted event in its log.
 */
export async function markInterrupted(
  cwd: string,
  persist: (event: Event) => Promise<void>,
  storage?: Pick<import("./session-storage").SessionStorage, "list" | "envelopes">,
): Promise<InterruptedRun[]> {
  const sessions = await (storage
    ? storage.list({ limit: LIST_LIMIT })
    : listSessions(cwd, { limit: LIST_LIMIT }));
  const interrupted: InterruptedRun[] = [];
  for (const session of sessions) {
    const envelopes = storage
      ? await storage.envelopes(session.id)
      : (await readTolerant(sessionPaths(cwd, session.id).events)).envelopes;
    const workerEvents = envelopes.flatMap(({ event }) =>
      event.type === "worker.event" ? [event.event] : [],
    );
    const workerBoundary = workerEvents.findLast(
      (event) =>
        event.type === "session.started" ||
        event.type === "session.finished" ||
        event.type === "run.interrupted",
    );
    const workerInterrupted = workerBoundary?.type === "session.started";
    if (workerInterrupted)
      await persist({
        type: "worker.event",
        sessionId: session.id,
        event: {
          type: "run.interrupted",
          sessionId: workerBoundary.sessionId,
          at: Date.now(),
          reason: "Worker process stopped; inspect state before continuing.",
        },
      });
    if (session.running !== true && !workerInterrupted) continue;
    const lastStart = envelopes.findLast(({ event }) => event.type === "session.started")?.event;
    const wasResumed =
      workerInterrupted || (lastStart?.type === "session.started" && lastStart.resumed === true);
    await persist({
      type: "run.interrupted",
      sessionId: session.id,
      at: Date.now(),
      reason: "Ядро остановилось, пока шёл прогон.",
    });
    interrupted.push({ sessionId: session.id, wasResumed });
  }
  return interrupted;
}

/** Interrupted runs to resume on their own: on by default, once per crash, never in a loop. */
export function autoResumable(config: HarnessConfig, runs: readonly InterruptedRun[]) {
  if (config.sessions?.autoResume === false) return [];
  return runs.filter((run) => !run.wasResumed);
}
