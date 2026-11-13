// Model descriptions returned by provider APIs (OpenAI, Anthropic, Gemini), read into ModelConfig.
import type { ModelConfig } from "../config/schema";
import { isReasoningEffort, type ReasoningEffort } from "../core/types";
import { isDigits, withoutPrefix } from "../util/text";
import { formatModelName, isChatModel } from "./catalog";

export function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function number(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string" && isDigits(value)) return Number(value);
  }
  return undefined;
}

function boolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

interface ReasoningFields {
  reasoning?: boolean;
  reasoningMode?: ModelConfig["reasoningMode"];
  reasoningLevels?: ReasoningEffort[];
  reasoningBudget?: number;
  reasoningToggle?: boolean;
}

function reasoningOptions(model: Record<string, unknown>): ReasoningFields {
  const raw = Array.isArray(model.reasoning_options) ? model.reasoning_options : [];
  const efforts = raw
    .map((entry) => object(entry))
    .find((entry) => entry?.type === "effort")?.values;
  const levels = stringList(efforts).filter(isReasoningEffort) as ReasoningEffort[];
  const budget = raw.map((entry) => object(entry)).find((entry) => entry?.type === "budget_tokens");
  const toggle = raw.some((entry) => object(entry)?.type === "toggle");
  const mode = levels.length > 0 ? "effort" : budget ? "budget" : toggle ? "toggle" : undefined;
  return {
    ...(mode === undefined ? {} : { reasoningMode: mode }),
    ...(levels.length === 0 ? {} : { reasoningLevels: levels }),
    ...(typeof budget?.min === "number" ? { reasoningBudget: budget.min } : {}),
    ...(toggle ? { reasoningToggle: true } : {}),
  };
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function costFromApi(raw: Record<string, unknown>): ModelConfig["cost"] | undefined {
  const cost = object(raw.cost);
  const pricing = object(raw.pricing);
  if (!cost && !pricing) return undefined;
  if (cost) {
    const input = numeric(cost.input);
    const output = numeric(cost.output);
    if (input === undefined || output === undefined) return undefined;
    return {
      input,
      output,
      ...(numeric(cost.cache_read ?? cost.cacheRead) === undefined
        ? {}
        : { cacheRead: numeric(cost.cache_read ?? cost.cacheRead) }),
      ...(numeric(cost.cache_write ?? cost.cacheWrite) === undefined
        ? {}
        : { cacheWrite: numeric(cost.cache_write ?? cost.cacheWrite) }),
    };
  }
  const toMillion = (value: unknown): number | undefined => {
    const parsed = numeric(value);
    if (parsed === undefined) return undefined;
    return parsed > 0 && parsed < 0.001 ? parsed * 1e6 : parsed;
  };
  const input = toMillion(pricing?.prompt ?? pricing?.input);
  const output = toMillion(pricing?.completion ?? pricing?.output);
  if (input === undefined || output === undefined) return undefined;
  return {
    input,
    output,
    ...(toMillion(pricing?.input_cache_read ?? pricing?.cache_read) === undefined
      ? {}
      : { cacheRead: toMillion(pricing?.input_cache_read ?? pricing?.cache_read) }),
    ...(toMillion(pricing?.input_cache_write ?? pricing?.cache_write) === undefined
      ? {}
      : { cacheWrite: toMillion(pricing?.input_cache_write ?? pricing?.cache_write) }),
  };
}

export function openAiModel(raw: Record<string, unknown>): ModelConfig | undefined {
  const id =
    typeof raw.id === "string" ? raw.id : typeof raw.name === "string" ? raw.name : undefined;
  if (!id) return undefined;
  const capabilities = object(raw.capabilities);
  const limit = object(raw.limit);
  const topProvider = object(raw.top_provider);
  const architecture = object(raw.architecture);
  const modalities = object(raw.modalities);
  const features = object(raw.features);
  const inputs = [...stringList(architecture?.input_modalities), ...stringList(modalities?.input)];
  const outputs = [
    ...stringList(architecture?.output_modalities),
    ...stringList(modalities?.output),
  ];
  if (!isChatModel(id, outputs)) return undefined;
  const context = number(
    raw.context_length,
    raw.max_context_length,
    raw.context_window,
    limit?.context,
    topProvider?.context_length,
  );
  const input = number(raw.max_input_tokens, limit?.input, topProvider?.max_input_tokens);
  const output = number(
    raw.max_output_tokens,
    raw.max_completion_tokens,
    limit?.output,
    topProvider?.max_completion_tokens,
  );
  const tools = boolean(
    capabilities?.function_calling,
    capabilities?.tools,
    raw.tool_call,
    raw.supports_tools,
    features?.tool_call,
  );
  const reasoning = boolean(
    capabilities?.reasoning,
    raw.reasoning,
    raw.supports_reasoning,
    features?.reasoning,
  );
  const structuredOutput = boolean(
    capabilities?.structured_output,
    raw.structured_output,
    features?.structured_output,
  );
  const cost = costFromApi(raw);
  const name =
    (typeof raw.name === "string" && raw.name !== id ? raw.name : undefined) ??
    (typeof raw.display_name === "string" ? raw.display_name : undefined) ??
    formatModelName(id);
  return {
    name,
    ...(context === undefined ? {} : { context }),
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(tools === undefined ? {} : { tools }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(structuredOutput === undefined ? {} : { structuredOutput }),
    ...reasoningOptions(raw),
    ...(inputs.includes("image") || inputs.includes("vision") ? { vision: true } : {}),
    ...(cost ? { cost } : {}),
    ...(typeof raw.knowledge === "string" ? { knowledge: raw.knowledge } : {}),
    ...(typeof raw.release_date === "string" ? { releaseDate: raw.release_date } : {}),
    ...(boolean(raw.open_weights) === undefined ? {} : { openWeights: boolean(raw.open_weights) }),
    ...(boolean(raw.attachment) === undefined ? {} : { attachment: boolean(raw.attachment) }),
    ...(typeof raw.canonical_model_id === "string" ? { canonicalId: raw.canonical_model_id } : {}),
    ...(inputs.length > 0 || outputs.length > 0
      ? {
          modalities: {
            ...(inputs.length > 0 ? { input: inputs } : {}),
            ...(outputs.length > 0 ? { output: outputs } : {}),
          },
        }
      : {}),
    source: "api",
  };
}

export function anthropicModel(raw: Record<string, unknown>): ModelConfig | undefined {
  const id = typeof raw.id === "string" ? raw.id : undefined;
  if (!id) return undefined;
  const name =
    typeof raw.display_name === "string" && raw.display_name.length > 0
      ? raw.display_name
      : formatModelName(id);
  return { name, source: "api" };
}

// ponytail: the Gemini list has no thinking flag; these families are known to think.
function thinksByName(name: string): boolean {
  const lower = name.toLowerCase();
  return ["thinking", "gemini-2.5", "gemini-3"].some((marker) => lower.includes(marker));
}

export function geminiModel(raw: Record<string, unknown>): ModelConfig | undefined {
  const name = typeof raw.name === "string" ? withoutPrefix(raw.name, "models/") : undefined;
  if (!name) return undefined;
  const methods = stringList(raw.supportedGenerationMethods);
  if (methods.length > 0 && !methods.includes("generateContent")) return undefined;
  if (!isChatModel(name)) return undefined;
  return {
    name:
      typeof raw.displayName === "string" && raw.displayName.length > 0
        ? raw.displayName
        : formatModelName(name),
    ...(number(raw.inputTokenLimit) === undefined ? {} : { context: number(raw.inputTokenLimit) }),
    ...(number(raw.outputTokenLimit) === undefined ? {} : { output: number(raw.outputTokenLimit) }),
    ...(methods.includes("generateContent") ? { tools: true } : {}),
    ...(thinksByName(name) ? { reasoning: true } : {}),
    source: "api",
  };
}
