import { phaseFromEvent } from "../core/session/state";
import { readSession } from "../store/events/read";
import { restoredQueue } from "../store/queue";

/** Old logs and current logs yield the same core-owned phase after a restart. */
export async function restoredSession(
  cwd: string,
  sessionId: string | undefined,
  storage?: { read(id: string): Promise<import("../core/types").Event[]> },
) {
  if (!sessionId) return {};
  const [events, queue] = await Promise.all([
    storage ? storage.read(sessionId) : readSession(cwd, sessionId),
    restoredQueue(cwd, sessionId),
  ]);
  let phase: import("../../shared/session-state").SessionPhase = "idle";
  let interrupted = false;
  for (const event of events) {
    phase = phaseFromEvent(event, phase);
    if (event.type === "run.interrupted") interrupted = true;
    else if (event.type === "session.started") interrupted = false;
  }
  // A restored handle has no active controller, even if the last process died mid-stream.
  if (phase === "running" || phase === "writing") {
    phase = "stopped";
    interrupted = true;
  }
  return { sessionId, initialPhase: phase, interrupted, ...(queue ? { queue } : {}) };
}
