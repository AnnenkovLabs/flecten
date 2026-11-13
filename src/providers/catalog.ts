import { stat } from "node:fs/promises";
import { z } from "zod";
import {
  type ModelConfig,
  ModelConfigSchema,
  type Protocol,
  type ProviderConfig,
  ProviderConfigSchema,
} from "../config/schema";
import { isReasoningEffort, type ReasoningEffort } from "../core/types";
import { formatModelName } from "../util/model-name";
import { alphanumericLower, isIPv4, trimTrailingSlashes, withoutPrefix } from "../util/text";
import { loadAgentOne } from "./agent-one";
import {
  CACHE_TTL_MS,
  CatalogError,
  type CatalogLoadOptions,
  cachePath,
  catalogLastError,
  loadSource,
  type SourceSpec,
} from "./catalog-source";

export { formatModelName } from "../util/model-name";
export { loadAgentOne } from "./agent-one";
export {
  CatalogError,
  type CatalogLoadOptions,
  catalogLastError,
  resetCatalogCache,
} from "./catalog-source";

const MODELS_DEV_URL = "https://models.dev/api.json";

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com/v1beta",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com",
  moonshotai: "https://api.moonshot.ai/v1",
  zai: "https://api.z.ai/api/paas/v4",
  alibaba: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  groq: "https://api.groq.com/openai/v1",
  cerebras: "https://api.cerebras.ai/v1",
};

// ponytail: name markers stand in for modalities when a listing has none. A catalog entry
// with output modalities decides by them as well.
const NON_CHAT_MARKERS = [
  "embed",
  "whisper",
  "tts",
  "dall-e",
  "gpt-image",
  "image-gen",
  "transcribe",
  "moderation",
  "rerank",
  "clip",
  "stable-diffusion",
  "sdxl",
  "flux",
  "guard",
  "classifier",
  "ocr",
  "audio",
];

export function isChatModel(id: string, outputModalities?: string[]): boolean {
  const lower = id.toLowerCase();
  if (NON_CHAT_MARKERS.some((marker) => lower.includes(marker))) return false;
  if (outputModalities && outputModalities.length > 0 && !outputModalities.includes("text")) {
    return false;
  }
  return true;
}

const RawCostSchema = z.looseObject({
  input: z.number().nonnegative().optional(),
  output: z.number().nonnegative().optional(),
  cache_read: z.number().nonnegative().optional(),
  cache_write: z.number().nonnegative().optional(),
});

const RawReasoningOptionSchema = z.looseObject({
  type: z.string().optional(),
  values: z.array(z.string()).optional(),
  min: z.union([z.literal(-1), z.number().nonnegative()]).optional(),
  max: z.number().nonnegative().optional(),
});

const RawModelSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string().optional(),
  reasoning: z.boolean().optional(),
  reasoning_options: z.array(RawReasoningOptionSchema).nullable().optional(),
  tool_call: z.boolean().optional(),
  structured_output: z.boolean().nullable().optional(),
  temperature: z.boolean().optional(),
  attachment: z.boolean().optional(),
  modalities: z
    .looseObject({
      input: z.array(z.string()).optional(),
      output: z.array(z.string()).optional(),
    })
    .optional(),
  limit: z
    .looseObject({
      context: z.number().nonnegative().optional(),
      output: z.number().nonnegative().optional(),
      input: z.number().nonnegative().optional(),
    })
    .optional(),
  canonical_model_id: z.string().optional(),
  cost: RawCostSchema.optional(),
  knowledge: z.string().optional(),
  release_date: z.string().optional(),
  open_weights: z.boolean().optional(),
  experimental: z
    .looseObject({
      modes: z
        .record(
          z.string(),
          z.looseObject({
            cost: RawCostSchema.optional(),
            provider: z
              .looseObject({
                body: z.record(z.string(), z.unknown()).optional(),
                headers: z.record(z.string(), z.string()).optional(),
              })
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const RawProviderSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string().optional(),
  env: z.array(z.string()).optional(),
  npm: z.string().optional(),
  api: z.string().optional(),
  doc: z.string().optional(),
  models: z.record(z.string(), RawModelSchema).optional(),
});

const ModelsDevSchema = z.record(z.string(), RawProviderSchema);

type RawReasoningOption = z.infer<typeof RawReasoningOptionSchema>;
type RawCost = z.infer<typeof RawCostSchema>;
type RawModel = z.infer<typeof RawModelSchema>;
type RawProvider = z.infer<typeof RawProviderSchema>;

export interface CatalogProvider {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  apiKeyEnv?: string;
  models: Record<string, ModelConfig>;
  source: "models.dev" | "agent-one" | "builtin";
}

function protocolFor(id: string, npm: string | undefined, api: string | undefined): Protocol {
  const text = `${id} ${npm ?? ""} ${api ?? ""}`.toLowerCase();
  if (id === "google" || text.includes("@ai-sdk/google") || text.includes("generativelanguage")) {
    return "gemini";
  }
  if (text.includes("@ai-sdk/anthropic") || text.includes("anthropic.com")) {
    return "anthropic-messages";
  }
  if (id === "openai" || (text.includes("@ai-sdk/openai") && !text.includes("compatible"))) {
    return "openai-responses";
  }
  return "openai-chat";
}

function baseUrlFor(id: string, api: string | undefined): string | undefined {
  if (api) {
    if (api.includes("$") || api.includes("<")) return undefined;
    return trimTrailingSlashes(api);
  }
  return DEFAULT_BASE_URLS[id];
}

function supportedSdk(npm: string | undefined): boolean {
  if (!npm) return true;
  const value = npm.toLowerCase();
  if (value.includes("cohere") || value.includes("bedrock") || value.includes("vertex")) {
    return false;
  }
  return true;
}

interface ReasoningFields {
  reasoning?: boolean;
  reasoningMode?: ModelConfig["reasoningMode"];
  reasoningLevels?: ReasoningEffort[];
  reasoningBudget?: number;
  reasoningToggle?: boolean;
}

function reasoningFrom(raw: RawModel): ReasoningFields {
  const options: RawReasoningOption[] = raw.reasoning_options ?? [];
  const efforts = options.find((option) => option.type === "effort")?.values ?? [];
  const levels = efforts.filter(isReasoningEffort) as ReasoningEffort[];
  const budget = options.find((option) => option.type === "budget_tokens");
  const toggle = options.some((option) => option.type === "toggle");
  const mode = levels.length > 0 ? "effort" : budget ? "budget" : toggle ? "toggle" : undefined;
  return {
    ...(raw.reasoning === undefined ? {} : { reasoning: raw.reasoning }),
    ...(mode === undefined ? {} : { reasoningMode: mode }),
    ...(levels.length === 0 ? {} : { reasoningLevels: levels }),
    // models.dev uses -1 for automatic budgets; config stores only explicit positive budgets.
    ...(budget?.min !== undefined && budget.min > 0 ? { reasoningBudget: budget.min } : {}),
    ...(toggle ? { reasoningToggle: true } : {}),
  };
}

function costFrom(raw: RawCost | undefined): ModelConfig["cost"] | undefined {
  if (!raw) return undefined;
  return {
    input: raw.input ?? 0,
    output: raw.output ?? 0,
    ...(raw.cache_read === undefined ? {} : { cacheRead: raw.cache_read }),
    ...(raw.cache_write === undefined ? {} : { cacheWrite: raw.cache_write }),
  };
}

function variantsFrom(raw: RawModel): ModelConfig["variants"] | undefined {
  const modes = raw.experimental?.modes;
  if (!modes) return undefined;
  const variants: NonNullable<ModelConfig["variants"]> = {};
  for (const [name, mode] of Object.entries(modes)) {
    variants[name] = {
      name: formatModelName(name),
      ...(mode.cost ? { cost: costFrom(mode.cost) } : {}),
      ...(mode.provider?.body ? { body: mode.provider.body } : {}),
      ...(mode.provider?.headers ? { headers: mode.provider.headers } : {}),
    };
  }
  return Object.keys(variants).length > 0 ? variants : undefined;
}

function modelFromRaw(id: string, raw: RawModel): ModelConfig | undefined {
  const name = raw.name && raw.name !== id ? raw.name : formatModelName(id);
  const cost = costFrom(raw.cost);
  const variants = variantsFrom(raw);
  const candidate: ModelConfig = {
    name,
    ...(raw.limit?.context ? { context: raw.limit.context } : {}),
    ...(raw.limit?.input ? { input: raw.limit.input } : {}),
    ...(raw.limit?.output ? { output: raw.limit.output } : {}),
    ...(raw.tool_call === undefined ? {} : { tools: raw.tool_call }),
    ...reasoningFrom(raw),
    ...(raw.modalities?.input?.includes("image") || raw.attachment ? { vision: true } : {}),
    ...(raw.temperature === undefined ? {} : { temperature: raw.temperature }),
    ...(raw.structured_output === undefined || raw.structured_output === null
      ? {}
      : { structuredOutput: raw.structured_output }),
    ...(cost ? { cost } : {}),
    ...(raw.knowledge ? { knowledge: raw.knowledge } : {}),
    ...(raw.release_date ? { releaseDate: raw.release_date } : {}),
    ...(raw.open_weights === undefined ? {} : { openWeights: raw.open_weights }),
    ...(raw.attachment === undefined ? {} : { attachment: raw.attachment }),
    ...(raw.canonical_model_id ? { canonicalId: raw.canonical_model_id } : {}),
    ...(raw.modalities
      ? {
          modalities: {
            ...(raw.modalities.input ? { input: raw.modalities.input } : {}),
            ...(raw.modalities.output ? { output: raw.modalities.output } : {}),
          },
        }
      : {}),
    ...(variants ? { variants } : {}),
    source: "models.dev",
  };
  const parsed = ModelConfigSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function parseModelsDev(raw: unknown): Record<string, CatalogProvider> {
  const parsed = ModelsDevSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CatalogError(
      "models.dev",
      `schema mismatch${issue ? ` at ${issue.path.join(".") || "root"}: ${issue.message}` : ""}`,
    );
  }
  const output: Record<string, CatalogProvider> = {};
  for (const [id, provider] of Object.entries(parsed.data)) {
    const mapped = providerFromRaw(id, provider);
    if (mapped) output[id] = mapped;
  }
  return output;
}

function providerFromRaw(id: string, raw: RawProvider): CatalogProvider | undefined {
  if (!supportedSdk(raw.npm)) return undefined;
  const baseUrl = baseUrlFor(id, raw.api);
  if (!baseUrl) return undefined;
  const models: Record<string, ModelConfig> = {};
  const canonical = new Set<string>();
  for (const [modelId, model] of Object.entries(raw.models ?? {})) {
    if (!isChatModel(modelId, model.modalities?.output)) continue;
    const idValue = model.id ?? modelId;
    const key = idValue.trim().toLowerCase();
    if (canonical.has(key)) {
      throw new CatalogError("models.dev", `provider "${id}" has duplicate model id "${idValue}"`);
    }
    canonical.add(key);
    const mapped = modelFromRaw(idValue, model);
    if (mapped) models[modelId] = mapped;
  }
  if (Object.keys(models).length === 0) return undefined;
  return {
    id,
    name: raw.name ?? formatModelName(id),
    protocol: protocolFor(id, raw.npm, raw.api),
    baseUrl,
    ...(raw.env?.[0] ? { apiKeyEnv: raw.env[0] } : {}),
    models,
    source: "models.dev",
  };
}

export interface CatalogStatus {
  updatedAt?: string;
  stale: boolean;
  providers: number;
  models: number;
  fallbackModels: number;
  error?: string;
}

const modelsDevSource: SourceSpec<Record<string, CatalogProvider>> = {
  name: "models.dev",
  file: "models-dev.json",
  url: MODELS_DEV_URL,
  accept: "application/json",
  read: (response) => response.json() as Promise<unknown>,
  parse: parseModelsDev,
  empty: (value) => Object.keys(value).length === 0,
};

export async function loadModelsDev(
  cwd: string,
  force = false,
  options: CatalogLoadOptions = {},
): Promise<Record<string, CatalogProvider>> {
  const value = await loadSource(cwd, modelsDevSource, {
    ...options,
    force: force || options.force === true,
  });
  return value ?? {};
}

export async function catalogStatus(cwd: string): Promise<CatalogStatus> {
  const path = cachePath(cwd, "models-dev.json");
  let updatedAt: string | undefined;
  try {
    const info = await stat(path);
    updatedAt = new Date(info.mtimeMs).toISOString();
  } catch {}
  const catalog = await loadModelsDev(cwd);
  const fallback = await loadAgentOne(cwd);
  const error = catalogLastError();
  return {
    ...(updatedAt ? { updatedAt } : {}),
    stale: updatedAt === undefined || Date.now() - Date.parse(updatedAt) > CACHE_TTL_MS,
    providers: Object.keys(catalog).length,
    models: Object.values(catalog).reduce(
      (total, provider) => total + Object.keys(provider.models).length,
      0,
    ),
    fallbackModels: Object.keys(fallback).length,
    ...(error ? { error } : {}),
  };
}

export async function syncCatalog(cwd: string): Promise<CatalogStatus> {
  await Promise.all([
    loadModelsDev(cwd, true).catch(() => undefined),
    loadAgentOne(cwd, true).catch(() => undefined),
  ]);
  return catalogStatus(cwd);
}

export async function catalogProviders(cwd: string): Promise<CatalogProvider[]> {
  const catalog = await loadModelsDev(cwd);
  return Object.values(catalog).sort((left, right) => left.name.localeCompare(right.name));
}

function normalized(id: string): string {
  const last = withoutPrefix(id, "~").split("/").filter(Boolean).at(-1) ?? id;
  return alphanumericLower(last);
}

export function findModel(
  catalog: Record<string, CatalogProvider>,
  modelId: string,
): ModelConfig | undefined {
  const target = normalized(modelId);
  let contains: ModelConfig | undefined;
  for (const provider of Object.values(catalog)) {
    for (const [id, model] of Object.entries(provider.models)) {
      const candidate = normalized(id);
      if (candidate === target) return model;
      if (!contains && (candidate.includes(target) || target.includes(candidate))) contains = model;
    }
  }
  return contains;
}

export async function findCatalogModel(
  cwd: string,
  modelId: string,
): Promise<ModelConfig | undefined> {
  const catalog = await loadModelsDev(cwd);
  const found = findModel(catalog, modelId);
  if (found) return found;
  const fallback = await loadAgentOne(cwd);
  const target = normalized(modelId);
  for (const [id, model] of Object.entries(fallback)) {
    if (normalized(id) === target) return model;
  }
  for (const [id, model] of Object.entries(fallback)) {
    if (normalized(id).includes(target) || target.includes(normalized(id))) return model;
  }
  return undefined;
}

export function providerFromCatalog(provider: CatalogProvider): ProviderConfig {
  return ProviderConfigSchema.parse({
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    ...(provider.apiKeyEnv ? { apiKeyEnv: provider.apiKeyEnv } : {}),
    name: provider.name,
    models: provider.models,
  });
}

const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  moonshotai: "Moonshot AI",
  zai: "Z.AI",
  alibaba: "Alibaba",
  groq: "Groq",
  cerebras: "Cerebras",
  ollama: "Ollama",
};

export function providerNameFromUrl(baseUrl: string): string {
  try {
    const host = withoutPrefix(new URL(baseUrl).hostname, "www.");
    if (host === "localhost" || isIPv4(host)) return "Local";
    const labels = host.split(".").filter(Boolean);
    const label = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
    if (!label) return "Custom provider";
    return PROVIDER_NAMES[label.toLowerCase()] ?? formatModelName(label);
  } catch {
    return "Custom provider";
  }
}
