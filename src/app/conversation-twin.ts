import twinDirections from "../../prompts/twin-directions.md" with { type: "text" };
import type { TwinDecision, TwinDelegateInput, TwinSnapshot } from "../../shared/twin";
import type { TwinActivity, TwinActivityEvent } from "../../shared/twin-activity";
import { PageCommandSchema } from "../core/pages/control";
import type { BudgetLimits } from "../core/session/budget";
import type { SessionOptions } from "../core/session/options";
import type { Event, SessionEvent } from "../core/types";
import { TwinInferenceError } from "../twin/inference-error";
import { redactKnown } from "../util/redact";
import { TwinMedia } from "./twin-media";

export interface ConversationTwinPort {
  get(): Promise<TwinSnapshot>;
  delegate(input: TwinDelegateInput, signal: AbortSignal): Promise<TwinDecision>;
}

/** One bounded representative per conversation, separate from project memory. */
export class ConversationTwin {
  #controller = new AbortController();
  #revision = 0;
  #taskId = "";
  #media: TwinMedia;
  #task = "";
  #directive = "";
  #messages: string[] = [];
  #submitted: string[] = [];
  #evidence: string[] = [];
  #checkpoint = false;
  #checkpoints = 0;
  #started = Date.now();
  #spent = { tokens: 0, cost: 0 };
  #current = { tokens: 0, cost: 0 };
  corrections = 0;
  async enabled(): Promise<boolean> {
    return !!this.port && (await this.port.get()).enabled;
  }
  get revision(): number {
    return this.#revision;
  }

  constructor(
    private readonly port: ConversationTwinPort | undefined,
    private readonly options: SessionOptions,
    private readonly emit: (event: TwinActivityEvent) => void,
  ) {
    this.#media = new TwinMedia(options);
  }

  restore(events: readonly Event[]): void {
    for (const event of events) {
      if (event.type === "session.started" && !event.internal) this.user(event.prompt);
      if (event.type === "steer.applied") this.user(event.text);
    }
  }

  user(text: string): void {
    this.#messages = [...this.#messages.slice(-15), text];
    this.#revision++;
    this.#controller.abort();
    this.#controller = new AbortController();
    // A fresh instruction retires the old inferred direction, including during a review.
    this.#directive = "";
  }

  submitted(text: string): void {
    this.#submitted.push(text);
    this.user(text);
  }

  applied(text: string): void {
    const index = this.#submitted.indexOf(text);
    if (index < 0) this.user(text);
    else this.#submitted.splice(index, 1);
  }

  begin(task: string): void {
    this.cancel();
    this.#controller = new AbortController();
    this.#task = task;
    this.#taskId = crypto.randomUUID();
    this.#media.reset();
    this.#directive = "";
    this.#evidence = [];
    this.#checkpoint = false;
    this.#checkpoints = 0;
    this.corrections = 0;
    this.#started = Date.now();
    this.#spent = { tokens: 0, cost: 0 };
    this.#current = { tokens: 0, cost: 0 };
  }

  cancel(): void {
    this.#revision++;
    this.#controller.abort();
    this.#checkpoint = false;
  }

