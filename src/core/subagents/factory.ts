import type { SubagentRunnerFactory } from "../../tools/task/run";
import type { ToolContext } from "../../tools/types";
import { builtinSubagentSpecs } from "./builtin";
import { loadSubagentDefinitions } from "./definitions";
import { mergeSubagentSpecs, SubagentRegistry } from "./registry";
import { SubagentRunner } from "./runner";
import type { SubagentChildRunner, SubagentSpec } from "./types";

export interface SubagentToolRegistry {
  list(): readonly { name: string }[];
  authorize?(name: string, context: ToolContext): string | undefined;
}

export interface CreateSubagentRuntimeOptions {
  specs?: readonly SubagentSpec[];
  definitions?: readonly SubagentSpec[];
  directories?: readonly string[];
  runChild: SubagentChildRunner;
  toolRegistry?: SubagentToolRegistry;
}

export interface SubagentRuntime {
  registry: SubagentRegistry;
  runner: SubagentRunner;
  factory: SubagentRunnerFactory;
}

function validateAllowedTools(
  specs: readonly SubagentSpec[],
  toolRegistry: SubagentToolRegistry | undefined,
): void {
  const known = toolRegistry ? new Set(toolRegistry.list().map((tool) => tool.name)) : undefined;
  for (const spec of specs) {
    const seen = new Set<string>();
    for (const name of spec.allowedTools) {
      if (seen.has(name)) {
        throw new Error(`subagent "${spec.id}" lists tool "${name}" more than once.`);
      }
      seen.add(name);
      if (known !== undefined && !known.has(name)) {
        const available = known.size > 0 ? [...known].join(", ") : "none";
        throw new Error(
          `subagent "${spec.id}" allows unknown tool "${name}". Available tools: ${available}.`,
        );
      }
    }
  }
}

export function createSubagentRuntime(options: CreateSubagentRuntimeOptions): SubagentRuntime {
  const base = options.specs ?? builtinSubagentSpecs;
  const definitions = [
    ...(options.definitions ?? []),
    ...(options.directories === undefined ? [] : loadSubagentDefinitions(options.directories)),
  ];
  const specs = mergeSubagentSpecs(base, definitions);
  validateAllowedTools(specs, options.toolRegistry);
  const registry = new SubagentRegistry(specs);
  const runner = new SubagentRunner(registry);
  const factory: SubagentRunnerFactory = (context) => ({
    runner,
    runChild: (request) =>
      options.runChild({
        ...request,
        ...(context.permissions ? { parentPermissions: context.permissions } : {}),
        ...(context.permissionIntent ? { permissionIntent: context.permissionIntent } : {}),
        ...(context.approvals
          ? {
              parentApprovals: context.approvals,
              approvalSessionId: context.approvalSessionId ?? context.sessionId,
            }
          : {}),
        parentAuthorize: (name) => options.toolRegistry?.authorize?.(name, context),
      }),
    signal: context.signal,
  });
  return { registry, runner, factory };
}
