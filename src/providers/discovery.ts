import { z } from "zod";
import {
  type HarnessConfig,
  type ModelConfig,
  ModelConfigSchema,
  type Protocol,
  type ProviderConfig,
} from "../config/schema";
import { HarnessError } from "../errors";
import { dashSlug, trimTrailingSlashes, withoutPrefix } from "../util/text";
import { findCatalogModel, formatModelName, loadModelsDev, providerNameFromUrl } from "./catalog";
import { anthropicModel, geminiModel, object, openAiModel } from "./discovery-models";
import { discoverNativeLocal, mergeNativeModels } from "./local-discovery";
import { createProvider } from "./registry";
import { createProviderFetch, type ProviderFetch } from "./transport";

export interface DiscoverInput {
  protocol: Protocol;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  proxy?: string;
  transportTimeoutMs?: number;
  transportIdleTimeoutMs?: number;
}

export interface DiscoverResult {
  providerId: string;
  providerName: string;
  protocol: Protocol;
  baseUrl: string;
  models: Record<string, ModelConfig>;
  warnings: string[];
}

interface JsonResult {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
}

const ModelEntrySchema = z.record(z.string(), z.unknown());
const OpenAiListSchema = z.union([
  z.array(ModelEntrySchema),
  z.looseObject({
    data: z.array(ModelEntrySchema).optional(),
    models: z.array(ModelEntrySchema).optional(),
  }),
]);
const DataListSchema = z.looseObject({ data: z.array(ModelEntrySchema) });
const ModelsListSchema = z.looseObject({ models: z.array(ModelEntrySchema) });

function transportOptions(input: DiscoverInput): {
  proxy?: string;
  timeoutMs?: number;
  idleTimeoutMs?: number;
} {
  return {
    ...(input.proxy ? { proxy: input.proxy } : {}),
    ...(input.transportTimeoutMs ? { timeoutMs: input.transportTimeoutMs } : {}),
    ...(input.transportIdleTimeoutMs ? { idleTimeoutMs: input.transportIdleTimeoutMs } : {}),
  };
}

function schemaError(protocol: Protocol): HarnessError {
  return new HarnessError(
    "provider_failed",
    `${protocol} discovery returned an unexpected response schema`,
  );
}

function candidates(baseUrl: string, protocol: Protocol): string[] {
  const base = trimTrailingSlashes(baseUrl);
  const output = [base];
  if (protocol === "gemini") {
    if (!["/v1", "/v1beta", "/v1alpha"].some((suffix) => base.endsWith(suffix))) {
      output.push(`${base}/v1beta`);
    }
    return output;
  }
  if (!base.endsWith("/v1")) output.push(`${base}/v1`);
  return output;
}

