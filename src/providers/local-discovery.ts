import type { ModelConfig } from "../config/schema";

interface LocalModel {
  id: string;
  info: Partial<ModelConfig>;
}

function isLocalHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown | undefined> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(4_000),
      headers: {
        accept: "application/json",
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    if (!response.ok) return undefined;
    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

async function ollama(baseUrl: string, headers: Record<string, string>): Promise<LocalModel[]> {
  const origin = new URL(baseUrl).origin;
  const tags = object(await fetchJson(`${origin}/api/tags`, { headers }));
  const models = Array.isArray(tags?.models) ? tags.models : [];
  const results = await Promise.all(
    models.slice(0, 16).map(async (entry): Promise<LocalModel | undefined> => {
      const model = object(entry);
      const name =
        typeof model?.name === "string"
          ? model.name
          : typeof model?.model === "string"
            ? model.model
            : undefined;
      if (!name) return undefined;
      const show = object(
        await fetchJson(`${origin}/api/show`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({ name }),
        }),
      );
      const modelInfo = object(show?.model_info);
      const context = modelInfo
        ? Object.entries(modelInfo)
            .filter(([key]) => key.endsWith(".context_length"))
            .map(([, value]) => numeric(value))
            .find((value) => value !== undefined)
        : undefined;
      const capabilities = Array.isArray(show?.capabilities)
        ? show.capabilities.filter((value): value is string => typeof value === "string")
        : [];
      return {
        id: name,
        info: {
          ...(context ? { context } : {}),
          ...(capabilities.includes("tools") ? { tools: true } : {}),
          ...(capabilities.includes("vision") ? { vision: true } : {}),
          ...(capabilities.includes("thinking") ? { reasoning: true } : {}),
          source: "ollama",
        },
      } satisfies LocalModel;
    }),
  );
  return results.filter((entry): entry is LocalModel => entry !== undefined);
}

async function lmStudio(baseUrl: string, headers: Record<string, string>): Promise<LocalModel[]> {
  const origin = new URL(baseUrl).origin;
  const candidates = [`${origin}/api/v1/models`, `${origin}/v1/models`];
  for (const url of candidates) {
    const body = object(await fetchJson(url, { headers }));
    const models = Array.isArray(body?.models)
      ? body.models
      : Array.isArray(body?.data)
        ? body.data
        : [];
    if (models.length === 0) continue;
    const output: LocalModel[] = [];
    for (const entry of models) {
      const model = object(entry);
      const id =
        typeof model?.id === "string"
          ? model.id
          : typeof model?.modelKey === "string"
            ? model.modelKey
            : undefined;
      if (!id) continue;
      const context = numeric(
        model?.max_context_length ?? model?.context_length ?? model?.maxContextLength,
      );
      const capabilities = Array.isArray(model?.capabilities)
        ? model.capabilities.filter((value): value is string => typeof value === "string")
        : [];
      output.push({
        id,
        info: {
          ...(context ? { context } : {}),
          ...(capabilities.includes("tool_use") || capabilities.includes("tools")
            ? { tools: true }
            : {}),
          ...(capabilities.includes("vision") ? { vision: true } : {}),
          source: "lmstudio",
        },
      });
    }
    if (output.length > 0) return output;
  }
  return [];
}

async function llamaCpp(baseUrl: string, headers: Record<string, string>): Promise<LocalModel[]> {
  const origin = new URL(baseUrl).origin;
  const props = object(await fetchJson(`${origin}/props`, { headers }));
  const settings = object(props?.default_generation_settings);
  const context = numeric(settings?.n_ctx ?? props?.n_ctx);
  if (!context) return [];
  const models = object(await fetchJson(`${origin}/v1/models`, { headers }));
  const data = Array.isArray(models?.data) ? models.data : [];
  return data
    .map((entry) => object(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== undefined)
    .map((entry) => ({
      id: typeof entry.id === "string" ? entry.id : "",
      info: { context, source: "llamacpp" },
    }))
    .filter((entry) => entry.id.length > 0);
}

export interface NativeDiscovery {
  models: LocalModel[];
  sources: string[];
}

export async function discoverNativeLocal(
  baseUrl: string,
  headers: Record<string, string> = {},
): Promise<NativeDiscovery> {
  if (!isLocalHost(baseUrl)) return { models: [], sources: [] };
  const results = await Promise.all([
    ollama(baseUrl, headers).then((models) => ({ source: "ollama", models })),
    lmStudio(baseUrl, headers).then((models) => ({ source: "lmstudio", models })),
    llamaCpp(baseUrl, headers).then((models) => ({ source: "llamacpp", models })),
  ]);
  const models = results.flatMap((result) => result.models);
  const sources = results
    .filter((result) => result.models.length > 0)
    .map((result) => result.source);
  return { models, sources };
}

export function mergeNativeModels(
  models: Record<string, ModelConfig>,
  native: NativeDiscovery,
): void {
  for (const entry of native.models) {
    const exact = models[entry.id];
    const fallback = exact
      ? undefined
      : Object.entries(models).find(
          ([id]) => id.endsWith(`/${entry.id}`) || entry.id.endsWith(`/${id}`),
        )?.[1];
    const target = exact ?? fallback;
    if (!target) continue;
    if (entry.info.context && !target.context) target.context = entry.info.context;
    if (entry.info.tools && target.tools !== false) target.tools = true;
    if (entry.info.vision && target.vision !== false) target.vision = true;
    if (entry.info.reasoning && target.reasoning !== false) target.reasoning = true;
    target.source = entry.info.source;
  }
}
