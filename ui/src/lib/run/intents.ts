/**
 * What thread cards ask the run store to do. Cards sit deep inside the thread, so they send
 * a window event instead of passing callbacks through every level, like task rename does.
 */

export type ApprovalChoice = "allow_once" | "allow_session" | "allow_always" | "deny";

export interface RunIntents {
  approval(sessionId: string, id: string, choice: ApprovalChoice, feedback?: string): void;
  cancelTool(callId: string): void;
  continueTask(): void;
  stopJob(id: string): void;
  stopWorker?(): void;
}

const APPROVAL = "liquid:approval";
const CANCEL_TOOL = "liquid:tool-cancel";
const CONTINUE = "liquid:task-continue";
const STOP_WORKER = "liquid:worker-stop";
const STOP_JOB = "liquid:job-stop";
export const OPEN_SUBAGENT = "liquid:subagent-open";
export function openSubagent(id: string): void {
  emit(OPEN_SUBAGENT, { id });
}

function emit(name: string, detail: Record<string, string>): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function answerApproval(
  sessionId: string,
  id: string,
  choice: ApprovalChoice,
  feedback?: string,
): void {
  emit(APPROVAL, { sessionId, id, choice, ...(feedback !== undefined ? { feedback } : {}) });
}

export function cancelToolCall(callId: string): void {
  emit(CANCEL_TOOL, { callId });
}

export function continueTask(): void {
  emit(CONTINUE, {});
}

export function stopWorker(): void {
  emit(STOP_WORKER, {});
}

export function stopJob(id: string): void {
  emit(STOP_JOB, { id });
}

function detailOf(event: Event): Record<string, unknown> {
  const detail = (event as CustomEvent<unknown>).detail;
  return detail && typeof detail === "object" ? (detail as Record<string, unknown>) : {};
}

function isChoice(value: unknown): value is ApprovalChoice {
  return (
    value === "allow_once" ||
    value === "allow_session" ||
    value === "allow_always" ||
    value === "deny"
  );
}

/** Subscribes the run store to card intents; returns the unsubscribe. */
export function listenIntents(target: RunIntents): () => void {
  const listeners: Array<[string, (event: Event) => void]> = [
    [
      APPROVAL,
      (event) => {
        const { sessionId, id, choice, feedback } = detailOf(event);
        if (typeof sessionId === "string" && typeof id === "string" && isChoice(choice)) {
          target.approval(
            sessionId,
            id,
            choice,
            typeof feedback === "string" ? feedback : undefined,
          );
        }
      },
    ],
    [
      CANCEL_TOOL,
      (event) => {
        const { callId } = detailOf(event);
        if (typeof callId === "string") target.cancelTool(callId);
      },
    ],
    [CONTINUE, () => target.continueTask()],
    [STOP_WORKER, () => target.stopWorker?.()],
    [
      STOP_JOB,
      (event) => {
        const { id } = detailOf(event);
        if (typeof id === "string") target.stopJob(id);
      },
    ],
  ];
  for (const [name, listener] of listeners) window.addEventListener(name, listener);
  return () => {
    for (const [name, listener] of listeners) window.removeEventListener(name, listener);
  };
}
