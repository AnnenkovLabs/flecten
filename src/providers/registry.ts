import { providerConfig } from "../config/load";
import type { HarnessConfig, Protocol, ProviderConfig } from "../config/schema";
import { HarnessError, MissingKeyError } from "../errors";
import { createAnthropic } from "./anthropic";
import { buildFailoverPlan, createFailoverProvider } from "./failover";
import { createGemini } from "./gemini";
import { createOpenAiChat } from "./openai-chat";
import { createOpenAiResponses } from "./openai-responses";
import { createProviderFetch } from "./transport";
import type {
  ActiveProvider,
  ModelEvent,
  ModelProvider,
  ModelRequest,
  ProviderRuntime,
} from "./types";

const commandTokens = new Map<string, { value: string; expiresAt: number; signature: string }>();

export function invalidateProviderAuthorization(name: string): void {
  commandTokens.delete(name);
}

function commandApiKey(name: string, definition: ProviderConfig): string | undefined {
  const auth = definition.auth;
  if (!auth) return undefined;
  const cacheKey = JSON.stringify([name, auth]);
  const cached = commandTokens.get(name);
  if (cached && cached.signature === cacheKey && cached.expiresAt > Date.now()) return cached.value;
  const result = Bun.spawnSync([auth.command, ...auth.args], {
    timeout: auth.timeoutMs,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!result.success) {
    const error = result.stderr.toString().trim();
    throw new HarnessError(
      "provider_failed",
      `provider "${name}" auth command failed${error ? `: ${error}` : ""}`,
    );
  }
  const value = result.stdout.toString().trim();
  if (!value) {
    throw new HarnessError("provider_failed", `provider "${name}" auth command returned no token`);
  }
  commandTokens.set(name, {
    value,
    expiresAt: Date.now() + auth.refreshIntervalMs,
    signature: cacheKey,
  });
  return value;
}

export function resolveApiKey(name: string, definition: ProviderConfig): string | undefined {
  const fromEnvironment = definition.apiKeyEnv
    ? process.env[definition.apiKeyEnv]?.trim()
    : undefined;
  if (fromEnvironment) return fromEnvironment;
  const fromCommand = commandApiKey(name, definition);
  if (fromCommand) return fromCommand;
  if (definition.apiKey) return definition.apiKey;
  if (!definition.apiKeyEnv) return undefined;
  throw new MissingKeyError(name, definition.apiKeyEnv);
}

function createAdapter(protocol: Protocol, runtime: ProviderRuntime): ModelProvider {
  switch (protocol) {
    case "openai-chat":
      return createOpenAiChat(runtime);
    case "openai-responses":
      return createOpenAiResponses(runtime);
    case "anthropic-messages":
      return createAnthropic(runtime);
    case "gemini":
      return createGemini(runtime);
    default:
      throw new HarnessError("invalid_input", `unknown protocol "${protocol}"`);
  }
}

function createSingleProvider(
  config: HarnessConfig,
  id: string,
): { active: ActiveProvider; definition: ProviderConfig } {
  const definition = providerConfig(config, id);
  let apiKey = resolveApiKey(id, definition);
  const transport = { ...config.transport, ...definition.transport };
  const timeoutMs = definition.transportTimeoutMs ?? transport.timeoutMs;
  const providerFetch = createProviderFetch({
    httpErrors: "response",
    headers: definition.headers,
    ...(definition.proxy ? { proxy: definition.proxy } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(transport.idleTimeoutMs ? { idleTimeoutMs: transport.idleTimeoutMs } : {}),
  });
  const baseRuntime: ProviderRuntime = {
    providerId: id,
    protocol: definition.protocol,
    baseUrl: definition.baseUrl,
    headers: definition.headers,
    fetch: providerFetch,
    ...(apiKey ? { apiKey } : {}),
    config: definition,
    modelConfig: (model) => definition.models[model],
  };

  const adapters = new Map<Protocol, ModelProvider>();
  const adapterFor = (protocol: Protocol): ModelProvider => {
    const cached = adapters.get(protocol);
    if (cached) return cached;
    const adapter = createAdapter(protocol, { ...baseRuntime, protocol });
    adapters.set(protocol, adapter);
    return adapter;
  };

  const provider: ModelProvider = {
    id: definition.protocol,
    model: config.model,
    stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
      const currentKey = resolveApiKey(id, definition);
      if (currentKey !== apiKey) {
        apiKey = currentKey;
        if (currentKey) baseRuntime.apiKey = currentKey;
        else delete baseRuntime.apiKey;
        adapters.clear();
      }
      const model = definition.models[request.model];
      const protocol = model?.protocol ?? definition.protocol;
      const variant = request.variant ? model?.variants?.[request.variant] : undefined;
      const adapted: ModelRequest = {
        ...request,
        apiModel: request.apiModel ?? model?.apiId ?? request.model,
        ...(variant?.reasoning ? { reasoning: variant.reasoning } : {}),
        ...(variant?.temperature === undefined ? {} : { temperature: variant.temperature }),
        ...(variant?.maxOutputTokens === undefined ? {} : { maxTokens: variant.maxOutputTokens }),
        tools: model?.tools === false ? [] : request.tools,
      };
      return adapterFor(protocol).stream(adapted, signal);
    },
  };

  return {
    active: {
      id,
      protocol: definition.protocol,
      model: config.model,
      provider,
    },
    definition,
  };
}

function fallbackModelsOf(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  const raw = (value as Record<string, unknown>).failoverModels;
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function hasFallback(config: HarnessConfig, definition: ProviderConfig): boolean {
  const failover = config.failover;
  if (failover?.enabled === false) return false;
  if ((failover?.providers?.length ?? 0) > 0) return true;
  if (fallbackModelsOf(definition).length > 0) return true;
  return Object.values(definition.models).some((model) => fallbackModelsOf(model).length > 0);
}

export function createProvider(config: HarnessConfig, providerId?: string): ActiveProvider {
  const id = providerId ?? config.provider;
  const { active, definition } = createSingleProvider(config, id);
  if (!hasFallback(config, definition)) return active;

  const resolved = new Map<string, ModelProvider>();
  const resolve = (target: { provider: string; model: string }): ModelProvider => {
    const cached = resolved.get(target.provider);
    if (cached) return cached;
    const provider =
      target.provider === id
        ? active.provider
        : createSingleProvider(config, target.provider).active.provider;
    resolved.set(target.provider, provider);
    return provider;
  };

  const provider = createFailoverProvider({
    primary: { provider: id, model: config.model },
    ...(config.failover === undefined ? {} : { config: config.failover }),
    resolve,
    plan: (primary) =>
      buildFailoverPlan(primary, config.failover, {
        [id]: {
          failoverModels: [
            ...(definition.failoverModels ?? []),
            ...fallbackModelsOf(definition.models[primary.model]),
          ],
        },
      }),
  });

  return { ...active, provider };
}

export function listProviders(config: HarnessConfig): Array<{
  id: string;
  protocol: string;
  baseUrl: string;
  active: boolean;
}> {
  return Object.entries(config.providers).map(([id, definition]) => ({
    id,
    protocol: definition.protocol,
    baseUrl: definition.baseUrl,
    active: id === config.provider,
  }));
}
