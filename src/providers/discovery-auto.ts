import { z } from "zod";
import { cleanProviderBaseUrl, type ProtocolHint } from "../../shared/provider-url";
import type { ModelConfig, Protocol } from "../config/schema";
import { withoutPrefix } from "../util/text";
import { hasHeader } from "./compat";
import { anthropicModel, geminiModel, object, openAiModel } from "./discovery-models";
import { endpoint } from "./http";
import type { ProviderFetch } from "./transport";

export type DiscoverProtocol = Protocol | "auto";

export interface AutoDiscoveredEntry {
  id: string;
  raw: Record<string, unknown>;
  model: ModelConfig;
  protocol: Protocol;
}

export interface AutoDiscoveryOutput {
  protocol: Protocol;
  baseUrl: string;
  protocolBaseUrls?: Partial<Record<Protocol, string>>;
  detectedProtocols: Protocol[];
  entries: AutoDiscoveredEntry[];
  warnings: string[];
}

interface EndpointScan {
  baseUrl: string;
  items: Record<string, unknown>[];
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

function rootOf(baseUrl: string): string {
  for (const suffix of ["/v1beta", "/v1alpha", "/v1"]) {
    if (baseUrl.toLowerCase().endsWith(suffix)) {
      return baseUrl.slice(0, -suffix.length);
    }
  }
  return baseUrl;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))];
}

async function fetchListJson(
  url: string,
  headers: Record<string, string>,
  fetchFn: ProviderFetch,
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  try {
    const response = await fetchFn(url, {
      headers: { accept: "application/json", ...headers },
      signal: AbortSignal.timeout(12_000),
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, error: text.slice(0, 300) };
    return { ok: true, status: response.status, data: JSON.parse(text) as unknown };
  } catch (error) {
    const status =
      typeof (error as { status?: unknown })?.status === "number"
        ? (error as { status: number }).status
        : 0;
    return {
      ok: false,
      status,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeRouteAlive(
  url: string,
  headers: Record<string, string>,
  fetchFn: ProviderFetch,
): Promise<boolean> {
  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...headers },
      body: "{}",
      signal: AbortSignal.timeout(6_000),
    });
    await response.body?.cancel().catch(() => undefined);
    const dead = new Set([401, 403, 404, 405, 501]);
    return !dead.has(response.status);
  } catch {
    return false;
  }
}

async function scanOpenAi(
  base: string,
  root: string,
  headers: Record<string, string>,
  fetchFn: ProviderFetch,
  statuses: number[],
): Promise<EndpointScan | undefined> {
  const bases = unique([
    base,
    base.toLowerCase().endsWith("/v1") ? "" : `${base}/v1`,
    `${root}/v1`,
  ]);
  for (const candidate of bases) {
    const res = await fetchListJson(endpoint(candidate, "/models"), headers, fetchFn);
    if (!res.ok) {
      if (res.status > 0) statuses.push(res.status);
      continue;
    }
    const parsed = OpenAiListSchema.safeParse(res.data);
    if (!parsed.success) continue;
    const items = Array.isArray(parsed.data)
      ? parsed.data
      : (parsed.data.data ?? parsed.data.models ?? []);
    if (items.length > 0) return { baseUrl: candidate, items };
  }
  return undefined;
}

async function scanAnthropic(
  base: string,
  root: string,
  headers: Record<string, string>,
  fetchFn: ProviderFetch,
  statuses: number[],
): Promise<EndpointScan | undefined> {
  const bases = unique([base, root, `${root}/anthropic`]);
  for (const candidate of bases) {
    const res = await fetchListJson(endpoint(candidate, "/v1/models"), headers, fetchFn);
    if (!res.ok) {
      if (res.status > 0) statuses.push(res.status);
      continue;
    }
    const parsed = DataListSchema.safeParse(res.data);
    if (!parsed.success) continue;
    if (parsed.data.data.length > 0) return { baseUrl: candidate, items: parsed.data.data };
  }
  return undefined;
}

