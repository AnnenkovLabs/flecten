import type { ReasoningChoice } from "./types";

/** Small run-store helpers: stable item ids and the remembered reasoning choice. */

const REASONING_KEY = "liquid.reasoning";
const REASONING_VALUES = new Set([
  "auto",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export function storedReasoning(): ReasoningChoice {
  if (typeof localStorage === "undefined") return "auto";
  const value = localStorage.getItem(REASONING_KEY);
  return value && REASONING_VALUES.has(value) ? (value as ReasoningChoice) : "auto";
}

export function hasStoredReasoning(): boolean {
  if (typeof localStorage === "undefined") return false;
  const value = localStorage.getItem(REASONING_KEY);
  return value !== null && REASONING_VALUES.has(value);
}

let sequence = 0;

export function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

/** An id the core accepts and no other window or restart repeats: session, queue, run. */
export function uniqueId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function storeReasoning(value: ReasoningChoice): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(REASONING_KEY, value);
}
