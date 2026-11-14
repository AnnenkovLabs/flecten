import { PROFILE_4, type TokenProfile } from "./types";

export type ToolOutputClass = "read" | "search" | "log" | "bash" | "default";

export interface ToolOutputBudgetInput {
  readonly contextWindow: number;
  readonly reserveTokens: number;
  readonly usedTokens: number;
  readonly pendingCalls?: number;
  readonly profile?: TokenProfile;
}

export interface ToolOutputBudget {
  readonly class: ToolOutputClass;
  readonly tokens: number;
  readonly chars: number;
  readonly remainingTokens: number;
}

interface ClassRule {
  readonly share: number;
  readonly min: number;
  readonly max: number;
}

const CLASS_RULES: Record<ToolOutputClass, ClassRule> = {
  read: { share: 0.25, min: 512, max: 24_000 },
  search: { share: 0.15, min: 256, max: 12_000 },
  log: { share: 0.1, min: 192, max: 8_000 },
  bash: { share: 0.1, min: 192, max: 8_000 },
  default: { share: 0.08, min: 128, max: 4_000 },
};

const READ_TOOLS = new Set(["read"]);
const SEARCH_TOOLS = new Set(["grep", "glob", "web_search"]);
const LOG_TOOLS = new Set(["terminal", "web", "web_fetch"]);
const BASH_TOOLS = new Set(["bash"]);

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function toolOutputClass(name: string): ToolOutputClass {
  const canonical = name.toLowerCase();
  if (READ_TOOLS.has(canonical)) return "read";
  if (SEARCH_TOOLS.has(canonical)) return "search";
  if (BASH_TOOLS.has(canonical)) return "bash";
  if (LOG_TOOLS.has(canonical)) return "log";
  return "default";
}

export function toolOutputBudget(
  input: ToolOutputBudgetInput,
  toolClass: ToolOutputClass,
): ToolOutputBudget {
  const profile = input.profile ?? PROFILE_4;
  const window = Math.max(0, finite(input.contextWindow, 0));
  const reserve = Math.max(0, finite(input.reserveTokens, 0));
  const used = Math.max(0, finite(input.usedTokens, 0));
  const pending = Math.max(1, Math.floor(finite(input.pendingCalls ?? 1, 1)));
  const remaining = Math.max(0, window - reserve - used);
  const rule = CLASS_RULES[toolClass];

  if (remaining === 0) {
    return { class: toolClass, tokens: 0, chars: 0, remainingTokens: 0 };
  }

  const share = Math.floor((remaining * rule.share) / pending);
  const tokens = Math.min(remaining, Math.min(rule.max, Math.max(rule.min, share)));
  return {
    class: toolClass,
    tokens,
    chars: Math.floor(tokens * profile.charsPerToken),
    remainingTokens: remaining,
  };
}
