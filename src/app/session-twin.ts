import type {
  TwinCandidate,
  TwinDecision,
  TwinDelegateInput,
  TwinSnapshot,
} from "../../shared/twin";
import type { TwinActivity } from "../../shared/twin-activity";
import type { RunBudget } from "../core/session/budget";
import type { Command, Event, RunResult, SessionEvent } from "../core/types";
import { accountTwinUsage } from "./twin-accounting";

type TwinDelegatePhase = TwinDelegateInput["phase"];

export interface TwinRuntime {
  get(): Promise<TwinSnapshot>;
  delegate(input: TwinDelegateInput, signal: AbortSignal): Promise<TwinDecision>;
  observe?(
    input: {
      sessionId: string;
      text: string;
      precedingAssistant?: string | undefined;
      reference?: string | undefined;
    },
    signal?: AbortSignal,
  ): Promise<{ added: TwinCandidate[]; usage: TwinSnapshot["training"]["usage"] } | undefined>;
}

export interface SessionTwinDriverOptions {
  twin?: TwinRuntime;
  sessionId: () => string;
  ledger: RunBudget;
  emit: (event: Event) => void;
  sendToChat: (command: Command) => Promise<unknown>;
  sendToWorker?: (command: Command) => Promise<unknown>;
}

const CHECKPOINT_STEP_INTERVAL = 2;
const MAX_CHECKPOINTS_PER_RUN = 2;
const MAX_FINAL_REVISIONS_PER_RUN = 1;

function twinMessageText(decision: TwinDecision): string {
  const voice = decision.voice.trim();
  const instructions = decision.instructions.trim();
  if (!instructions || voice.includes(instructions)) return voice;
  return `${voice}\n\n${instructions}`;
}

export class SessionTwinDriver {
  readonly #options: SessionTwinDriverOptions;
  readonly #userMessages: string[] = [];
  readonly #evidence: string[] = [];
  #lastAssistant = "";
  #currentTask = "";
  #stepCount = 0;
  #checkpointsInRun = 0;
  #finalRevisionsInRun = 0;
  #activeReview: AbortController | undefined;
  #disposed = false;

  constructor(options: SessionTwinDriverOptions, history: readonly Event[] = []) {
    this.#options = options;
    for (const event of history) this.#recordHistoryEvent(event);
  }