async function scanGemini(
  base: string,
  root: string,
  headers: Record<string, string>,
  apiKey: string | undefined,
  fetchFn: ProviderFetch,
  statuses: number[],
): Promise<EndpointScan | undefined> {
  const bases = unique([
    base.toLowerCase().endsWith("/v1beta") || base.toLowerCase().endsWith("/v1alpha") ? base : "",
    `${root}/v1beta`,
    base,
  ]);
  for (const candidate of bases) {
    const url = new URL(`${candidate}/models`);
    if (apiKey && !hasHeader(headers, "x-goog-api-key")) url.searchParams.set("key", apiKey);
    const res = await fetchListJson(url.toString(), headers, fetchFn);
    if (!res.ok) {
      if (res.status > 0) statuses.push(res.status);
      continue;
    }
    const parsed = ModelsListSchema.safeParse(res.data);
    if (!parsed.success) continue;
    if (parsed.data.models.length > 0) return { baseUrl: candidate, items: parsed.data.models };
  }
  return undefined;
}

function modelIdOf(raw: Record<string, unknown>, protocol: Protocol): string | undefined {
  if (protocol === "gemini") {
    return typeof raw.name === "string" ? withoutPrefix(raw.name, "models/") : undefined;
  }
  return typeof raw.id === "string"
    ? raw.id
    : typeof raw.name === "string"
      ? withoutPrefix(raw.name, "models/")
      : undefined;
}

function isClaudeModel(id: string, raw: Record<string, unknown>): boolean {
  const lower = id.toLowerCase();
  const owner = typeof raw.owned_by === "string" ? raw.owned_by.toLowerCase() : "";
  return owner === "anthropic" || lower.startsWith("claude") || lower.includes("/claude");
}

function isGeminiFamily(id: string, raw: Record<string, unknown>): boolean {
  const lower = id.toLowerCase();
  const owner = typeof raw.owned_by === "string" ? raw.owned_by.toLowerCase() : "";
  return owner === "google" || lower.startsWith("gemini") || lower.includes("/gemini");
}

function chooseProtocol(
  id: string,
  raw: Record<string, unknown>,
  sources: Set<Protocol>,
  live: Set<Protocol>,
  hint?: ProtocolHint,
): Protocol {
  if (sources.size === 1) {
    const only = [...sources][0] as Protocol;
    if (only === "openai-chat" && !live.has("openai-chat") && live.has("openai-responses")) {
      return "openai-responses";
    }
    return only;
  }
  if (isClaudeModel(id, raw) && live.has("anthropic-messages")) return "anthropic-messages";
  if (isGeminiFamily(id, raw) && live.has("gemini")) return "gemini";
  if (hint && live.has(hint) && (hint === "openai-chat" || hint === "openai-responses")) {
    return hint;
  }
  if (live.has("openai-chat")) return "openai-chat";
  if (live.has("openai-responses")) return "openai-responses";
  if (live.has("anthropic-messages")) return "anthropic-messages";
  if (live.has("gemini")) return "gemini";
  return [...sources][0] ?? "openai-chat";
}

