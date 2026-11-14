import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { productEnv } from "../../shared/environment.cjs";
import { HarnessError } from "../errors";
import { atomicWrite } from "../util/atomic";
import { defaultConfig } from "./defaults";
import { migrateConfig } from "./migrate";
import { profilePath, settingsFor } from "./profile";
import { bindProviderCredential, readProviderCredential } from "./provider-credential";
import {
  CONFIG_SCHEMA_VERSION,
  type HarnessConfig,
  HarnessConfigSchema,
  type ProviderConfig,
} from "./schema";
import { loadSecrets, saveSecrets } from "./secrets";

export const CONFIG_FILE = "flecten.config.json";

export function configPath(cwd: string, explicitPath?: string): string {
  return profilePath(explicitPath) ?? projectConfigPath(cwd, explicitPath);
}

function projectConfigPath(cwd: string, explicitPath?: string): string {
  const selected = explicitPath ?? (productEnv("CONFIG")?.trim() || undefined);
  if (selected) return selected;
  const preferred = join(cwd, CONFIG_FILE);
  const legacy = join(cwd, "liquid.config.json");
  return !existsSync(preferred) && existsSync(legacy) ? legacy : preferred;
}

type ConfigIssue = {
  code: string;
  keys?: string[];
  path: readonly PropertyKey[];
  message: string;
};

function describeConfigIssue(issue: ConfigIssue): string {
  if (issue.code === "unrecognized_keys" && issue.keys?.length) {
    return `unknown top-level config key(s) ${issue.keys.map((key) => `"${key}"`).join(", ")}; remove or migrate the config to schemaVersion ${CONFIG_SCHEMA_VERSION}`;
  }
  const path = issue.path.map(String).join(".");
  return path ? `${path} ${issue.message}` : issue.message;
}

function mergeProvider(base: ProviderConfig, override: ProviderConfig): ProviderConfig {
  return {
    ...base,
    ...override,
    headers: { ...base.headers, ...override.headers },
    models: { ...base.models, ...override.models },
  };
}

function mergeProviders(
  base: Record<string, ProviderConfig>,
  override: Record<string, ProviderConfig> | undefined,
): Record<string, ProviderConfig> {
  if (!override) return base;
  const merged: Record<string, ProviderConfig> = { ...base };
  for (const [id, provider] of Object.entries(override)) {
    merged[id] = merged[id] ? mergeProvider(merged[id], provider) : provider;
  }
  return merged;
}

export function inferProvider(model: string): string | undefined {
  const id = model.toLowerCase();
  if (id.startsWith("claude")) return "anthropic";
  if (id.startsWith("gpt") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4")) {
    return "openai";
  }
  if (id.startsWith("gemini")) return "google";
  if (id.startsWith("deepseek")) return "deepseek";
  if (id.startsWith("kimi") || id.startsWith("moonshot")) return "moonshotai";
  if (id.startsWith("glm")) return "zai";
  if (id.startsWith("qwen")) return "alibaba";
  if (id.startsWith("llama") || id.startsWith("whisper")) return "groq";
  return undefined;
}

export async function loadConfig(cwd: string, explicitPath?: string): Promise<HarnessConfig> {
  const profile = profilePath(explicitPath);
  const local = await loadConfigFile(cwd, explicitPath, !profile);
  if (!profile) return local;
  const directory = dirname(profile);
  if (!existsSync(profile)) {
    // Seed once from the existing settings, including destination-bound credentials.
    await saveConfigFile(directory, HarnessConfigSchema.parse(settingsFor(local, "shared")), {
      path: profile,
    });
  }
  const shared = await loadConfigFile(directory, profile);
  return HarnessConfigSchema.parse({ ...local, ...settingsFor(shared, "shared") });
}

