import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { HarnessConfig, ModelConfig, ProviderConfig } from "../config/schema";
import type { Usage } from "../core/types";
import { MissingKeyError } from "../errors";
import { findCatalogModel, formatModelName } from "../providers/catalog";
import type { ModelProvider } from "../providers/types";
import type { Skill } from "../skills/schema";
import { redactProviderError } from "./provider-secrets";

export type ProviderKeySource = "command" | "stored" | "env" | "none";

export interface ProviderView {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  apiKeyEnv?: string;
  apiKeySet: boolean;
  keySource: ProviderKeySource;
  headersSet: boolean;
  headersCount: number;
  authCommandSet: boolean;
  models: Record<string, ModelConfig>;
  active: boolean;
}

export function gitBranch(cwd: string): string {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd });
    if (!result.success) return "";
    return result.stdout.toString().trim();
  } catch {
    return "";
  }
}

export function describeProviderError(
  error: unknown,
  provider: string,
  definition?: ProviderConfig,
): string {
  if (error instanceof MissingKeyError) {
    return redactProviderError(
      `Провайдеру "${provider}" нужен ключ ${error.env}. Задайте переменную окружения или введите ключ в настройках.`,
      definition,
    );
  }
  return redactProviderError(error instanceof Error ? error.message : String(error), definition);
}

export function unconfiguredProvider(error: unknown, model: string): ModelProvider {
  const failure = error instanceof Error ? error : new Error(String(error));
  return {
    id: "unconfigured",
    model,
    stream() {
      throw failure;
    },
  };
}

export function modelOf(
  config: HarnessConfig,
  providerId = config.provider,
  model = config.model,
): ModelConfig | undefined {
  return config.providers[providerId]?.models[model];
}

export function contextWindow(config: HarnessConfig): number {
  const model = modelOf(config);
  return model?.context ?? config.context.window;
}

export function maxOutputTokens(config: HarnessConfig): number {
  const provider = config.providers[config.provider];
  const model = modelOf(config);
  const values = [config.maxOutputTokens, model?.output, provider?.maxOutputTokens].filter(
    (value): value is number => typeof value === "number" && value > 0,
  );
  // ponytail: unknown models use 16K until catalog sync or custom model limits provide output.
  const output = values.length > 0 ? Math.min(...values) : 16_384;
  return Math.min(output, Math.max(1, contextWindow(config) - 1));
}

/** Leave room for the actual response instead of a fixed reserve that can overflow. */
export function modelContext(config: HarnessConfig): HarnessConfig["context"] {
  const window = contextWindow(config);
  return {
    ...config.context,
    window,
    reserve: Math.min(window - 1, Math.max(config.context.reserve, maxOutputTokens(config))),
  };
}

export function providerView(
  id: string,
  definition: ProviderConfig,
  active: boolean,
  activeModel: string,
): ProviderView {
  const envValue = definition.apiKeyEnv ? process.env[definition.apiKeyEnv]?.trim() : undefined;
  const authCommandSet = Boolean(definition.auth?.command);
  const keySource: ProviderKeySource = envValue
    ? "env"
    : authCommandSet
      ? "command"
      : definition.apiKey
        ? "stored"
        : "none";
  const models = { ...definition.models };
  if (active && !models[activeModel]) {
    models[activeModel] = { name: formatModelName(activeModel) };
  }
  const headersCount = Object.keys(definition.headers).length;
  return {
    id,
    name: definition.name ?? formatModelName(id),
    protocol: definition.protocol,
    baseUrl: definition.baseUrl,
    ...(definition.apiKeyEnv ? { apiKeyEnv: definition.apiKeyEnv } : {}),
    apiKeySet: keySource !== "none",
    keySource,
    headersSet: headersCount > 0,
    headersCount,
    authCommandSet,
    models,
    active,
  };
}

export interface ProviderTestTarget {
  model: string;
  providerId?: string;
  draftToken?: string;
}

const PROVIDER_TEST_FIELDS = new Set(["type", "requestId", "providerId", "model", "draftToken"]);

export function parseProviderTestCommand(command: Record<string, unknown>): ProviderTestTarget {
  for (const key of Object.keys(command)) {
    if (!PROVIDER_TEST_FIELDS.has(key)) {
      throw new Error(`provider.test does not accept "${key}"; use providerId or draftToken`);
    }
  }
  if (typeof command.model !== "string" || command.model.trim().length === 0) {
    throw new Error("model is required");
  }
  if (command.providerId !== undefined && typeof command.providerId !== "string") {
    throw new Error("providerId must be a string");
  }
  if (command.draftToken !== undefined && typeof command.draftToken !== "string") {
    throw new Error("draftToken must be a string");
  }
  const providerId =
    typeof command.providerId === "string" && command.providerId.length > 0
      ? command.providerId
      : undefined;
  const draftToken =
    typeof command.draftToken === "string" && command.draftToken.length > 0
      ? command.draftToken
      : undefined;
  if (!providerId && !draftToken) throw new Error("providerId or draftToken is required");
  if (providerId && draftToken) throw new Error("use providerId or draftToken, not both");
  return {
    model: command.model,
    ...(providerId ? { providerId } : {}),
    ...(draftToken ? { draftToken } : {}),
  };
}

function isInside(root: string, path: string): boolean {
  const base = resolve(root);
  const target = resolve(path);
  return target === base || target.startsWith(`${base}${sep}`);
}

export function hasExecutableExtensions(
  config: HarnessConfig,
  skills: readonly Skill[],
  cwd: string,
): boolean {
  const hooks = Object.values(config.hooks).some((list) => list.some((hook) => hook.enabled));
  const mcp = Object.values(config.mcp.servers).some((server) => server.enabled);
  const projectSkill = skills.some((skill) => isInside(cwd, skill.location));
  return (
    hooks ||
    mcp ||
    projectSkill ||
    (config.modules?.dirs.length ?? 0) > 0 ||
    existsSync(join(cwd, ".agents", "modules")) ||
    existsSync(join(cwd, ".liquid", "agents"))
  );
}

export function costOf(
  usage: Usage,
  model: ModelConfig | undefined,
  variant?: string,
): number | undefined {
  const cost = (variant ? model?.variants?.[variant]?.cost : undefined) ?? model?.cost;
  if (!cost) return undefined;
  const cached = Math.min(usage.cached, usage.input);
  const cacheWrite = Math.min(usage.cacheWrite ?? 0, Math.max(0, usage.input - cached));
  const input = Math.max(0, usage.input - cached - cacheWrite);
  const cacheRate = cost.cacheRead ?? cost.input;
  const value =
    (input / 1_000_000) * cost.input +
    (cached / 1_000_000) * cacheRate +
    (cacheWrite / 1_000_000) * (cost.cacheWrite ?? cost.input) +
    (usage.output / 1_000_000) * cost.output;
  return value;
}

export async function hydrateActiveModel(config: HarnessConfig, cwd: string): Promise<void> {
  const definition = config.providers[config.provider];
  if (!definition) return;
  const current = definition.models[config.model];
  if (current?.context && current.reasoning !== undefined) return;
  const known = await findCatalogModel(cwd, config.model);
  if (!known) return;
  definition.models[config.model] = { ...known, ...current, name: current?.name ?? known.name };
}
