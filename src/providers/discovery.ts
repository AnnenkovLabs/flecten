import { z } from "zod";
import { type ModelConfig, ModelConfigSchema, type Protocol } from "../config/schema";
import { HarnessError } from "../errors";
import { dashSlug, withoutPrefix } from "../util/text";
import {
  findModel,
  formatModelName,
  loadAgentOne,
  loadModelsDev,
  providerNameFromUrl,
} from "./catalog";
import { hasHeader } from "./compat";
import { type DiscoverProtocol, discoverAutoEndpoints } from "./discovery-auto";
import { anthropicModel, geminiModel, object, openAiModel } from "./discovery-models";
import { endpoint, normalizeBaseUrl } from "./http";
import { discoverNativeLocal, mergeNativeModels } from "./local-discovery";
import { findFallbackModel } from "./model-identity";
import { createProviderFetch, type ProviderFetch } from "./transport";

export type { DiscoverProtocol } from "./discovery-auto";
export { testProvider } from "./provider-test";

export interface DiscoverInput {
  protocol?: DiscoverProtocol;
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
  protocolBaseUrls?: Partial<Record<Protocol, string>>;
  detectedProtocols?: Protocol[];
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
  const base = normalizeBaseUrl(baseUrl);
  const output = [base];
  if (protocol === "gemini") {
    if (!["/v1", "/v1beta", "/v1alpha"].some((suffix) => base.endsWith(suffix))) {
      output.push(`${base}/v1beta`);
    }
    return output;
  }
  if (protocol === "anthropic-messages") {
    if (base.endsWith("/v1")) output.push(base.slice(0, -3));
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

function mergeModel(
  api: ModelConfig,
  catalog: ModelConfig | undefined,
): { model: ModelConfig; clamped?: string } {
  const merged: ModelConfig = !catalog
    ? { ...api }
    : {
        ...catalog,
        ...api,
        name: api.name ?? catalog.name,
        reasoningLevels:
          api.reasoningLevels && api.reasoningLevels.length > 0
            ? api.reasoningLevels
            : catalog.reasoningLevels,
        source: api.source ?? catalog.source,
      };
  let clamped: string | undefined;
  if (
    merged.context !== undefined &&
    merged.output !== undefined &&
    merged.output > merged.context
  ) {
    const rawOutput = merged.output;
    merged.output =
      catalog?.output !== undefined && catalog.output <= merged.context
        ? catalog.output
        : merged.context;
    clamped = `clamped output limit ${rawOutput} to ${merged.output}`;
  }
  if (merged.context !== undefined && merged.input !== undefined && merged.input > merged.context) {
    merged.input =
      catalog?.input !== undefined && catalog.input <= merged.context
        ? catalog.input
        : merged.context;
  }
  return { model: merged, ...(clamped ? { clamped } : {}) };
}

function slug(value: string): string {
  return dashSlug(value).slice(0, 40) || "provider";
}

async function discoverOpenAi(
  input: DiscoverInput & { protocol: Protocol },
): Promise<{ models: unknown[]; baseUrl: string; warnings: string[] }> {
  const headers: Record<string, string> = { ...input.headers };
  if (input.apiKey && !hasHeader(headers, "authorization")) {
    headers.authorization = `Bearer ${input.apiKey}`;
  }
  const fetchFn = createProviderFetch(transportOptions(input));
  let lastError = "";
  for (const base of candidates(input.baseUrl, input.protocol)) {
    const result = await getJson(endpoint(base, "/models"), headers, fetchFn);
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
  input: DiscoverInput & { protocol: Protocol },
): Promise<{ models: unknown[]; baseUrl: string; warnings: string[] }> {
  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
    ...input.headers,
  };
  if (input.apiKey && !hasHeader(headers, "x-api-key") && !hasHeader(headers, "authorization")) {
    headers["x-api-key"] = input.apiKey;
  }
  const fetchFn = createProviderFetch(transportOptions(input));
  let lastError = "";
  for (const base of candidates(input.baseUrl, input.protocol)) {
    const result = await getJson(endpoint(base, "/v1/models"), headers, fetchFn);
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
  input: DiscoverInput & { protocol: Protocol },
): Promise<{ models: unknown[]; baseUrl: string; warnings: string[] }> {
  const headers: Record<string, string> = { ...input.headers };
  if (input.apiKey && !hasHeader(headers, "x-goog-api-key")) {
    headers["x-goog-api-key"] = input.apiKey;
  }
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
  const requested = input.protocol ?? "auto";
  const [catalog, fallback] = await Promise.all([
    loadModelsDev(cwd),
    loadAgentOne(cwd).catch(() => ({})),
  ]);
  const models: Record<string, ModelConfig> = {};
  const warnings: string[] = [];
  let resolvedProtocol: Protocol;
  let resolvedBaseUrl: string;
  let protocolBaseUrls: Partial<Record<Protocol, string>> | undefined;
  let detectedProtocols: Protocol[] | undefined;

  if (requested === "auto") {
    const fetchFn = createProviderFetch(transportOptions(input));
    const auto = await discoverAutoEndpoints(input.baseUrl, input.apiKey, input.headers, fetchFn);
    resolvedProtocol = auto.protocol;
    resolvedBaseUrl = auto.baseUrl;
    protocolBaseUrls = auto.protocolBaseUrls;
    detectedProtocols = auto.detectedProtocols;
    warnings.push(...auto.warnings);
    for (const entry of auto.entries) {
      const known =
        findModel(catalog, entry.id, resolvedBaseUrl) ?? findFallbackModel(fallback, entry.id);
      const merged = mergeModel(entry.model, known);
      if (entry.protocol !== resolvedProtocol) merged.model.protocol = entry.protocol;
      const parsed = ModelConfigSchema.safeParse(merged.model);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        warnings.push(
          `${formatModelName(entry.id)}: dropped invalid metadata${issue ? ` (${issue.path.join(".")}: ${issue.message})` : ""}`,
        );
        continue;
      }
      models[entry.id] = parsed.data;
      if (merged.clamped) warnings.push(`${formatModelName(entry.id)}: ${merged.clamped}`);
      if (!known)
        warnings.push(`${formatModelName(entry.id)}: no catalog metadata, using API fields only`);
    }
  } else {
    const singleInput = { ...input, protocol: requested };
    const result =
      requested === "anthropic-messages"
        ? await discoverAnthropic(singleInput)
        : requested === "gemini"
          ? await discoverGemini(singleInput)
          : await discoverOpenAi(singleInput);
    resolvedProtocol = requested;
    resolvedBaseUrl = result.baseUrl;
    detectedProtocols = [requested];
    const seen = new Set<string>();
    for (const entry of result.models) {
      const raw = object(entry);
      if (!raw) continue;
      const model =
        requested === "anthropic-messages"
          ? anthropicModel(raw)
          : requested === "gemini"
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
          `${requested} discovery returned duplicate model id "${id}"`,
        );
      }
      seen.add(key);
      const known = findModel(catalog, id, resolvedBaseUrl) ?? findFallbackModel(fallback, id);
      const merged = mergeModel(model, known);
      const parsed = ModelConfigSchema.safeParse(merged.model);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        warnings.push(
          `${formatModelName(id)}: dropped invalid metadata${issue ? ` (${issue.path.join(".")}: ${issue.message})` : ""}`,
        );
        continue;
      }
      models[id] = parsed.data;
      if (merged.clamped) warnings.push(`${formatModelName(id)}: ${merged.clamped}`);
      if (!known)
        warnings.push(`${formatModelName(id)}: no catalog metadata, using API fields only`);
    }
  }

  const nativeHeaders = { ...(input.headers ?? {}) };
  if (input.apiKey && !hasHeader(nativeHeaders, "authorization")) {
    nativeHeaders.authorization = `Bearer ${input.apiKey}`;
  }
  const native = await discoverNativeLocal(resolvedBaseUrl, nativeHeaders);
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
      return new URL(provider.baseUrl).host === new URL(resolvedBaseUrl).host;
    } catch {
      return false;
    }
  });
  const providerName = knownProvider?.name ?? providerNameFromUrl(resolvedBaseUrl);
  return {
    providerId: slug(providerName),
    providerName,
    protocol: resolvedProtocol,
    baseUrl: resolvedBaseUrl,
    ...(protocolBaseUrls ? { protocolBaseUrls } : {}),
    ...(detectedProtocols ? { detectedProtocols } : {}),
    models,
    warnings,
  };
}
