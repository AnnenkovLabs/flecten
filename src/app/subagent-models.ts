import type { ModelChoice } from "../../shared/model-choice";
import type { HarnessConfig } from "../config/schema";
import type { SubagentSpec } from "../core/subagents/types";
import type { SubagentRunnerFactory } from "../tools/task/run";
import { withModelChoice } from "./session-models";

/** Saved type settings win over definition choices, then the invoking session is inherited. */
export function subagentModelConfig(
  config: HarnessConfig,
  spec: SubagentSpec,
  inherited?: ModelChoice,
): HarnessConfig {
  const parent = inherited ? withModelChoice(config, inherited) : config;
  const selected = config.subagents?.models?.[spec.id];
  if (selected) return withModelChoice(config, selected);
  if (!spec.provider && !spec.model) return parent;
  return withModelChoice(parent, {
    provider: spec.provider ?? parent.provider,
    model: spec.model ?? parent.model,
  });
}

/** Capture the invoking role without putting model identity into model-controlled tool input. */
export function subagentModelFactory(
  factory: SubagentRunnerFactory,
  config: HarnessConfig,
): SubagentRunnerFactory;
export function subagentModelFactory(
  factory: SubagentRunnerFactory | undefined,
  config: HarnessConfig,
): SubagentRunnerFactory | undefined {
  if (!factory) return;
  const parentModel = {
    provider: config.provider,
    model: config.model,
    ...(config.reasoning ? { reasoning: config.reasoning } : {}),
    ...(config.variant ? { variant: config.variant } : {}),
  };
  return (context) => {
    const invocation = factory(context);
    return {
      ...invocation,
      runChild: (request) =>
        invocation.runChild({
          ...request,
          ...(context.taskBudget ? { taskBudget: context.taskBudget } : {}),
          parentModel: request.parentModel ?? parentModel,
        }),
    };
  };
}
