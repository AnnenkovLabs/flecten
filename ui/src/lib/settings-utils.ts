import { t } from "./i18n.svelte";
import type { CatalogSummary, HarnessSettings, ProviderProtocol, ProviderSettings } from "./types";

export interface ProtocolInfo {
  value: ProviderProtocol;
  label: string;
  short: string;
  hint: string;
}

export const PROTOCOLS: ProtocolInfo[] = [
  {
    value: "openai-chat",
    label: "OpenAI Chat Completions",
    short: "OpenAI Chat",
    get hint() {
      return t("Most OpenAI-compatible servers.");
    },
  },
  {
    value: "openai-responses",
    label: "OpenAI Responses",
    short: "OpenAI Responses",
    get hint() {
      return t("Responses API with reasoning and tools.");
    },
  },
  {
    value: "anthropic-messages",
    label: "Anthropic Messages",
    short: "Anthropic",
    get hint() {
      return t("Claude and compatible Messages APIs.");
    },
  },
  {
    value: "gemini",
    label: "Gemini",
    short: "Gemini",
    get hint() {
      return t("Google Gemini via generateContent.");
    },
  },
];

export function protocolInfo(value: string): ProtocolInfo | undefined {
  return PROTOCOLS.find((protocol) => protocol.value === value);
}

export function protocolLabel(value: string): string {
  return protocolInfo(value)?.label ?? value;
}

export function protocolShort(value: string): string {
  return protocolInfo(value)?.short ?? value;
}

export function protocolHint(value: string): string {
  return protocolInfo(value)?.hint ?? t("The provider's API protocol.");
}

export const REASONING_LABELS: Record<string, string> = {
  get none() {
    return t("none");
  },
  get minimal() {
    return t("minimal");
  },
  get low() {
    return t("low");
  },
  get medium() {
    return t("medium");
  },
  get high() {
    return t("high");
  },
  get xhigh() {
    return t("very high");
  },
  get max() {
    return t("maximum");
  },
};

export const ALL_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function emptyProvider(protocol: ProviderProtocol, baseUrl: string): ProviderSettings {
  return {
    protocol,
    baseUrl,
    headers: {},
    models: {},
    reasoningReplay: "auto",
    reasoningDetails: "auto",
    thinking: "auto",
    thinkingParam: "auto",
    thinkingKeep: "auto",
    clearThinking: "auto",
    preserveThinking: "auto",
    promptCaching: true,
    streamUsage: true,
    strictTools: false,
  };
}

/** Four dot-separated groups of digits, like 127.0.0.1. */
function isIPv4(host: string): boolean {
  const parts = host.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => part.length > 0 && [...part].every((char) => char >= "0" && char <= "9"))
  );
}

export function hostName(baseUrl: string): string {
  try {
    const hostname = new URL(baseUrl).hostname;
    const host = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
    if (host === "localhost" || isIPv4(host)) return "Local";
    const labels = host.split(".").filter(Boolean);
    const label = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : "Custom";
  } catch {
    return "Custom";
  }
}

export function cleanSettings(input: HarnessSettings): HarnessSettings {
  const cleaned = clone(input);
  for (const provider of Object.values(cleaned.providers)) {
    if (provider.name === "") delete provider.name;
    if (provider.apiKey === "") delete provider.apiKey;
    if (provider.apiKeyEnv === "") delete provider.apiKeyEnv;
    if (provider.promptCacheKey === "") delete provider.promptCacheKey;
    if (provider.auth && (!provider.auth.command || provider.auth.command.trim() === "")) {
      delete provider.auth;
    }
    if (provider.extraBody && Object.keys(provider.extraBody).length === 0) {
      delete provider.extraBody;
    }
    for (const model of Object.values(provider.models)) {
      if (model.name === "") delete model.name;
      if (model.apiId === "") delete model.apiId;
      if (model.canonicalId === "") delete model.canonicalId;
      if (model.knowledge === "") delete model.knowledge;
      if (model.releaseDate === "") delete model.releaseDate;
      if (model.headers && Object.keys(model.headers).length === 0) delete model.headers;
      if (model.extraBody && Object.keys(model.extraBody).length === 0) delete model.extraBody;
      if (model.variants && Object.keys(model.variants).length === 0) delete model.variants;
      if (model.compat && Object.keys(model.compat).length === 0) delete model.compat;
    }
  }
  return cleaned;
}

export function filterProviders(
  settings: HarnessSettings,
  search: string,
): Array<{ id: string; provider: ProviderSettings; active: boolean }> {
  const query = search.trim().toLowerCase();
  return Object.entries(settings.providers)
    .filter(([id, provider]) => {
      if (!query) return true;
      return (
        id.toLowerCase().includes(query) ||
        (provider.name ?? "").toLowerCase().includes(query) ||
        provider.baseUrl.toLowerCase().includes(query)
      );
    })
    .map(([id, provider]) => ({
      id,
      provider,
      active: settings.provider === id,
    }));
}

