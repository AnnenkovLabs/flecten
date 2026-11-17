export type ContextSource = "estimate" | "provider";
export interface ContextUsage {
  used: number;
  window: number;
  reserve: number;
  source: ContextSource;
}
