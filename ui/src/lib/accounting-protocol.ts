import type { AgentBudget } from "./agent-types";

export type AccountingEvent =
  | { type: "budget"; sessionId: string; budget: AgentBudget }
  | { type: "task.budget"; sessionId: string; budget: AgentBudget }
  | {
      type: "usage.unavailable";
      sessionId: string;
      purpose?: "translation" | "vision" | "compaction";
      provider?: string;
      model?: string;
    };