  note(event: SessionEvent): void {
    this.#media.note(event);
    if (event.type === "budget") {
      this.#current = {
        tokens: event.budget.spent.tokens,
        cost: event.budget.spent.costUsd ?? 0,
      };
    }
    if (event.type !== "tool.finished") return;
    const { call, result } = event;
    // Actual executed calls and their results, not just the Worker's final self-assessment.
    this.#evidence = [
      ...this.#evidence.slice(-11),
      `Tool: ${call.name}\nArguments: ${JSON.stringify(call.args).slice(0, 1400)}\nSucceeded: ${result.ok}\nOutput: ${result.output.slice(0, 1000)}\nResult details: ${JSON.stringify(result.data ?? null).slice(0, 1400)}`.slice(
        0,
        4000,
      ),
    ];
    if (call.name !== "context" || !result.ok) return;
    const page = PageCommandSchema.safeParse(call.args);
    if (page.success && page.data.op === "complete") this.#checkpoint = true;
  }

  commitWorker(): void {
    this.#spent.tokens += this.#current.tokens;
    this.#spent.cost += this.#current.cost;
    this.#current = { tokens: 0, cost: 0 };
  }

  remaining(): BudgetLimits | undefined {
    const limits = this.options.budgets;
    if (!limits) return undefined;
    return {
      ...(limits.maxTokens === undefined
        ? {}
        : { maxTokens: Math.max(0, limits.maxTokens - this.#spent.tokens - this.#current.tokens) }),
      ...(limits.maxCostUsd === undefined
        ? {}
        : { maxCostUsd: Math.max(0, limits.maxCostUsd - this.#spent.cost - this.#current.cost) }),
      ...(limits.maxWallClockMs === undefined
        ? {}
        : { maxWallClockMs: Math.max(0, limits.maxWallClockMs - (Date.now() - this.#started)) }),
    };
  }

  exhausted(): boolean {
    return Object.values(this.remaining() ?? {}).some((value) => value !== undefined && value <= 0);
  }

  async checkpoint() {
    if (!this.#checkpoint) return [];
    this.#checkpoint = false;
    // ponytail: at most four stage reviews; use explicit task budgets for longer pipelines.
    if (this.#checkpoints++ >= 4) return [];
    const decision = await this.decide("checkpoint");
    return decision?.verdict === "revise"
      ? [{ kind: "notice" as const, text: this.directions(decision) }]
      : [];
  }

  directions(decision: TwinDecision): string {
    return `${twinDirections.trim()}\n\n## Twin speaking for the user\n${decision.voice}\n\n## Directions\n${decision.instructions}`;
  }

  unresolved(decision: TwinDecision): void {
    this.emit({
      type: "twin.activity",
      sessionId: this.options.sessionId ?? "",
      activity: {
        taskId: this.#taskId,
        phase: "final",
        state: "exhausted",
        emotion: decision.emotion,
        voice: decision.voice,
        instructions: decision.instructions,
        entryIds: decision.entryIds,
        corrections: this.corrections,
        provider: decision.provider,
        model: decision.model,
      },
    });
  }

  async decide(
    phase: TwinDelegateInput["phase"],
    extra: { result?: string; question?: string } = {},
    externalSignal?: AbortSignal,
  ): Promise<TwinDecision | undefined> {
    if (!this.port || this.#controller.signal.aborted) return;
    if (!(await this.port.get()).enabled) {
      this.activity(phase, "disabled");
      return;
    }
    if (this.exhausted()) {
      this.activity(
        phase,
        "exhausted",
        "Twin review stopped at the task budget. Completion is unconfirmed.",
      );
      return;
    }
    const revision = this.#revision;
    const taskId = this.#taskId;
    const signal = AbortSignal.any([
      this.#controller.signal,
      ...(externalSignal ? [externalSignal] : []),
      AbortSignal.timeout(
        Math.max(1, Math.min(60_000, this.remaining()?.maxWallClockMs ?? 60_000)),
      ),
    ]);
    this.activity(phase, "running");
    try {
      const media =
        phase === "prepare" ? { images: [], notice: "" } : await this.#media.load(signal);
      const decision = await this.port.delegate(
        {
          phase,
          userMessages: this.#messages.map((message) => message.slice(-16000)),
          task: this.#task.slice(0, 16000),
          directive: this.#directive.slice(0, 16000),
          evidence: [...this.#evidence, ...(media.notice ? [media.notice] : [])].slice(-12),
          ...(media.images.length ? { images: media.images } : {}),
          ...(extra.result === undefined ? {} : { result: extra.result.slice(0, 24000) }),
          ...(extra.question === undefined ? {} : { question: extra.question.slice(0, 2000) }),
        },
        signal,
      );
      // Bill completed requests even if a newer human instruction retired their verdict.
      if (taskId === this.#taskId) {
        this.#spent.tokens += decision.usage.input + decision.usage.output;
        this.#spent.cost += decision.usage.costUsd ?? 0;
      }
      const retired = revision !== this.#revision || signal.aborted;
      this.emit({
        type: "twin.activity",
        sessionId: this.options.sessionId ?? "",
        activity: {
          taskId,
          phase,
          state: retired ? "cancelled" : decision.verdict,
          emotion: decision.emotion,
          voice: decision.voice,
          instructions: decision.instructions,
          entryIds: decision.entryIds,
          corrections: this.corrections,
          provider: decision.provider,
          model: decision.model,
          usage: decision.usage,
        },
      });
      if (retired) return;
      if (decision.instructions) this.#directive = decision.instructions;
      return decision;
    } catch (error) {
      if (error instanceof TwinInferenceError) {
        if (taskId === this.#taskId) {
          this.#spent.tokens += error.usage.input + error.usage.output;
          this.#spent.cost += error.usage.costUsd ?? 0;
        }
        this.emit({
          type: "twin.activity",
          sessionId: this.options.sessionId ?? "",
          activity: {
            taskId,
            phase,
            state: signal.aborted ? "cancelled" : "error",
            emotion: "calm",
            voice: redactKnown(error.message, this.options.secrets?.() ?? []),
            instructions: "",
            entryIds: [],
            corrections: this.corrections,
            provider: error.provider,
            model: error.model,
            usage: error.usage,
          },
        });
      }
      if (
        revision !== this.#revision ||
        this.#controller.signal.aborted ||
        externalSignal?.aborted
      ) {
        if (!(error instanceof TwinInferenceError)) this.activity(phase, "cancelled");
        return;
      }
      if (!(error instanceof TwinInferenceError))
        this.activity(
          phase,
          "error",
          redactKnown(String(error).slice(0, 2000), this.options.secrets?.() ?? []),
        );
      throw error;
    }
  }

  private activity(phase: TwinActivity["phase"], state: TwinActivity["state"], voice = ""): void {
    this.emit({
      type: "twin.activity",
      sessionId: this.options.sessionId ?? "",
      activity: {
        taskId: this.#taskId,
        phase,
        state,
        voice,
        instructions: "",
        emotion: "calm",
        entryIds: [],
        corrections: this.corrections,
        provider: this.options.providerId,
        model: this.options.model,
      },
    });
  }
}
