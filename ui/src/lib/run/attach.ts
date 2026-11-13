import type { AgentEvent, AgentReplay } from "../agent-protocol";
import type { SessionEvent } from "./view.svelte";

/**
 * Events to rebuild a task on screen: the stored log up to its last run, then that run as
 * the core holds it live (with the deltas of an unfinished message). A task the core no
 * longer holds is just its stored log.
 */
export function attachedEvents(
  stored: readonly AgentEvent[],
  replay: AgentReplay | undefined,
): AgentEvent[] {
  if (!replay || replay.events.length === 0) return [...stored];
  let lastStart = -1;
  for (let index = stored.length - 1; index >= 0; index -= 1) {
    if (stored[index]?.type === "session.started") {
      lastStart = index;
      break;
    }
  }
  const live = replay.events[0];
  const last = stored[lastStart];
  // ponytail: the journal holds only the current run, so a stored run is matched to it by
  // prompt and queue id; a repeated prompt sent within the same few ms is shown once.
  const same =
    last?.type === "session.started" &&
    live?.type === "session.started" &&
    last.prompt === live.prompt &&
    last.queueId === live.queueId;
  const before = same ? stored.slice(0, lastStart) : [...stored];
  return [...before, ...replay.events];
}

/** Live events that arrived while attaching: the replay already holds those up to its seq. */
export function afterReplay<T extends AgentEvent>(
  buffered: readonly T[],
  replay: AgentReplay | undefined,
): T[] {
  if (!replay) return [...buffered];
  return buffered.filter((event) => event.seq === undefined || event.seq > replay.seq);
}

export function isSessionEvent(event: AgentEvent): event is SessionEvent {
  return (
    event.type !== "status" &&
    event.type !== "error" &&
    "sessionId" in event &&
    typeof event.sessionId === "string"
  );
}
