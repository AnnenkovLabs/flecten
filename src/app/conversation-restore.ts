import type { Event, RunResult, SessionEvent } from "../core/types";

/** Restore review authority from durable events independently of the live loops. */
export function restoreWorkerResult(
  events: readonly Event[],
  childEvents: readonly { event: SessionEvent }[],
  notices: Map<string, string>,
  accepted: boolean,
): RunResult | undefined {
  let lastResult: RunResult | undefined;
  const restoredResult = childEvents.findLast(
    ({ event }) => event.type === "session.finished",
  )?.event;
  if (restoredResult?.type === "session.finished") {
    const workerEnd = events.findLastIndex(
      (event) => event.type === "worker.event" && event.event.type === "session.finished",
    );
    const reviewed = events
      .slice(workerEnd + 1)
      .some(
        (event) =>
          event.type === "twin.activity" &&
          event.activity.phase === "final" &&
          event.activity.state === "pass",
      );
    const preparation = events
      .slice(0, workerEnd)
      .findLast((event) => event.type === "twin.activity" && event.activity.phase === "prepare");
    const usedTwin =
      preparation?.type === "twin.activity" && preparation.activity.state !== "disabled";
    lastResult =
      usedTwin && !reviewed ? { ...restoredResult.result, pass: false } : restoredResult.result;
    if (usedTwin && !reviewed)
      notices.set(
        "unconfirmed",
        "Twin acceptance was interrupted or unresolved. Recheck the current artifacts and resume the review before presenting completion.",
      );
  }
  const boundary = childEvents.findLast(
    ({ event }) =>
      event.type === "session.started" ||
      event.type === "session.finished" ||
      event.type === "run.interrupted",
  )?.event;
  if (boundary?.type === "run.interrupted" || boundary?.type === "session.started")
    notices.set(
      "interrupted",
      "Worker execution was interrupted. Inspect actual files and process state before resuming; previous completion is unconfirmed.",
    );
  if (!accepted && lastResult) lastResult = { ...lastResult, pass: false };
  return lastResult;
}
