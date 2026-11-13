import { emptyUsage } from "../types/message";
import type { SubagentRegistry } from "./registry";
import { parseSubagentResult } from "./result";
import type {
  SubagentChildResult,
  SubagentRunOptions,
  SubagentRunResult,
  SubagentSpec,
  SubagentUsage,
} from "./types";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(
  message: string,
  summary = "",
  usage: SubagentUsage = emptyUsage(),
): SubagentRunResult {
  return { ok: false, summary, usage, error: message };
}

function budgetError(spec: SubagentSpec, child: SubagentChildResult): string | undefined {
  const usage = child.usage;
  const tokens = usage.input + usage.output;
  if (tokens > spec.budget.maxTokens) {
    return `Subagent "${spec.id}" exceeded its token budget: ${tokens} > ${spec.budget.maxTokens}.`;
  }
  const turns = child.turns ?? 0;
  if (turns > spec.budget.maxTurns) {
    return `Subagent "${spec.id}" exceeded its turn budget: ${turns} > ${spec.budget.maxTurns}.`;
  }
  if (
    spec.budget.maxCost !== undefined &&
    usage.cost !== undefined &&
    usage.cost > spec.budget.maxCost
  ) {
    return `Subagent "${spec.id}" exceeded its cost budget: ${usage.cost} > ${spec.budget.maxCost}.`;
  }
  return undefined;
}

function forbiddenTool(spec: SubagentSpec, child: SubagentChildResult): string | undefined {
  const denied = (child.toolCalls ?? []).find((call) => !spec.allowedTools.includes(call.name));
  if (denied === undefined) return undefined;
  const allowed = spec.allowedTools.length > 0 ? spec.allowedTools.join(", ") : "none";
  return `Subagent "${spec.id}" used a tool that is not allowed: ${denied.name}. Allowed tools: ${allowed}.`;
}

export class SubagentRunner {
  readonly #registry: SubagentRegistry;

  constructor(registry: SubagentRegistry) {
    this.#registry = registry;
  }

  async run(
    specId: string,
    prompt: string,
    options: SubagentRunOptions,
  ): Promise<SubagentRunResult> {
    const spec = this.#registry.get(specId);
    if (spec === undefined) {
      const known = this.#registry.list().map((item) => item.id);
      return failure(
        `Unknown subagent: ${specId}. Registered subagents: ${known.length > 0 ? known.join(", ") : "none"}.`,
      );
    }
    if (prompt.trim().length === 0) return failure("Subagent prompt is required.");

    const signal = options.signal ?? new AbortController().signal;
    if (signal.aborted) return failure(`Subagent "${spec.id}" was cancelled.`);

    let child: SubagentChildResult;
    try {
      child = await options.runChild({
        spec,
        systemPrompt: spec.systemPrompt,
        messages: [{ role: "user", content: prompt }],
        allowedTools: spec.allowedTools,
        permissions: spec.permissions,
        budget: spec.budget,
        signal,
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
        ...(options.parentContext === undefined ? {} : { parentContext: options.parentContext }),
      });
    } catch (error) {
      return failure(messageOf(error));
    }

    if (child.error !== undefined) {
      return { ok: false, summary: child.text, usage: child.usage, error: child.error };
    }
    if (signal.aborted) {
      return {
        ok: false,
        summary: child.text,
        usage: child.usage,
        error: `Subagent "${spec.id}" was cancelled.`,
      };
    }

    const budget = budgetError(spec, child);
    if (budget !== undefined) {
      return { ok: false, summary: child.text, usage: child.usage, error: budget };
    }

    const forbidden = forbiddenTool(spec, child);
    if (forbidden !== undefined) {
      return { ok: false, summary: child.text, usage: child.usage, error: forbidden };
    }

    const result = parseSubagentResult(spec, child.text);
    if (!result.ok) {
      return {
        ok: false,
        summary: child.text,
        usage: child.usage,
        error: result.error,
      };
    }

    return { ok: true, summary: child.text, data: result.data, usage: child.usage };
  }
}