async function getJson(
  url: string,
  headers: Record<string, string>,
  fetchFn: ProviderFetch,
): Promise<JsonResult> {
  try {
    const response = await fetchFn(url, {
      headers: { accept: "application/json", ...headers },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, status: response.status, error: text.slice(0, 500) };
    }
    try {
      return { ok: true, status: response.status, data: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, status: response.status, error: "response is not JSON" };
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function mergeModel(api: ModelConfig, catalog: ModelConfig | undefined): ModelConfig {
  if (!catalog) return api;
  return {
    ...catalog,
    ...api,
    name: api.name ?? catalog.name,
    reasoningLevels:
      api.reasoningLevels && api.reasoningLevels.length > 0
        ? api.reasoningLevels
        : catalog.reasoningLevels,
    source: api.source ?? catalog.source,
  };
}

function slug(value: string): string {
  return dashSlug(value).slice(0, 40) || "provider";
}

async function discoverOpenAi(
  input: DiscoverInput,
): Promise<{ models: unknown[]; baseUrl: string; warnings: string[] }> {
  const headers: Record<string, string> = { ...input.headers };
  if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`;
  const fetchFn = createProviderFetch(transportOptions(input));
  let lastError = "";
  for (const base of candidates(input.baseUrl, input.protocol)) {
    const result = await getJson(`${base}/models`, headers, fetchFn);
    if (result.ok) {
      const parsed = OpenAiListSchema.safeParse(result.data);
      if (!parsed.success) {
        lastError = schemaError(input.protocol).message;
        continue;
      }
      const data = Array.isArray(parsed.data)
        ? parsed.data
        : (parsed.data.data ?? parsed.data.models ?? []);
      if (data.length > 0) return { models: data, baseUrl: base, warnings: [] };
      lastError = "the models endpoint returned an empty list";
    } else {
      lastError = result.error ?? `HTTP ${result.status}`;
    }
  }
  throw new Error(`cannot read models from ${input.baseUrl}: ${lastError}`);
}

async function discoverAnthropic(
  input: DiscoverInput,
): Promise<{ models: unknown[]; baseUrl: string; warnings: string[] }> {
  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
    ...input.headers,
  };
  if (input.apiKey) headers["x-api-key"] = input.apiKey;
  const fetchFn = createProviderFetch(transportOptions(input));
  let lastError = "";
  for (const base of candidates(input.baseUrl, input.protocol)) {
    const result = await getJson(`${base}/v1/models`, headers, fetchFn);
    if (result.ok) {
      const parsed = DataListSchema.safeParse(result.data);
      if (!parsed.success) {
        lastError = schemaError(input.protocol).message;
        continue;
      }
      if (parsed.data.data.length > 0) {
        return { models: parsed.data.data, baseUrl: base, warnings: [] };
      }
      lastError = "the models endpoint returned an empty list";
    } else {
      lastError = result.error ?? `HTTP ${result.status}`;
    }
  }
  throw new Error(`cannot read models from ${input.baseUrl}: ${lastError}`);
}

async function discoverGemini(
  input: DiscoverInput,
): Promise<{ models: unknown[]; baseUrl: string; warnings: string[] }> {
  const headers: Record<string, string> = { ...input.headers };
  if (input.apiKey) headers["x-goog-api-key"] = input.apiKey;
  const fetchFn = createProviderFetch(transportOptions(input));
  let lastError = "";
  for (const base of candidates(input.baseUrl, input.protocol)) {
    const url = new URL(`${base}/models`);
    if (input.apiKey && !headers["x-goog-api-key"]) url.searchParams.set("key", input.apiKey);
    const result = await getJson(url.toString(), headers, fetchFn);
    if (result.ok) {
      const parsed = ModelsListSchema.safeParse(result.data);
      if (!parsed.success) {
        lastError = schemaError(input.protocol).message;
        continue;
      }
      if (parsed.data.models.length > 0) {
        return { models: parsed.data.models, baseUrl: base, warnings: [] };
      }
      lastError = "the models endpoint returned an empty list";
    } else {
      lastError = result.error ?? `HTTP ${result.status}`;
    }
  }
  throw new Error(`cannot read models from ${input.baseUrl}: ${lastError}`);
}

export async function discoverProvider(cwd: string, input: DiscoverInput): Promise<DiscoverResult> {
  const result =
    input.protocol === "anthropic-messages"
      ? await discoverAnthropic(input)
      : input.protocol === "gemini"
        ? await discoverGemini(input)
        : await discoverOpenAi(input);
  const catalog = await loadModelsDev(cwd);
  const models: Record<string, ModelConfig> = {};
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const entry of result.models) {
    const raw = object(entry);
    if (!raw) continue;
    const model =
      input.protocol === "anthropic-messages"
        ? anthropicModel(raw)
        : input.protocol === "gemini"
          ? geminiModel(raw)
          : openAiModel(raw);
    if (!model) continue;
    const id =
      typeof raw.id === "string"
        ? raw.id
        : typeof raw.name === "string"
          ? withoutPrefix(raw.name, "models/")
          : undefined;
    if (!id) continue;
    const key = id.trim().toLowerCase();
    if (seen.has(key)) {
      throw new HarnessError(
        "provider_failed",
        `${input.protocol} discovery returned duplicate model id "${id}"`,
      );
    }
    seen.add(key);
    const known = await findCatalogModel(cwd, id);
    const parsed = ModelConfigSchema.safeParse(mergeModel(model, known));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      warnings.push(
        `${formatModelName(id)}: dropped invalid metadata${issue ? ` (${issue.path.join(".")}: ${issue.message})` : ""}`,
      );
      continue;
    }
    models[id] = parsed.data;
    if (!known) warnings.push(`${formatModelName(id)}: no catalog metadata, using API fields only`);
  }
  const nativeHeaders = { ...(input.headers ?? {}) };
  if (input.apiKey) nativeHeaders.authorization = `Bearer ${input.apiKey}`;
  const native = await discoverNativeLocal(result.baseUrl, nativeHeaders);
  mergeNativeModels(models, native);
  if (native.sources.length > 0) {
    warnings.push(`native discovery: ${native.sources.join(", ")}`);
  }
  for (const [id, model] of Object.entries(models)) {
    const parsed = ModelConfigSchema.safeParse(model);
    if (parsed.success) models[id] = parsed.data;
    else {
      delete models[id];
      const issue = parsed.error.issues[0];
      warnings.push(
        `${formatModelName(id)}: dropped invalid native metadata${issue ? ` (${issue.path.join(".")}: ${issue.message})` : ""}`,
      );
    }
  }
  const knownProvider = Object.values(catalog).find((provider) => {
    try {
      return new URL(provider.baseUrl).host === new URL(result.baseUrl).host;
    } catch {
      return false;
    }
  });
  const providerName = knownProvider?.name ?? providerNameFromUrl(result.baseUrl);
  return {
    providerId: slug(providerName),
    providerName,
    protocol: input.protocol,
    baseUrl: result.baseUrl,
    models,
    warnings,
  };
}

export async function testProvider(
  definition: ProviderConfig,
  model: string,
  providerId = "test",
): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  const started = performance.now();
  const config: HarnessConfig = {
    useDefaults: false,
    provider: providerId,
    model,
    providers: { [providerId]: definition },
    mcp: { servers: {} },
    hooks: {
      sessionStart: [],
      userPromptSubmit: [],
      preToolUse: [],
      postToolUse: [],
      stop: [],
      sessionEnd: [],
      permission: [],
      compact: [],
      notification: [],
      subagent: [],
      toolBatch: [],
    },
    maxOutputTokens: 256,
    catalog: { autoRefresh: false, ttlMs: 43_200_000 },
    context: { window: 128_000, reserve: 1_000 },
    loop: { maxTurns: 1, continuations: 0, parallelTools: false },
    tools: {
      maxOutputBytes: 10_000,
      maxOutputLines: 100,
      bashTimeoutMs: 5_000,
      readLimitLines: 100,
    },
  };
  try {
    const active = createProvider(config, providerId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("test timed out")), 30_000);
    let text = "";
    try {
      for await (const event of active.provider.stream(
        {
          model,
          system: "Reply with the single word OK.",
          messages: [{ role: "user", content: "ping" }],
          tools: [],
          maxTokens: 256,
        },
        controller.signal,
      )) {
        if (event.type === "text") text += event.delta;
        if (event.type === "done") break;
      }
    } finally {
      clearTimeout(timer);
    }
    return {
      ok: true,
      message: text.trim().length > 0 ? text.trim().slice(0, 200) : "connected",
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      latencyMs: Math.round(performance.now() - started),
    };
  }
}
