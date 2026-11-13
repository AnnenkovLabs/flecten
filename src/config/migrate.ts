import { isObject } from "../util/json";

/** Upgrade shipped defaults; keep deliberate limits and all unrelated settings. */
export function migrateConfig(input: unknown): unknown {
  if (!isObject(input)) return input;
  const version = input.schemaVersion ?? 1;
  if (version !== 1 && version !== 2 && version !== 3) return input;
  // Retired plugins must neither execute nor prevent an existing project from opening.
  const next: Record<string, unknown> = { ...input };
  delete next.plugins;
  if (version === 3) return next;
  next.schemaVersion = 3;
  const context = input.context;
  if (version === 1 && isObject(context) && context.promptBudget === 8_000) {
    next.context = { ...context, promptBudget: 24_000 };
  }
  if (input.maxOutputTokens === 16_384) next.maxOutputTokens = 0;
  if (isObject(input.loop)) {
    const loop = { ...input.loop };
    if (loop.maxTurns === 100) loop.maxTurns = 0;
    if (loop.continuations === 2) loop.continuations = 8;
    next.loop = loop;
  }
  return next;
}
