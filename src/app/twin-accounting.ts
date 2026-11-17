import type { TwinSnapshot } from "../../shared/twin";
import type { RunBudget } from "../core/session/budget";

/** Preserve per-route pricing and absent attempts during live accounting and journal replay. */
export function accountTwinUsage(
  budget: RunBudget | undefined,
  usage: TwinSnapshot["training"]["usage"],
): void {
  if (!budget) return;
  for (const charge of usage.charges ?? [usage]) budget.add(charge, () => charge.costUsd);
  const missing =
    usage.missingRequests ??
    Number(
      usage.input + usage.output === 0 && usage.costUsd === undefined && usage.requested !== false,
    );
  for (let index = 0; index < missing; index++) budget.unavailable();
}
