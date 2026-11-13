import type { CriterionId } from "./ids";

export interface Criterion {
  id: CriterionId;
  text: string;
  evidence?: string | undefined;
}

export interface SourceRules {
  min: number;
  independence: "normal" | "strict";
  maxAgeDays?: number | undefined;
}

export interface Spec {
  goal: string;
  nonGoals: string[];
  criteria: Criterion[];
  voice: string;
  gates: string[];
  questions: string[];
  sources?: SourceRules | undefined;
}
