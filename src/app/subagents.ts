import { homedir } from "node:os";
import { join } from "node:path";
import { createSubagentRuntime } from "../core/subagents/factory";
import type { SubagentChildRunner } from "../core/subagents/types";
import type { ToolRegistry } from "../tools/registry";

export function appSubagents(
  cwd: string,
  trusted: boolean,
  tools: ToolRegistry,
  runChild: SubagentChildRunner,
  extra: readonly string[] = [],
) {
  return createSubagentRuntime({
    toolRegistry: tools,
    runChild,
    directories: [
      ...extra,
      join(homedir(), ".liquid", "agents"),
      ...(trusted ? [join(cwd, ".liquid", "agents")] : []),
    ],
  });
}

/** Tool metadata carries the current role catalog and normal JSON result schema. */
export function subagentToolCatalog(
  tools: ToolRegistry,
  runtime: ReturnType<typeof appSubagents>,
): void {
  const task = tools.get("task");
  if (!task) return;
  const roles = runtime.registry.list().map((spec) => ({
    id: spec.id,
    description: spec.description,
    model: spec.model,
    provider: spec.provider,
    allowedTools: spec.allowedTools,
    budget: spec.budget,
  }));
  const marker = "\n\nAvailable subagents:\n";
  const end = task.description.indexOf(marker);
  task.description = `${end < 0 ? task.description : task.description.slice(0, end)}${marker}${JSON.stringify(roles, null, 2)}`;
}
