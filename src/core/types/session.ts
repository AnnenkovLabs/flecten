import type { SessionId } from "./ids";
import type { Usage } from "./message";

export type RunStopReason = "done" | "end" | "stopped" | "error" | "max_turns" | "budget";

export type BudgetKind = "tokens" | "cost" | "wall_clock";

export interface BudgetAmounts {
  tokens?: number;
  costUsd?: number;
  wallClockMs?: number;
}

/** Limits of one run, what it spent and what is left; `exceeded` names the limit that stopped it. */
export interface BudgetView {
  limits: BudgetAmounts;
  spent: { tokens: number; costUsd?: number; wallClockMs: number };
  remaining: BudgetAmounts;
  exceeded?: BudgetKind;
}

export interface RunResult {
  sessionId: SessionId;
  pass: boolean;
  stopReason: RunStopReason;
  summary: string;
  turns: number;
  usage: Usage;
  budget?: BudgetView;
}
