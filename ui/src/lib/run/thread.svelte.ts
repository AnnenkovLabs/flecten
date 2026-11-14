import {
  doneData,
  fileDiff,
  fileKind,
  formatDuration,
  terminalData,
  terminalLines,
  toolAction,
} from "../agent";
import { splitAnswerStream } from "../markdown/summary-stream";
import { nextId, nowIso } from "../run-helpers";
import type {
  AgentRunResult,
  AgentToolCall,
  AgentToolResult,
  DiffFile,
  IconName,
  PendingToolCall,
  RunAction,
  RunSummary,
  RunTurn,
  TerminalLine,
  ThreadItem,
} from "../types";
import { answerDisplayText } from "../ui-polish";

type AnswerItem = Extract<ThreadItem, { kind: "answer" }>;

/** The call saved a checkpoint: the history pane has a new entry. */
export function hasCheckpoint(result: AgentToolResult): boolean {
  const data = result.data;
  return Boolean(data && typeof data === "object" && "checkpointId" in data);
}

/**
 * The visible thread of the task on screen, built from its events: user messages, the run
 * with turns and tool calls, the answer, approval cards and notices. Live events and a
 * replayed log go through the same methods, using the original event times.
 */
export class ThreadView {
  items = $state<ThreadItem[]>([]);
  changeFiles = $state<DiffFile[]>([]);
  terminalLines = $state<TerminalLine[]>([]);
  pendingCalls = $state<PendingToolCall[]>([]);
  restoring = false;

  #answerId: string | null = null;
  #answerFinished = false;
  #runItemId: string | null = null;
  #runStarted = 0;
  #turnStartedAt = 0;
  #thinkingStartedAt = 0;
  #actions: RunAction[] = [];
  #turns: RunTurn[] = [];
  #currentTurn: RunTurn | null = null;
  #files = new Map<string, DiffFile>();
  #done: { summary: string; evidence: string[] } | null = null;
  #answerRaw = "";
  #currentPrompt = "";

  get hasAnswer(): boolean {
    return this.#answerId !== null;
  }

  clear(): void {
    this.items = [];
    this.resetSession();
  }

  resetRun(): void {
    this.#answerId = null;
    this.#answerFinished = false;
    this.#runItemId = null;
    this.#answerRaw = "";
    this.#runStarted = 0;
    this.#turnStartedAt = 0;
    this.#thinkingStartedAt = 0;
    this.#actions = [];
    this.#turns = [];
    this.#currentTurn = null;
    this.pendingCalls = [];
    this.#currentPrompt = "";
    this.#done = null;
  }

  resetSession(): void {
    this.resetRun();
    this.clearFiles();
    this.terminalLines = [];
  }

  clearFiles(): void {
    this.#files = new Map();
    this.changeFiles = [];
  }

  /** A new run with the user's message; `null` for a run without one, as a resume. */
  beginRun(prompt: string | null, at?: string, timestamp = Date.now()): void {
    this.resetRun();
    this.#runStarted = timestamp;
    this.#currentPrompt = prompt ?? "";
    if (prompt !== null) {
      this.push({ kind: "message", id: nextId("msg"), text: prompt, ...(at ? { at } : {}) });
    }
  }

  /** The core started the run this window sent: the message is already on screen. */
  startClock(timestamp = Date.now()): void {
    this.#runStarted = timestamp;
  }

  /** Only the latest notice offers to continue: a new run settles the older ones. */
  settleNotices(): void {
    for (const item of this.items) {
      if (item.kind === "notice" && item.action) delete item.action;
    }
  }

  push(item: ThreadItem): void {
    this.items.push(item);
  }

  turnStarted(index: number, timestamp = Date.now()): void {
    if (this.#currentTurn) this.#currentTurn.reasoningStreaming = false;
    this.#turnStartedAt = timestamp;
    this.#thinkingStartedAt = 0;
    // Compaction and hook notices can create this turn before its start event arrives.
    const existing = this.#turns.find((turn) => turn.index === index);
    this.#currentTurn = existing ?? {
      index,
      reasoning: "",
      reasoningStreaming: false,
      actions: [],
    };
    if (!existing) this.#turns.push(this.#currentTurn);
    this.pendingCalls = [];
  }

