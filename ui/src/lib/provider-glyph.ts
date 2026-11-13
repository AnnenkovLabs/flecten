import { PROVIDER_LOGO_HOSTS, PROVIDER_LOGO_IDS } from "./provider-logos.generated";

export interface ProviderGlyphData {
  /** Human label for the tooltip. */
  label: string;
  /** Bundled models.dev logo id, when one matches the provider. */
  logo?: string;
  /** Two-letter fallback shown when no logo is bundled. */
  monogram: string;
  /** Stable index into the fallback tile palette in app.css. */
  tone: number;
}

/** Config ids that differ from the models.dev provider id. Exact keys, no matching rules. */
const ALIASES: Readonly<Record<string, string>> = {
  "open-ai": "openai",
  "openai-compatible": "openai",
  "anthropic-messages": "anthropic",
  claude: "anthropic",
  gemini: "google",
  "google-gemini": "google",
  "google-ai": "google",
  "x-ai": "xai",
  grok: "xai",
  fireworks: "fireworks-ai",
  together: "togetherai",
  "together-ai": "togetherai",
  "lm-studio": "lmstudio",
  "azure-openai": "azure",
  bedrock: "amazon-bedrock",
  "aws-bedrock": "amazon-bedrock",
  vertex: "google-vertex",
  "kilo-code": "kilo",
  ollama: "ollama-cloud",
  moonshot: "moonshotai",
  zhipu: "zhipuai",
  copilot: "github-copilot",
};

/** Native API hosts that models.dev does not list as an OpenAI-compatible base URL. */
const NATIVE_HOSTS: Readonly<Record<string, string>> = {
  "api.openai.com": "openai",
  "api.anthropic.com": "anthropic",
  "generativelanguage.googleapis.com": "google",
  "aiplatform.googleapis.com": "google-vertex",
  "openrouter.ai": "openrouter",
  "api.x.ai": "xai",
  "api.mistral.ai": "mistral",
  "api.groq.com": "groq",
  "api.deepseek.com": "deepseek",
  "api.together.xyz": "togetherai",
  "api.fireworks.ai": "fireworks-ai",
  "api.cohere.com": "cohere",
  "api.perplexity.ai": "perplexity",
  "api.cerebras.ai": "cerebras",
  "api.moonshot.ai": "moonshotai",
  "openai.azure.com": "azure",
};

function normalize(id: string): string {
  return id.trim().toLowerCase().split(" ").join("-");
}

function hostOf(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined || baseUrl.trim().length === 0) return undefined;
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function logoForHost(host: string): string | undefined {
  const direct = NATIVE_HOSTS[host] ?? PROVIDER_LOGO_HOSTS[host];
  if (direct !== undefined) return direct;
  // Azure resources live on <resource>.openai.azure.com: compare the registered suffix exactly.
  const parts = host.split(".");
  for (let start = 1; start < parts.length - 1; start += 1) {
    const parent = parts.slice(start).join(".");
    const match = NATIVE_HOSTS[parent];
    if (match !== undefined) return match;
  }
  return undefined;
}

function hash(text: string): number {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 31 + text.charCodeAt(index)) % 6;
  }
  return value;
}

function monogramOf(label: string): string {
  const words = label
    .split(" ")
    .join("-")
    .split("-")
    .filter((word) => word.length > 0);
  const first = words[0] ?? "?";
  const second = words[1];
  const text = second === undefined ? first.slice(0, 2) : `${first[0]}${second[0]}`;
  return text.toUpperCase();
}

export function resolveProviderLogo(id: string, baseUrl?: string | undefined): string | undefined {
  const key = normalize(id);
  const candidate = ALIASES[key] ?? key;
  if (PROVIDER_LOGO_IDS.has(candidate)) return candidate;
  const host = hostOf(baseUrl);
  if (host === undefined) return undefined;
  const fromHost = logoForHost(host);
  return fromHost !== undefined && PROVIDER_LOGO_IDS.has(fromHost) ? fromHost : undefined;
}

export function providerGlyph(
  id: string,
  baseUrl?: string | undefined,
  title?: string | undefined,
): ProviderGlyphData {
  const label = title?.trim() || id.trim() || "Provider";
  const logo = resolveProviderLogo(id, baseUrl);
  return {
    label,
    ...(logo === undefined ? {} : { logo }),
    monogram: monogramOf(label),
    tone: hash(normalize(id) || "provider"),
  };
}

export function providerLogoUrl(logo: string): string {
  return `provider-logos/${encodeURIComponent(logo)}.svg`;
}
