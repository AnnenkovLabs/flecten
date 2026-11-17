/** Drain every in-flight operation before releasing the migration's root lock on failure. */
export async function forEachConcurrent<T>(
  items: readonly T[],
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failed = false;
  const workers = Array.from({ length: Math.min(16, items.length) }, async () => {
    while (!failed) {
      const index = next++;
      if (index >= items.length) return;
      try {
        await task(items[index] as T);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  });
  const results = await Promise.allSettled(workers);
  for (const result of results) if (result.status === "rejected") throw result.reason;
}
