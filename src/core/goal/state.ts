import type {
  GoalBudget,
  GoalDecision,
  GoalEvidenceInput,
  GoalInit,
  GoalSnapshot,
  GoalStatus,
  GoalTodo,
  GoalTurnResult,
} from "./types";

function checkCriteria(criteria: readonly string[]): string[] {
  return criteria.map((criterion, index) => {
    if (criterion.trim() === "") throw new Error(`goal criterion ${index + 1} is empty`);
    return criterion;
  });
}

export class GoalState {
  readonly id: string;
  readonly objective: string;
  readonly criteria: string[];
  status: GoalStatus;
  attempts: number;
  startedAt: number;
  readonly budget: GoalBudget;
  readonly evidence: string[];
  blockedReason: string | undefined;

  private readonly now: () => number;
  private readonly metCriteria: Set<number>;
  private hadCriteria = false;

  constructor(init: GoalInit) {
    if (init.id.trim() === "") throw new Error("goal id is required");
    if (init.objective.trim() === "") throw new Error("goal objective is required");
    this.id = init.id;
    this.objective = init.objective;
    this.criteria = [];
    this.addCriteria(init.criteria);
    this.status = "active";
    this.attempts = 0;
    this.now = init.now ?? Date.now;
    this.startedAt = init.startedAt ?? this.now();
    this.budget = init.budget ?? {};
    this.evidence = [];
    this.blockedReason = undefined;
    this.metCriteria = new Set();
  }

  start(): this {
    this.status = "active";
    this.blockedReason = undefined;
    if (this.startedAt === 0) this.startedAt = this.now();
    this.attempts += 1;
    return this;
  }

  markMet(evidence?: string | GoalEvidenceInput): this {
    this.status = "met";
    this.blockedReason = undefined;
    for (let index = 0; index < this.criteria.length; index += 1) {
      this.metCriteria.add(index);
    }
    if (evidence !== undefined) this.addEvidence(evidence);
    return this;
  }

  markBlocked(reason?: string): this {
    this.status = "blocked";
    this.blockedReason = reason;
    return this;
  }

  pause(): this {
    if (this.status === "active") this.status = "paused";
    return this;
  }

  resume(): this {
    if (this.status === "paused") this.status = "active";
    return this;
  }

  addEvidence(evidence: string | GoalEvidenceInput): string {
    const input = typeof evidence === "string" ? { detail: evidence } : evidence;
    if (input.detail.trim() === "") throw new Error("goal evidence detail is required");
    if (
      input.criterion !== undefined &&
      (!Number.isInteger(input.criterion) ||
        input.criterion < 0 ||
        input.criterion >= this.criteria.length)
    ) {
      throw new Error(`goal criterion index out of range: ${input.criterion}`);
    }
    this.evidence.push(input.detail);
    if (input.criterion !== undefined) this.metCriteria.add(input.criterion);
    return input.detail;
  }

  replaceCriteria(criteria: readonly string[]): this {
    const next = checkCriteria(criteria);
    const met = new Set(this.criteria.filter((_, index) => this.metCriteria.has(index)));
    this.criteria.splice(0, this.criteria.length, ...next);
    this.metCriteria.clear();
    if (next.length > 0) this.hadCriteria = true;
    for (let index = 0; index < next.length; index += 1) {
      const criterion = next[index];
      if (criterion !== undefined && met.has(criterion)) this.metCriteria.add(index);
    }
    return this;
  }

  addCriteria(criteria: readonly string[]): this {
    for (const criterion of checkCriteria(criteria)) {
      if (!this.criteria.includes(criterion)) this.criteria.push(criterion);
    }
    if (this.criteria.length > 0) this.hadCriteria = true;
    return this;
  }

  applyTodos(todos: readonly GoalTodo[]): this {
    const remaining = todos
      .filter((todo) => todo.status === "pending" || todo.status === "in_progress")
      .map((todo) => todo.content)
      .filter((content) => content.trim() !== "");
    this.replaceCriteria(remaining);
    for (let index = 0; index < remaining.length; index += 1) this.metCriteria.delete(index);
    for (const todo of todos) {
      if (todo.status !== "completed" || todo.content.trim() === "") continue;
      const detail = `Completed todo: ${todo.content}`;
      if (!this.evidence.includes(detail)) this.addEvidence(detail);
    }
    return this;
  }

  hasCriteria(): boolean {
    return this.hadCriteria;
  }

  toStatus(): GoalSnapshot {
    return {
      objective: this.objective,
      status: this.status,
      remainingCriteria: this.remainingCriteria(),
      evidenceCount: this.evidence.length,
    };
  }

  remainingCriteria(): string[] {
    if (this.status === "met") return [];
    return this.criteria.filter((_, index) => !this.metCriteria.has(index));
  }

  elapsedMs(): number {
    if (this.startedAt === 0) return 0;
    return Math.max(0, this.now() - this.startedAt);
  }

  isBudgetExhausted(): boolean {
    if (this.budget.maxAttempts !== undefined && this.attempts >= this.budget.maxAttempts) {
      return true;
    }
    if (this.budget.maxDurationMs !== undefined && this.startedAt !== 0) {
      return this.elapsedMs() >= this.budget.maxDurationMs;
    }
    return false;
  }
}

export function shouldContinue(state: GoalState, lastResult?: GoalTurnResult): GoalDecision {
  if (state.status === "met") {
    return { action: "finish", reason: "goal is already met" };
  }
  if (state.status === "blocked") {
    return { action: "blocked", reason: state.blockedReason ?? "goal is blocked" };
  }
  if (state.status === "paused") {
    return { action: "ask", reason: "goal is paused and needs the user to resume it" };
  }
  if (lastResult?.complete === true) {
    const summary = lastResult.summary?.trim() ?? "";
    state.markMet(summary === "" ? undefined : summary);
    return { action: "finish", reason: "completion signal received" };
  }
  if (lastResult?.blocked === true) {
    return { action: "blocked", reason: lastResult.reason ?? "turn reported a blocker" };
  }
  if (lastResult?.requiresUser === true) {
    return { action: "ask", reason: lastResult.reason ?? "turn needs a user decision" };
  }
  if (state.isBudgetExhausted()) {
    state.markBlocked("goal budget is exhausted");
    return { action: "blocked", reason: "goal budget is exhausted" };
  }

  const remaining = state.remainingCriteria();
  if (remaining.length > 0) {
    return {
      action: "continue",
      reason: `${remaining.length} acceptance criteria remain`,
    };
  }
  if (state.hasCriteria()) {
    return { action: "finish", reason: "all acceptance criteria have evidence" };
  }
  return { action: "finish", reason: "goal has no acceptance criteria" };
}
