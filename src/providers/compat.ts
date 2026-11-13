import type { ModelConfig } from "../config/schema";
import { nearestReasoningEffort, type ReasoningEffort } from "../core/types";
import { familyFirstVersion, type ModelVersion, versionFirstVersion } from "./model-family";

const DEFAULT_LEVELS: ReasoningEffort[] = ["low", "medium", "high"];

const BUDGETS: Record<ReasoningEffort, number> = {
  none: 0,
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
  max: 64000,
};

export function modelConfig(
  runtime: { modelConfig(id: string): ModelConfig | undefined },
  model: string,
): ModelConfig | undefined {
  return runtime.modelConfig(model);
}

export function apiModel(request: { model: string; apiModel?: string }): string {
  return request.apiModel ?? request.model;
}

export function variantOf(
  model: ModelConfig | undefined,
  request: { variant?: string },
): ModelConfig["variants"] extends Record<string, infer V> | undefined ? V | undefined : never {
  return request.variant ? model?.variants?.[request.variant] : undefined;
}

export function requestHeaders(
  runtime: { headers: Record<string, string> },
  model: ModelConfig | undefined,
  request: { variant?: string },
): Record<string, string> {
  const variant = variantOf(model, request);
  return { ...runtime.headers, ...model?.headers, ...variant?.headers };
}

export function requestExtra(
  runtime: { config: { extraBody?: Record<string, unknown> | undefined } },
  model: ModelConfig | undefined,
  request: { variant?: string },
): Record<string, unknown> {
  const variant = variantOf(model, request);
  return { ...runtime.config.extraBody, ...model?.extraBody, ...variant?.body };
}

export function effectiveParallelTools(
  runtime: { config: { parallelToolCalls?: boolean | undefined } },
  model: ModelConfig | undefined,
): boolean | undefined {
  return model?.parallelToolCalls ?? runtime.config.parallelToolCalls;
}

export function promptCacheEnabled(
  runtime: { config: { promptCaching: boolean } },
  model: ModelConfig | undefined,
): boolean {
  const caching = model?.compat?.promptCaching ?? runtime.config.promptCaching;
  return caching && model?.promptCache !== false;
}

export function modelHeaders(
  model: ModelConfig | undefined,
  variant: { headers?: Record<string, string> } | undefined,
  base: Record<string, string> = {},
): Record<string, string> {
  return { ...base, ...model?.headers, ...variant?.headers };
}

export function reasoningLevels(model: ModelConfig | undefined): ReasoningEffort[] {
  if (model?.reasoning === false) return [];
  if (model?.reasoningLevels && model.reasoningLevels.length > 0) return model.reasoningLevels;
  return DEFAULT_LEVELS;
}

export function supportsReasoning(model: ModelConfig | undefined): boolean {
  return model?.reasoning !== false;
}

export function reasoningMode(model: ModelConfig | undefined): ModelConfig["reasoningMode"] {
  return model?.reasoningMode ?? "effort";
}

export function normalizeEffort(
  requested: ReasoningEffort,
  model: ModelConfig | undefined,
): ReasoningEffort {
  return nearestReasoningEffort(requested, reasoningLevels(model)) ?? requested;
}

export function isOpenRouter(runtime: { providerId: string; baseUrl: string }): boolean {
  return runtime.providerId === "openrouter" || runtime.baseUrl.includes("openrouter.ai");
}

export function replayMode(
  runtime: {
    providerId: string;
    baseUrl: string;
    config: { reasoningReplay: "auto" | "always" | "never" | "alias" };
  },
  model?: ModelConfig,
): "always" | "never" | "alias" {
  const configured = model?.compat?.reasoningReplay ?? runtime.config.reasoningReplay;
  if (configured !== "auto") return configured;
  if (runtime.providerId === "groq" || runtime.providerId === "cerebras") return "alias";
  return "always";
}

export function emptyReasoningValue(runtime: {
  providerId: string;
  baseUrl: string;
}): string | undefined {
  if (runtime.providerId === "deepseek" || runtime.baseUrl.includes("deepseek")) return "";
  if (runtime.providerId === "moonshotai" || runtime.baseUrl.includes("moonshot")) return " ";
  return undefined;
}

export function thinkingParam(runtime: {
  providerId: string;
  baseUrl: string;
  config: { thinkingParam: "auto" | "thinking" | "enable_thinking" | "none" };
}): "thinking" | "enable_thinking" | "none" {
  if (runtime.config.thinkingParam !== "auto") return runtime.config.thinkingParam;
  if (
    runtime.providerId === "deepseek" ||
    runtime.providerId === "moonshotai" ||
    runtime.providerId === "zai"
  ) {
    return "thinking";
  }
  if (runtime.providerId === "alibaba") return "enable_thinking";
  return "none";
}

