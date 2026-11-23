import { fileDiff, fileKind, formatDuration, terminalData, terminalLines } from "../agent";
import { splitAnswerStream } from "../markdown/summary-stream";
import { nextId, nowIso } from "../run-helpers";
import type {
  AgentToolResult,
  DiffFile,
  RunAction,
  RunSummary,
  RunTurn,
  TerminalLine,
  ThreadItem,
} from "../types";
import { answerDisplayText } from "../ui-polish";

export type AnswerItem = Extract<ThreadItem, { kind: "answer" }>;
export type RunItem = Extract<ThreadItem, { kind: "run" }>;

export interface ContinuationSnapshot {
  runIndex: number;
  runStarted: number;
  runElapsedMs: number;
  turnOffset: number;
  summary: RunSummary;
}

export function createAnswerItem(): AnswerItem {
  return { kind: "answer", id: nextId("ans"), text: "", at: nowIso(), streaming: true };
}

export function createRunItem(
  progress: Pick<RunSummary, "duration" | "startedAt" | "actions" | "list" | "turns" | "files">,
  prompt: string,
): RunItem {
  return {
    kind: "run",
    id: nextId("run"),
    summary: { ...progress, criteria: 0, text: "", files: [], prompt, live: true },
  };
}

export function buildRunProgress(
  runStarted: number,
  actions: ReadonlyMap<string, RunAction>,
  turns: readonly RunTurn[],
  files: ReadonlyMap<string, DiffFile>,
  timestamp = Date.now(),
): Pick<RunSummary, "duration" | "startedAt" | "actions" | "list" | "turns" | "files"> {
  return {
    duration: formatDuration(Math.max(0, timestamp - (runStarted || timestamp))),
    ...(runStarted ? { startedAt: runStarted } : {}),
    actions: actions.size,
    list: [...actions.values()],
    turns: visibleTurns(turns),
    files: summaryFiles(files),
  };
}

/** Updates an answer item with streamed or completed text and optional HTML summary. */
export function applyAnswerText(
  item: AnswerItem,
  text: string,
  summary: string | undefined,
): string {
  const streamed = splitAnswerStream(text);
  const html = summary !== undefined ? summary : streamed.started ? streamed.summary : undefined;
  const display =
    summary !== undefined
      ? answerDisplayText(text, summary)
      : streamed.started
        ? streamed.text
        : text;
  item.text = display;
  if (html !== undefined && html.trim().length > 0) {
    item.summaryHtml = html;
    item.complete = true;
    item.streaming = false;
  } else if (item.summaryHtml !== undefined) {
    delete item.summaryHtml;
  }
  return display;
}

/** Appends a text chunk to an in-flight answer stream and updates the item in place. */
export function applyAnswerChunk(item: AnswerItem, raw: string): void {
  const split = splitAnswerStream(raw);
  item.text = split.text;
  if (split.started) {
    item.summaryHtml = split.summary;
    item.complete = false;
  } else if (item.summaryHtml !== undefined) {
    delete item.summaryHtml;
  }
}

/** The call saved a checkpoint: the history pane has a new entry. */
export function hasCheckpoint(result: AgentToolResult): boolean {
  const data = result.data;
  return Boolean(data && typeof data === "object" && "checkpointId" in data);
}

/** Applies a file diff from a tool result into the session map; returns true when updated. */
export function recordFileDiff(files: Map<string, DiffFile>, result: AgentToolResult): boolean {
  const diff = fileDiff(result);
  if (!diff || !(diff.add > 0 || diff.del > 0 || diff.state === "A" || !files.has(diff.path))) {
    return false;
  }
  // ponytail: the pane shows the latest diff per file, not a cumulative session diff.
  files.set(diff.path, {
    path: diff.path,
    kind: fileKind(diff.path),
    state: diff.state,
    add: diff.add,
    del: diff.del,
    hunks: diff.hunks,
  });
  return true;
}

/** Appends bounded terminal output lines from a tool result. */
export function appendTerminalOutput(
  current: readonly TerminalLine[],
  result: AgentToolResult,
): TerminalLine[] | undefined {
  const terminal = terminalData(result);
  if (!terminal) return undefined;
  return [...current, ...terminalLines(terminal)].slice(-600);
}

export function visibleTurns(turns: readonly RunTurn[]): RunTurn[] {
  return turns
    .filter((turn) => turn.reasoning.length > 0 || turn.actions.length > 0)
    .map((turn) => ({
      ...turn,
      reasoningStreaming: turn.reasoningStreaming ?? false,
      actions: [...turn.actions],
    }));
}

export function summaryFiles(files: ReadonlyMap<string, DiffFile>): RunSummary["files"] {
  return [...files.values()].map((file) => ({
    path: file.path,
    kind: file.kind,
    add: file.add,
    ...(file.del === undefined ? {} : { del: file.del }),
  }));
}
