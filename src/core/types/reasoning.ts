export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}

export function nearestReasoningEffort(
  requested: ReasoningEffort,
  supported: readonly ReasoningEffort[],
): ReasoningEffort | undefined {
  if (supported.length === 0) return undefined;
  if (supported.includes(requested)) return requested;
  const requestedIndex = REASONING_EFFORTS.indexOf(requested);
  let best = supported[0] as ReasoningEffort;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const effort of supported) {
    const index = REASONING_EFFORTS.indexOf(effort);
    const distance = Math.abs(index - requestedIndex);
    const bestIndex = REASONING_EFFORTS.indexOf(best);
    if (distance < bestDistance || (distance === bestDistance && index > bestIndex)) {
      best = effort;
      bestDistance = distance;
    }
  }
  return best;
}
