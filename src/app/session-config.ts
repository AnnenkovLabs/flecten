import {
  BudgetsConfigSchema,
  CheckpointsConfigSchema,
  type HarnessConfig,
  PermissionsConfigSchema,
  TerminalConfigSchema,
} from "../config/schema";
import type { PromptTextPart } from "../context/prompt-budget";
import {
  buildPrompt,
  configuredBudget,
  type PromptSection,
  type PromptStamp,
  promptStamp,
} from "../core/prompt";
import type { BudgetLimits, UsagePrice } from "../core/session/budget";
import type { Usage } from "../core/types";
import type { TerminalSettingsInput } from "../terminal/settings";
import type { ToolRegistry } from "../tools/registry";
import { costOf, modelOf } from "./provider-state";

/** Terminal settings from the config: shell, env, scrollback, timeouts, ANSI, notifications, limits. */
export function terminalSettings(config: HarnessConfig): TerminalSettingsInput {
  const terminal = config.terminal ?? TerminalConfigSchema.unwrap().parse({});
  return {
    ...(terminal.shell ? { shell: terminal.shell } : {}),
    ...(terminal.envAllowlist ? { envAllowlist: terminal.envAllowlist } : {}),
    scrollback: terminal.scrollback,
    timeouts: {
      commandMs: terminal.commandTimeoutMs,
      jobWaitMs: terminal.jobWaitMs,
      ...(terminal.jobTimeoutMs ? { jobMs: terminal.jobTimeoutMs } : {}),
    },
    ansi: terminal.ansi,
    notifications: terminal.notifyOnExit,
    limits: {
      maxProcesses: terminal.maxProcesses,
      maxMemoryBytes: terminal.maxMemoryMb * 1024 * 1024,
      ...(terminal.ports === undefined ? {} : { ports: terminal.ports }),
    },
  };
}

export function runBudgets(config: HarnessConfig): BudgetLimits {
  const budgets = config.budgets ?? BudgetsConfigSchema.unwrap().parse({});
  return {
    ...(budgets.maxTokens === undefined ? {} : { maxTokens: budgets.maxTokens }),
    ...(budgets.maxCostUsd === undefined ? {} : { maxCostUsd: budgets.maxCostUsd }),
    ...(budgets.maxWallClockMs === undefined ? {} : { maxWallClockMs: budgets.maxWallClockMs }),
  };
}

/** Price of a usage with the active model and variant; undefined when the model has no price. */
export function usagePrice(config: HarnessConfig): UsagePrice {
  const model = modelOf(config);
  const variant = config.variant;
  return (usage: Usage) => costOf(usage, model, variant);
}

export function approvalTimeout(config: HarnessConfig): number {
  return (config.permissions ?? PermissionsConfigSchema.parse({})).approvalTimeoutMs;
}

export function destructivePolicy(config: HarnessConfig) {
  return (config.permissions ?? PermissionsConfigSchema.parse({})).destructive;
}

export function checkpointSettings(config: HarnessConfig) {
  return config.checkpoints ?? CheckpointsConfigSchema.unwrap().parse({});
}

export interface SystemPrompt {
  system: string;
  systemParts: readonly PromptTextPart[];
  stamp: PromptStamp;
}

/**
 * The system prompt with its version, hash and budget. Base, AGENTS.md, skills, MCP
 * instructions and tool schemas share one limit, so they never fill the window before
 * the first request: optional sections are trimmed first.
 */
export async function systemPrompt(
  cwd: string,
  config: HarnessConfig,
  sections: readonly PromptSection[],
  tools: ToolRegistry,
  role?: "talker" | "worker",
): Promise<SystemPrompt> {
  const maxPromptTokens = config.context.promptBudget ?? configuredBudget();
  const built = await buildPrompt(cwd, {
    sections,
    tools: tools.specs(),
    maxPromptTokens,
    ...(role ? { role } : {}),
  });
  return {
    system: built.system,
    systemParts: built.systemParts,
    stamp: promptStamp(built, maxPromptTokens),
  };
}
