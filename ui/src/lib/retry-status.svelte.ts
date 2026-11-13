/** The request that is waiting for its retry; LiveRun turns `until` into a countdown. */
export const retryStatus = $state<{ until: number; kind: string }>({ until: 0, kind: "" });

export function setRetry(until: number, kind: string): void {
  retryStatus.until = until;
  retryStatus.kind = kind;
}

export function clearRetry(): void {
  if (retryStatus.until !== 0) retryStatus.until = 0;
}