export function openAiThinking(
  runtime: {
    providerId: string;
    baseUrl: string;
    config: {
      thinking: "auto" | "enabled" | "disabled";
      thinkingParam: "auto" | "thinking" | "enable_thinking" | "none";
      thinkingKeep: "auto" | "all" | "none";
      clearThinking: "auto" | "keep" | "clear";
      preserveThinking: "auto" | "on" | "off";
    };
  },
  effort: ReasoningEffort | undefined,
  model?: ModelConfig,
): Record<string, unknown> {
  if (model?.reasoning === false) return {};
  const param = model?.compat?.thinkingParam ?? thinkingParam(runtime);
  const thinkingMode = model?.compat?.thinking ?? runtime.config.thinking;
  const requested = effort ?? (thinkingMode === "enabled" ? "medium" : undefined);
  const disabled = thinkingMode === "disabled" || requested === "none";

  if (param === "enable_thinking") {
    const preserveMode = model?.compat?.preserveThinking ?? runtime.config.preserveThinking;
    const preserve =
      preserveMode === "on" || (preserveMode === "auto" && runtime.providerId === "alibaba");
    return {
      enable_thinking: !disabled,
      ...(preserve && !disabled ? { preserve_thinking: true } : {}),
    };
  }

  if (param === "thinking") {
    const payload: Record<string, unknown> = { type: disabled ? "disabled" : "enabled" };
    const keepMode = model?.compat?.thinkingKeep ?? runtime.config.thinkingKeep;
    const keep = keepMode === "all" || (keepMode === "auto" && runtime.providerId === "moonshotai");
    if (keep && !disabled) payload.keep = "all";
    const clear = model?.compat?.clearThinking ?? runtime.config.clearThinking;
    if (!disabled && (clear === "keep" || (clear === "auto" && runtime.providerId === "zai"))) {
      payload.clear_thinking = false;
    }
    return { thinking: payload };
  }

  return {};
}

export function effortField(
  runtime: {
    providerId: string;
    baseUrl: string;
    config: { reasoningReplay: "auto" | "always" | "never" | "alias" };
  },
  modelId: string,
  model: ModelConfig | undefined,
  effort: ReasoningEffort | undefined,
): Record<string, unknown> {
  if (!effort || effort === "none") return {};
  if (model?.reasoning === false) return {};
  if (reasoningMode(model) !== "effort") return {};
  const fixedThinking = ["kimi-k2.6", "kimi-k2.7"].some((name) => modelId.includes(name));
  if (runtime.providerId === "moonshotai" && fixedThinking) return {};
  return { reasoning_effort: normalizeEffort(effort, model) };
}

export function budgetFor(effort: ReasoningEffort, maxTokens: number): number {
  const target = BUDGETS[effort] ?? BUDGETS.medium;
  if (target === 0) return 0;
  if (maxTokens <= 1024) return 0;
  return Math.max(1024, Math.min(target, maxTokens - 1024));
}

/** Claude 4.6 and later think adaptively; a date-like minor such as 20250514 counts as 0. */
function isAdaptiveVersion(version: ModelVersion): boolean {
  const minor = (version.minor ?? 0) > 99 ? 0 : (version.minor ?? 0);
  return version.major > 4 || (version.major === 4 && minor >= 6);
}

export function isAdaptiveAnthropic(modelId: string, model: ModelConfig | undefined): boolean {
  if (model?.reasoningMode === "budget") return false;
  if (model?.reasoningMode === "effort") return true;
  const familyFirst = familyFirstVersion(modelId);
  if (familyFirst && familyFirst.major >= 3 && familyFirst.major <= 10) {
    return isAdaptiveVersion(familyFirst);
  }
  const versionFirst = versionFirstVersion(modelId);
  if (versionFirst && versionFirst.major >= 3) return isAdaptiveVersion(versionFirst);
  return false;
}

export function geminiThinking(
  modelId: string,
  model: ModelConfig | undefined,
  effort: ReasoningEffort | undefined,
): Record<string, unknown> {
  if (!effort || model?.reasoning === false) return {};
  const legacyBudget = modelId.toLowerCase().includes("gemini-2.5");
  const mode = model?.reasoningMode ?? (legacyBudget ? "budget" : "effort");
  if (mode === "budget") {
    return {
      thinkingConfig: {
        includeThoughts: effort !== "none",
        thinkingBudget: effort === "none" ? 0 : budgetFor(effort, 32768),
      },
    };
  }
  const level = effort === "none" ? "minimal" : normalizeEffort(effort, model);
  return { thinkingConfig: { includeThoughts: effort !== "none", thinkingLevel: level } };
}