async function loadConfigFile(
  cwd: string,
  explicitPath?: string,
  environment = true,
): Promise<HarnessConfig> {
  const defaults = defaultConfig();
  const selectedPath = explicitPath ?? (productEnv("CONFIG")?.trim() || undefined);
  const path = projectConfigPath(cwd, explicitPath);
  const file = Bun.file(path);
  let input: unknown = {};

  const exists = await file.exists();
  if (!exists) {
    if (selectedPath) {
      throw new HarnessError("invalid_input", `config not found: ${path}`);
    }
  } else {
    try {
      input = await file.json();
    } catch (error) {
      throw new HarnessError("invalid_input", `cannot parse ${path}`, { cause: error });
    }
  }

  input = migrateConfig(input);
  const parsed = HarnessConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new HarnessError(
      "invalid_input",
      `invalid ${path}: ${parsed.error.issues.map(describeConfigIssue).join("; ")}`,
    );
  }

  const explicit = parsed.data;
  const envProvider = environment ? productEnv("PROVIDER")?.trim() : undefined;
  const envModel = environment ? productEnv("MODEL")?.trim() : undefined;
  const fileProviderSet =
    typeof input === "object" &&
    input !== null &&
    "provider" in input &&
    typeof input.provider === "string";
  const inferredModelProvider =
    !envProvider && (envModel || !fileProviderSet)
      ? inferProvider(envModel ?? explicit.model)
      : undefined;

  const config: HarnessConfig = {
    ...defaults,
    ...explicit,
    providers: explicit.useDefaults
      ? mergeProviders(defaults.providers, explicit.providers)
      : explicit.providers,
    context: { ...defaults.context, ...explicit.context },
    loop: { ...defaults.loop, ...explicit.loop },
    tools: { ...defaults.tools, ...explicit.tools },
    mcp: { servers: explicit.mcp.servers },
    hooks: explicit.hooks,
    provider: envProvider ?? inferredModelProvider ?? explicit.provider,
    model: envModel ?? explicit.model,
  };

  const secrets = await loadSecrets(cwd, Object.keys(config.providers));
  for (const [id, provider] of Object.entries(config.providers)) {
    const key = readProviderCredential(provider, secrets[id]);
    if (!provider.apiKey && key) provider.apiKey = key;
  }

  if (!config.providers[config.provider]) {
    throw new HarnessError(
      "invalid_input",
      `provider "${config.provider}" is not configured; known: ${Object.keys(config.providers).join(", ")}`,
    );
  }

  return config;
}

export async function saveConfig(
  cwd: string,
  config: HarnessConfig,
  options: { clearSecrets?: string[]; path?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const profile = profilePath(options.path);
  if (!profile) return saveConfigFile(cwd, config, options);
  await saveConfigFile(dirname(profile), HarnessConfigSchema.parse(settingsFor(config, "shared")), {
    ...options,
    path: profile,
  });
  const local = await loadConfigFile(cwd, undefined, false);
  const project = settingsFor(config, "project");
  if (JSON.stringify(settingsFor(local, "project")) !== JSON.stringify(project)) {
    // Keep legacy model settings and credentials intact in the original project file.
    await saveConfigFile(
      cwd,
      { ...local, ...project },
      options.signal ? { signal: options.signal } : {},
    );
  }
  return profile;
}

async function saveConfigFile(
  cwd: string,
  config: HarnessConfig,
  options: { clearSecrets?: string[]; path?: string; signal?: AbortSignal } = {},
): Promise<string> {
  options.signal?.throwIfAborted();
  const path = projectConfigPath(cwd, options.path);
  const parsed = HarnessConfigSchema.parse(config);
  parsed.schemaVersion = CONFIG_SCHEMA_VERSION;
  const secrets = await loadSecrets(cwd, Object.keys(parsed.providers));
  const cleared = new Set(options.clearSecrets ?? []);
  for (const id of cleared) delete secrets[id];
  for (const [id, provider] of Object.entries(parsed.providers)) {
    if (cleared.has(id)) {
      delete provider.apiKey;
      continue;
    }
    if (provider.apiKey) {
      secrets[id] = bindProviderCredential(provider, provider.apiKey);
      delete provider.apiKey;
    }
  }
  await saveSecrets(cwd, secrets, { deletes: [...cleared] });
  // A symlinked config (dotfiles) keeps its link: the target file is replaced, not the link.
  const target = await realpath(path).catch(() => path);
  await atomicWrite(target, `${JSON.stringify(parsed, null, 2)}\n`, 0o600, options.signal);
  return path;
}

export function providerConfig(config: HarnessConfig, name = config.provider): ProviderConfig {
  const provider = config.providers[name];
  if (!provider) {
    throw new HarnessError(
      "invalid_input",
      `provider "${name}" is not configured; known: ${Object.keys(config.providers).join(", ")}`,
    );
  }
  return provider;
}
