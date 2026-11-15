/** Apply model edits from a settings draft over newer saved metadata. */
export function mergeModelDraft<T extends object>(
  fresh: Record<string, T>,
  draft: Record<string, T>,
  baseline: Record<string, T>,
): Record<string, T> {
  const clone = <V>(value: V): V => JSON.parse(JSON.stringify(value)) as V;
  const merged = clone(fresh);
  for (const id of new Set([...Object.keys(draft), ...Object.keys(baseline)])) {
    const edited = draft[id];
    const saved = baseline[id];
    if (JSON.stringify(edited) === JSON.stringify(saved)) continue;
    if (!edited) {
      delete merged[id];
      continue;
    }
    if (!saved || !merged[id]) {
      merged[id] = clone(edited);
      continue;
    }
    const target = merged[id] as Record<string, unknown>;
    for (const key of new Set([...Object.keys(saved), ...Object.keys(edited)])) {
      const value = (edited as Record<string, unknown>)[key];
      if (JSON.stringify(value) === JSON.stringify((saved as Record<string, unknown>)[key]))
        continue;
      if (value === undefined) delete target[key];
      else target[key] = clone(value);
    }
  }
  return merged;
}
