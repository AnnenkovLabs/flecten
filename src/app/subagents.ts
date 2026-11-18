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
      join(homedir(), ".flecten", "agents"),
      ...(trusted ? [join(cwd, ".flecten", "agents")] : []),
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
  const roles = runtime.registry.list().map((spec) => {
    const toolsField = spec.allowedTools?.length
      ? `, "allowedTools": ${JSON.stringify(spec.allowedTools)}`
      : "";
    return `- {"id": ${JSON.stringify(spec.id)}, "description": ${JSON.stringify(spec.description)}${toolsField}}`;
  });
  const marker = "\n\nAvailable subagents:\n";
  const end = task.description.indexOf(marker);
  task.description = `${end < 0 ? task.description : task.description.slice(0, end)}${marker}${roles.join("\n")}`;
}