  note(event: Event): void {
    this.#recordHistoryEvent(event);
    if (this.#disposed || !this.#options.twin) return;

    if (
      event.type === "session.started" &&
      !event.internal &&
      !event.resumed &&
      !event.continuation &&
      event.role !== "worker" &&
      event.actor !== "twin"
    ) {
      this.#stepCount = 0;
      this.#checkpointsInRun = 0;
      this.#finalRevisionsInRun = 0;
      this.#evidence.length = 0;
      this.#currentTask = event.prompt;
      this.#observeUserMessage(event.prompt, this.#lastAssistant);
      return;
    }

    if (event.type === "steer.applied" && event.actor !== "twin") {
      this.#currentTask = event.text;
      this.#observeUserMessage(event.text, this.#lastAssistant);
      return;
    }

    if (event.type === "worker.event") {
      this.#noteInnerEvent(event.event, "worker");
      return;
    }

    this.#noteInnerEvent(event, "main");
  }

  dispose(): void {
    this.#disposed = true;
    this.#activeReview?.abort();
    this.#activeReview = undefined;
  }

  #recordHistoryEvent(event: Event): void {
    if (
      event.type === "session.started" &&
      !event.internal &&
      !event.resumed &&
      !event.continuation &&
      event.role !== "worker" &&
      event.actor !== "twin"
    ) {
      this.#userMessages.push(event.prompt);
      if (this.#userMessages.length > 16) this.#userMessages.shift();
      this.#currentTask = event.prompt;
    } else if (event.type === "steer.applied" && event.actor !== "twin") {
      this.#userMessages.push(event.text);
      if (this.#userMessages.length > 16) this.#userMessages.shift();
      this.#currentTask = event.text;
    } else if (event.type === "message.finished" && event.text.trim()) {
      this.#lastAssistant = event.text;
    } else if (
      event.type === "worker.event" &&
      event.event.type === "message.finished" &&
      event.event.text.trim()
    ) {
      this.#lastAssistant = event.event.text;
    }
  }

  #observeUserMessage(text: string, precedingAssistant: string): void {
    const twin = this.#options.twin;
    if (!twin?.observe) return;
    const sessionId = this.#options.sessionId();
    void twin
      .observe({
        sessionId,
        text,
        ...(precedingAssistant ? { precedingAssistant } : {}),
        reference: `session:${sessionId}`,
      })
      .then((result) => {
        if (!result || this.#disposed) return;
        accountTwinUsage(this.#options.ledger, result.usage);
      })
      .catch(() => undefined);
  }

  #noteInnerEvent(event: SessionEvent, target: "main" | "worker"): void {
    if (event.type === "tool.finished") {
      if (
        event.call.name === "worker" ||
        event.call.name === "done" ||
        event.call.name === "criterion" ||
        event.call.name === "ask_talker"
      )
        return;
      const summary = `${event.call.name}(${JSON.stringify(event.call.args).slice(0, 240)}): ${(event.result.ok ? event.result.output : (event.result.error ?? "failed")).slice(0, 600)}`;
      this.#evidence.push(summary);
      if (this.#evidence.length > 16) this.#evidence.shift();
      this.#stepCount += 1;
      if (
        this.#stepCount % CHECKPOINT_STEP_INTERVAL === 0 &&
        this.#checkpointsInRun < MAX_CHECKPOINTS_PER_RUN &&
        !this.#activeReview
      ) {
        this.#checkpointsInRun += 1;
        void this.#runDelegation("checkpoint", target, "Mid-work execution checkpoint.");
      }
      return;
    }

    if (event.type === "message.finished" && event.text.trim()) {
      this.#evidence.push(`assistant: ${event.text.slice(0, 800)}`);
      if (this.#evidence.length > 16) this.#evidence.shift();
      return;
    }

    if (event.type === "session.finished") {
      this.#stepCount = 0;
      if (
        (event.result.stopReason === "done" || event.result.stopReason === "end") &&
        this.#finalRevisionsInRun < MAX_FINAL_REVISIONS_PER_RUN
      ) {
        void this.#runFinalReview(event.result, target);
      }
    }
  }

  async #enabledSnapshot(): Promise<TwinSnapshot | undefined> {
    const twin = this.#options.twin;
    if (!twin) return undefined;
    try {
      const snapshot = await twin.get();
      if (!snapshot.enabled || snapshot.entries.length === 0) return undefined;
      return snapshot;
    } catch {
      return undefined;
    }
  }

  async #runDelegation(
    phase: TwinDelegatePhase,
    target: "main" | "worker",
    directive: string,
    resultText?: string,
  ): Promise<void> {
    const twin = this.#options.twin;
    if (!twin || this.#disposed || this.#activeReview) return;
    if (this.#options.ledger.stopReason()) return;
    const snapshot = await this.#enabledSnapshot();
    if (!snapshot || this.#disposed || this.#activeReview) return;

    const sessionId = this.#options.sessionId();
    const controller = new AbortController();
    this.#activeReview = controller;
    const corrections = phase === "final" ? this.#finalRevisionsInRun : this.#checkpointsInRun;
    this.#emitActivity(sessionId, {
      phase,
      state: "running",
      emotion: "calm",
      voice:
        phase === "final"
          ? "Checking the agents' summary against your standards..."
          : "Watching the agents' work in progress...",
      instructions: "",
      entryIds: [],
      corrections,
      provider: "",
      model: "",
    });

    try {
      const decision = await twin.delegate(
        {
          phase,
          userMessages: [...this.#userMessages],
          task: this.#currentTask || (this.#userMessages.at(-1) ?? "Current task"),
          directive,
          evidence: [...this.#evidence],
          ...(resultText === undefined ? {} : { result: resultText }),
        },
        controller.signal,
      );
      accountTwinUsage(this.#options.ledger, decision.usage);
      if (this.#disposed || controller.signal.aborted) return;

      const nextCorrections =
        decision.verdict === "revise" ? Math.min(4, corrections + 1) : corrections;
      this.#emitActivity(sessionId, {
        phase,
        state: decision.verdict,
        emotion: decision.emotion,
        voice: decision.voice,
        instructions: decision.instructions,
        entryIds: decision.entryIds,
        corrections: nextCorrections,
        provider: decision.provider,
        model: decision.model,
        usage: decision.usage,
      });

      if (decision.verdict === "revise") {
        if (phase === "final") this.#finalRevisionsInRun += 1;
        await this.#bargeIn(decision, phase, target);
      }
    } catch (error) {
      if (this.#disposed || controller.signal.aborted) return;
      this.#emitActivity(sessionId, {
        phase,
        state: "error",
        emotion: "calm",
        voice: error instanceof Error ? error.message : String(error),
        instructions: "",
        entryIds: [],
        corrections,
        provider: "",
        model: "",
      });
    } finally {
      if (this.#activeReview === controller) {
        this.#activeReview = undefined;
      }
    }
  }

  async #runFinalReview(result: RunResult, target: "main" | "worker"): Promise<void> {
    this.#activeReview?.abort();
    this.#activeReview = undefined;
    const summaryText = [result.summary, this.#lastAssistant].filter(Boolean).join("\n\n");
    await this.#runDelegation(
      "final",
      target,
      "Inspect the agents' summary and work against the user's request and taste.",
      summaryText,
    );
  }

  async #bargeIn(
    decision: TwinDecision,
    phase: TwinDelegatePhase,
    target: "main" | "worker",
  ): Promise<void> {
    const text = twinMessageText(decision);
    if (!text) return;
    if (phase === "checkpoint") {
      if (target === "worker" && this.#options.sendToWorker) {
        await this.#options.sendToWorker({
          type: "queue.add",
          text,
          mode: "steer",
          actor: "twin",
        });
      }
      await this.#options.sendToChat({
        type: "queue.add",
        text,
        mode: "steer",
        actor: "twin",
      });
      return;
    }
    await this.#options.sendToChat({
      type: "run",
      prompt: text,
      actor: "twin",
    });
  }

  #emitActivity(sessionId: string, activity: TwinActivity): void {
    this.#options.emit({
      type: "twin.activity",
      sessionId,
      activity,
    });
  }
}