export async function discoverAutoEndpoints(
  rawBaseUrl: string,
  apiKey: string | undefined,
  extraHeaders: Record<string, string> | undefined,
  fetchFn: ProviderFetch,
): Promise<AutoDiscoveryOutput> {
  const cleaned = cleanProviderBaseUrl(rawBaseUrl);
  const base = cleaned.ok ? cleaned.baseUrl : rawBaseUrl.trim();
  const root = rootOf(base);
  const hint = cleaned.ok ? cleaned.hintedProtocol : undefined;

  const openAiHeaders: Record<string, string> = { ...extraHeaders };
  if (apiKey && !hasHeader(openAiHeaders, "authorization")) {
    openAiHeaders.authorization = `Bearer ${apiKey}`;
  }
  const anthHeaders: Record<string, string> = {
    "anthropic-version": "2023-06-01",
    ...extraHeaders,
  };
  if (apiKey && !hasHeader(anthHeaders, "x-api-key") && !hasHeader(anthHeaders, "authorization")) {
    anthHeaders["x-api-key"] = apiKey;
  }
  const geminiHeaders: Record<string, string> = { ...extraHeaders };
  if (apiKey && !hasHeader(geminiHeaders, "x-goog-api-key")) {
    geminiHeaders["x-goog-api-key"] = apiKey;
  }

  const statuses: number[] = [];
  const [openAiScan, anthScan, geminiScan] = await Promise.all([
    scanOpenAi(base, root, openAiHeaders, fetchFn, statuses),
    scanAnthropic(base, root, anthHeaders, fetchFn, statuses),
    scanGemini(base, root, geminiHeaders, apiKey, fetchFn, statuses),
  ]);

  if (!openAiScan && !anthScan && !geminiScan) {
    const authStatus = statuses.find((code) => code === 401 || code === 403);
    if (authStatus !== undefined) {
      throw new Error(`cannot read models from ${base}: HTTP ${authStatus}`);
    }
    const serverStatus = statuses.find((code) => code === 429 || code >= 500);
    if (serverStatus !== undefined) {
      throw new Error(`cannot read models from ${base}: HTTP ${serverStatus}`);
    }
    throw new Error(
      `cannot read models from ${base}: none of OpenAI, Anthropic, or Gemini model endpoints responded`,
    );
  }

  const openAiBase = openAiScan?.baseUrl ?? `${root}/v1`;
  const anthBase = anthScan?.baseUrl ?? root;

  const [chatAlive, respAlive, anthAlive] = await Promise.all([
    openAiScan || anthScan
      ? probeRouteAlive(endpoint(openAiBase, "/chat/completions"), openAiHeaders, fetchFn)
      : false,
    openAiScan || anthScan
      ? probeRouteAlive(endpoint(openAiBase, "/responses"), openAiHeaders, fetchFn)
      : false,
    anthScan || openAiScan
      ? probeRouteAlive(endpoint(anthBase, "/v1/messages"), anthHeaders, fetchFn)
      : false,
  ]);

  const live = new Set<Protocol>();
  if (chatAlive) live.add("openai-chat");
  if (respAlive) live.add("openai-responses");
  if (anthAlive) live.add("anthropic-messages");
  if (geminiScan) live.add("gemini");

  // Fallback for strict/mock endpoints that reject empty POST probes even though GET /models succeeded.
  if (live.size === 0) {
    if (openAiScan) live.add(hint === "openai-responses" ? "openai-responses" : "openai-chat");
    if (anthScan) live.add("anthropic-messages");
    if (geminiScan) live.add("gemini");
  }

  const byKey = new Map<
    string,
    { id: string; raw: Record<string, unknown>; model: ModelConfig; sources: Set<Protocol> }
  >();
  const collectScan = (scan: EndpointScan | undefined, protocol: Protocol) => {
    if (!scan) return;
    for (const entry of scan.items) {
      const raw = object(entry);
      if (!raw) continue;
      const model =
        protocol === "anthropic-messages"
          ? anthropicModel(raw)
          : protocol === "gemini"
            ? geminiModel(raw)
            : openAiModel(raw);
      if (!model) continue;
      const id = modelIdOf(raw, protocol);
      if (!id) continue;
      const key = id.trim().toLowerCase();
      const existing = byKey.get(key);
      if (existing) {
        existing.sources.add(protocol);
        existing.model = { ...model, ...existing.model };
      } else {
        byKey.set(key, { id, raw, model, sources: new Set([protocol]) });
      }
    }
  };

  collectScan(openAiScan, "openai-chat");
  collectScan(anthScan, "anthropic-messages");
  collectScan(geminiScan, "gemini");

  if (byKey.size === 0) {
    throw new Error(`cannot read models from ${base}: no compatible chat models found`);
  }

  const counts = new Map<Protocol, number>();
  const entries: AutoDiscoveredEntry[] = [];
  for (const item of byKey.values()) {
    const chosen = chooseProtocol(item.id, item.raw, item.sources, live, hint);
    counts.set(chosen, (counts.get(chosen) ?? 0) + 1);
    entries.push({ id: item.id, raw: item.raw, model: item.model, protocol: chosen });
  }

  const priority: Protocol[] = [
    ...(hint ? [hint] : []),
    "openai-chat",
    "anthropic-messages",
    "openai-responses",
    "gemini",
  ];
  const primary =
    [...counts.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return priority.indexOf(a[0]) - priority.indexOf(b[0]);
    })[0]?.[0] ?? "openai-chat";

  const baseFor = (protocol: Protocol): string => {
    if (protocol === "anthropic-messages") return anthBase;
    if (protocol === "gemini") return geminiScan?.baseUrl ?? `${root}/v1beta`;
    return openAiBase;
  };

  const detectedProtocols = [...counts.keys()];
  const primaryBaseUrl = baseFor(primary);
  const protocolBaseUrls: Partial<Record<Protocol, string>> = {};
  if (detectedProtocols.length > 1) {
    for (const protocol of detectedProtocols) {
      protocolBaseUrls[protocol] = baseFor(protocol);
    }
  }

  return {
    protocol: primary,
    baseUrl: primaryBaseUrl,
    ...(Object.keys(protocolBaseUrls).length > 0 ? { protocolBaseUrls } : {}),
    detectedProtocols,
    entries,
    warnings: [],
  };
}