  reasoningDelta(text: string, timestamp = Date.now()): void {
    const turn = this.#ensureTurn();
    if (this.#thinkingStartedAt === 0) this.#thinkingStartedAt = timestamp;
    turn.reasoning += text;
    turn.reasoningStreaming = true;
    this.#ensureRun();
    this.#updateRun();
  }

  progressToolCall(index: number, name?: string, delta?: string): void {
    const existing = this.pendingCalls.find((call) => call.index === index);
    this.pendingCalls = existing
      ? this.pendingCalls.map((call) =>
          call.index === index
            ? { ...call, name: name ?? call.name, args: call.args + (delta ?? "") }
            : call,
        )
      : [{ index, name: name ?? "", args: delta ?? "" }];
  }

  appendText(text: string): void {
    const item = this.#ensureAnswer();
    this.#answerRaw += text;
    const split = splitAnswerStream(this.#answerRaw);
    item.text = split.text;
    if (split.started) {
      item.summaryHtml = split.summary;
      item.complete = false;
    } else if (item.summaryHtml !== undefined) {
      delete item.summaryHtml;
    }
  }

  messageReset(): void {
    if (this.#answerFinished) return;
    this.#answerRaw = "";
    const item = this.#answer();
    if (!item) return;
    item.text = "";
    delete item.summaryHtml;
    item.complete = false;
    item.streaming = true;
  }

  finishMessage(
    text: string,
    reasoning: string,
    toolCalls: AgentToolCall[],
    summary?: string,
    timestamp?: number,
    reasoningStartedAt?: number,
  ): void {
    const turn = this.#ensureTurn();
    if (reasoning.length > 0) turn.reasoning = reasoning;
    turn.reasoningStreaming = false;
    if (turn.reasoning.length > 0) {
      const started =
        reasoningStartedAt ?? (this.#thinkingStartedAt || this.#turnStartedAt || this.#runStarted);
      if ((!this.restoring || timestamp !== undefined) && started > 0)
        turn.reasoningMs = Math.max(0, (timestamp ?? Date.now()) - started);
    }
    this.#thinkingStartedAt = 0;
    if (text.length > 0 || summary !== undefined) this.#showAnswer(text, summary);
    const answer = this.#answer();
    if (answer) answer.streaming = false;
    this.#answerFinished = true;
    for (const call of toolCalls) {
      if (this.#actions.some((action) => action.id === call.id)) continue;
      const action = toolAction(call);
      this.#actions.push(action);
      turn.actions.push(action);
    }
    this.pendingCalls = [];
    if (turn.reasoning.length > 0 || turn.actions.length > 0) {
      this.#ensureRun();
      this.#updateRun();
    }
  }

  startTool(call: AgentToolCall): void {
    const turn = this.#ensureTurn();
    const existing = this.#actions.find((action) => action.id === call.id);
    if (existing) existing.running = true;
    else {
      const action = Object.assign(toolAction(call), { running: true });
      this.#actions.push(action);
      turn.actions.push(action);
    }
    this.pendingCalls = [];
    this.#ensureRun();
    this.#updateRun();
  }

  toolOutput(callId: string, text: string): void {
    const action = this.#actions.find((entry) => entry.id === callId);
    if (!action) return;
    action.detail = {
      ...action.detail,
      output: ((action.detail?.output ?? "") + text).slice(-64_000),
    };
    this.#updateRun();
  }

  /** Returns the finished action; `checkpoint` says the call saved a checkpoint. */
  finishTool(
    call: AgentToolCall,
    result: AgentToolResult,
  ): { action: RunAction; checkpoint: boolean } {
    const action = toolAction(call, result, result.durationMs ?? 0);
    this.#setAction(action);
    this.recordResult(result);
    const done = doneData(result);
    if (done) this.#done = done;
    this.#updateRun();
    return { action, checkpoint: hasCheckpoint(result) };
  }

  recordResult(result: AgentToolResult): void {
    const diff = fileDiff(result);
    if (
      diff &&
      (diff.add > 0 || diff.del > 0 || diff.state === "A" || !this.#files.has(diff.path))
    ) {
      // ponytail: the pane shows the latest diff per file, not a cumulative session diff.
      this.#files.set(diff.path, {
        path: diff.path,
        kind: fileKind(diff.path),
        state: diff.state,
        add: diff.add,
        del: diff.del,
        hunks: diff.hunks,
      });
      this.changeFiles = [...this.#files.values()];
    }
    const terminal = terminalData(result);
    if (terminal) {
      this.terminalLines = [...this.terminalLines, ...terminalLines(terminal)].slice(-600);
    }
  }

  /** A note inside the run, as «Контекст сжат». */
  note(icon: IconName, label: string, meta: string, output: string): void {
    const turn = this.#ensureTurn();
    const action: RunAction = { id: nextId("note"), icon, label, meta, duration: "" };
    if (output) action.detail = { output };
    this.#actions.push(action);
    turn.actions.push(action);
    this.#ensureRun();
    this.#updateRun();
  }

  resolveApproval(
    id: string,
    choice: "allow_once" | "allow_session" | "allow_always" | "deny",
    by: "user" | "timeout" | "aborted" | "policy" | "persistence",
  ): void {
    for (const item of this.items) {
      if (item.kind === "approval" && item.approval.id === id) {
        item.state = choice;
        item.by = by;
      }
    }
  }

  interruptTools(): void {
    for (const action of this.#actions) {
      if (action.running || action.state === "queued") action.state = "interrupted";
      delete action.running;
    }
    const run = this.#run();
    if (run) run.summary.live = false;
  }

  finishRun(result: AgentRunResult, timestamp?: number): void {
    for (const turn of this.#turns) {
      if (turn.reasoningStreaming && (!this.restoring || timestamp !== undefined)) {
        const started = this.#thinkingStartedAt || this.#turnStartedAt || this.#runStarted;
        if (started > 0) turn.reasoningMs = Math.max(0, (timestamp ?? Date.now()) - started);
      }
      turn.reasoningStreaming = false;
    }
    this.#thinkingStartedAt = 0;
    const failed = result.stopReason === "error";
    const answer = this.#answer();
    if (answer) {
      answer.streaming = false;
      if (answer.text.length === 0 && !failed && !answer.summaryHtml && result.summary.length > 0) {
        answer.text = result.summary;
      }
    } else if (!failed && !this.#done && result.summary.length > 0) {
      this.push({ kind: "answer", id: nextId("ans"), text: result.summary, at: nowIso() });
    }
    const run = this.#run();
    if (run) {
      run.summary = {
        ...run.summary,
        ...this.#progress(timestamp),
        criteria: this.#done?.evidence.length ?? 0,
        text: this.#done?.summary ?? "",
        live: false,
        failed: result.stopReason === "error" || result.stopReason === "max_turns",
        stopped: result.stopReason === "stopped",
      };
      this.interruptTools();
    }
    this.#currentTurn = null;
    this.pendingCalls = [];
  }

  #showAnswer(text: string, summary: string | undefined): void {
    const item = this.#ensureAnswer();
    const streamed = splitAnswerStream(text);
    const html = summary !== undefined ? summary : streamed.started ? streamed.summary : undefined;
    const display =
      summary !== undefined
        ? answerDisplayText(text, summary)
        : streamed.started
          ? streamed.text
          : text;
    item.text = display;
    this.#answerRaw = display;
    if (html !== undefined && html.trim().length > 0) {
      item.summaryHtml = html;
      item.complete = true;
      item.streaming = false;
    } else if (item.summaryHtml !== undefined) {
      delete item.summaryHtml;
    }
  }

  #answer(): AnswerItem | undefined {
    if (!this.#answerId) return undefined;
    const item = this.items.find((entry) => entry.id === this.#answerId);
    return item?.kind === "answer" ? item : undefined;
  }

  #run(): Extract<ThreadItem, { kind: "run" }> | undefined {
    if (!this.#runItemId) return undefined;
    const item = this.items.find((entry) => entry.id === this.#runItemId);
    return item?.kind === "run" ? item : undefined;
  }

  #ensureTurn(): RunTurn {
    if (this.#currentTurn) return this.#currentTurn;
    const turn: RunTurn = {
      index: this.#turns.length + 1,
      reasoning: "",
      reasoningStreaming: false,
      actions: [],
    };
    this.#turns.push(turn);
    this.#currentTurn = turn;
    return turn;
  }

  #setAction(action: RunAction): void {
    const index = this.#actions.findIndex((entry) => entry.id === action.id);
    if (index >= 0) this.#actions[index] = action;
    else this.#actions.push(action);
    for (const turn of this.#turns) {
      const turnIndex = turn.actions.findIndex((entry) => entry.id === action.id);
      if (turnIndex >= 0) {
        turn.actions[turnIndex] = action;
        return;
      }
    }
    this.#ensureTurn().actions.push(action);
  }

  #visibleTurns(): RunTurn[] {
    return this.#turns
      .filter((turn) => turn.reasoning.length > 0 || turn.actions.length > 0)
      .map((turn) => ({
        ...turn,
        reasoningStreaming: turn.reasoningStreaming ?? false,
        actions: [...turn.actions],
      }));
  }

  #ensureAnswer(): AnswerItem {
    const existing = this.#answer();
    if (existing && !this.#answerFinished) return existing;
    this.#answerRaw = "";
    this.#answerFinished = false;
    const item: AnswerItem = {
      kind: "answer",
      id: nextId("ans"),
      text: "",
      at: nowIso(),
      streaming: true,
    };
    this.push(item);
    this.#answerId = item.id;
    return item;
  }

  #progress(
    timestamp = Date.now(),
  ): Pick<RunSummary, "duration" | "startedAt" | "actions" | "list" | "turns" | "files"> {
    return {
      duration: formatDuration(Math.max(0, timestamp - (this.#runStarted || timestamp))),
      ...(this.#runStarted ? { startedAt: this.#runStarted } : {}),
      actions: this.#actions.length,
      list: [...this.#actions],
      turns: this.#visibleTurns(),
      files: [...this.#files.values()].map((file) => ({
        path: file.path,
        kind: file.kind,
        add: file.add,
        ...(file.del === undefined ? {} : { del: file.del }),
      })),
    };
  }

  #ensureRun(): void {
    if (this.#runItemId) return;
    const summary: RunSummary = {
      ...this.#progress(),
      criteria: 0,
      text: "",
      files: [],
      prompt: this.#currentPrompt,
      live: true,
    };
    const item: Extract<ThreadItem, { kind: "run" }> = { kind: "run", id: nextId("run"), summary };
    const answerIndex = this.#answerId
      ? this.items.findIndex((entry) => entry.id === this.#answerId)
      : -1;
    if (answerIndex >= 0) this.items.splice(answerIndex, 0, item);
    else this.push(item);
    this.#runItemId = item.id;
  }

  #updateRun(): void {
    const run = this.#run();
    if (run) run.summary = { ...run.summary, ...this.#progress(), live: true };
  }
}