export function filterCatalog(catalog: CatalogSummary[], search: string): CatalogSummary[] {
  const query = search.trim().toLowerCase().replaceAll(" ", "");
  return catalog.filter((entry) => {
    if (!query) return true;
    return (
      entry.name.toLowerCase().replaceAll(" ", "").includes(query) ||
      entry.id.toLowerCase().replaceAll(" ", "").includes(query) ||
      entry.baseUrl.toLowerCase().includes(query)
    );
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry !== undefined) result[key] = canonicalize(entry);
    }
    return result;
  }
  return value;
}

export function settingsEqual(
  left: HarnessSettings | null,
  right: HarnessSettings | null,
): boolean {
  if (!left || !right) return left === right;
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function settingsDirty(
  current: HarnessSettings | null,
  snapshot: HarnessSettings | null,
): boolean {
  if (!current) return false;
  if (!snapshot) return true;
  return !settingsEqual(current, snapshot);
}

export type CloseAction = "close" | "confirm";

export function closeAction(dirty: boolean): CloseAction {
  return dirty ? "confirm" : "close";
}

export type SettingsScope = "project" | "global";

export function scopeLabel(scope: SettingsScope): string {
  return scope === "project" ? t("Project") : t("Global");
}

export interface ConfigScope {
  kind: SettingsScope;
  label: string;
  path: string;
}

export function configScope(cwd: string | undefined, explicitPath?: string): ConfigScope {
  const kind: SettingsScope = explicitPath ? "global" : "project";
  let base = cwd ?? "";
  while (base.endsWith("/") || base.endsWith("\\")) base = base.slice(0, -1);
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return {
    kind,
    label: scopeLabel(kind),
    path: explicitPath ?? (base ? `${base}${separator}flecten.config.json` : ""),
  };
}

export type PermissionPolicyName = "deny" | "auto" | "ask" | "allow";

const PERMISSION_FIELDS = [
  { action: "read", field: "read" },
  { action: "write", field: "write" },
  { action: "shell", field: "shell" },
  { action: "network", field: "network" },
  { action: "mcp", field: "mcp" },
  { action: "skill", field: "skill" },
  { action: "external_path", field: "externalPath" },
] as const;

const PERMISSION_DEFAULTS: Omit<NonNullable<HarnessSettings["permissions"]>, "rules"> = {
  read: "auto",
  write: "auto",
  shell: "auto",
  network: "ask",
  mcp: "ask",
  skill: "allow",
  externalPath: "deny",
  destructive: "ask",
  approvalTimeoutMs: 300_000,
};

/** Takes the permission rules the core saved («Всегда» on an approval) into an open form. */
export function adoptRules(
  target: HarnessSettings | null,
  source: HarnessSettings | undefined,
): void {
  const rules = source?.permissions?.rules;
  if (!target || !rules) return;
  target.permissions ??= { ...PERMISSION_DEFAULTS, rules: [] };
  target.permissions.rules = structuredClone(rules);
}

export function permissionPolicies(
  config: HarnessSettings | null,
): Record<string, PermissionPolicyName> {
  const source = config?.permissions;
  const result: Record<string, PermissionPolicyName> = {};
  for (const entry of PERMISSION_FIELDS) {
    result[entry.action] = source?.[entry.field] ?? PERMISSION_DEFAULTS[entry.field];
  }
  return result;
}

export function setPermissionPolicy(
  config: HarnessSettings,
  action: string,
  policy: PermissionPolicyName,
): void {
  const entry = PERMISSION_FIELDS.find((candidate) => candidate.action === action);
  if (!entry) return;
  config.permissions ??= { ...PERMISSION_DEFAULTS, rules: [] };
  config.permissions[entry.field] = policy;
}

export interface SaveGuardInput {
  saving: boolean;
  dirty: boolean;
}

/** Running tasks do not block a save: the core applies new settings to their next run. */
export function saveBlocker(input: SaveGuardInput): string {
  if (input.saving) return t("A save is already in progress.");
  if (!input.dirty) return t("No unsaved changes.");
  return "";
}

export function contextIssue(window: number, reserve: number, maxOutputTokens?: number): string {
  if (!Number.isFinite(window) || !Number.isInteger(window) || window <= 0) {
    return t("The context window must be a whole number greater than zero.");
  }
  if (!Number.isFinite(reserve) || !Number.isInteger(reserve) || reserve < 0) {
    return t("The reserve cannot be negative.");
  }
  if (reserve >= window) return t("The reserve must be smaller than the context window.");
  if (maxOutputTokens !== undefined) {
    if (!Number.isFinite(maxOutputTokens) || !Number.isInteger(maxOutputTokens)) {
      return t("The response limit must be a whole number.");
    }
    if (maxOutputTokens < 0) return t("The response limit cannot be negative.");
    if (maxOutputTokens >= window)
      return t("The response limit must be smaller than the context window.");
  }
  return "";
}

export function diagnosticsPath(cwd: string | undefined): string {
  if (!cwd) return "";
  let base = cwd;
  while (base.endsWith("/") || base.endsWith("\\")) base = base.slice(0, -1);
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base}${separator}.liquid`;
}

export function linesToArray(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
