// Provider secrets: masking for the UI, merging masked values back on save, drafts, redaction.
import type { HarnessConfig, ModelConfig, ProviderConfig } from "../config/schema";
import { ProviderConfigSchema } from "../config/schema";
import { isSecretHeader } from "../providers/transport";
import { redact, redactKnown } from "../util/redact";
import { trimTrailingSlashes } from "../util/text";

export const SECRET_MASK = "[saved]";

function maskValues(values: Record<string, string> | undefined): void {
  if (!values) return;
  for (const key of Object.keys(values)) values[key] = SECRET_MASK;
}

function maskModel(model: ModelConfig): void {
  maskValues(model.headers);
  for (const variant of Object.values(model.variants ?? {})) maskValues(variant.headers);
}

export function sanitize(config: HarnessConfig): HarnessConfig {
  const next = structuredClone(config);
  for (const provider of Object.values(next.providers)) {
    delete provider.apiKey;
    maskValues(provider.headers);
    if (provider.auth) {
      provider.auth.command = SECRET_MASK;
      provider.auth.args = provider.auth.args.map((arg) => redact(arg));
    }
    for (const model of Object.values(provider.models)) maskModel(model);
  }
  for (const server of Object.values(next.mcp.servers)) {
    maskValues(server.env);
    if ("headers" in server) {
      for (const key of Object.keys(server.headers)) server.headers[key] = SECRET_MASK;
    }
  }
  for (const hooks of Object.values(next.hooks)) {
    for (const hook of hooks) {
      maskValues(hook.headers);
      maskValues(hook.env);
    }
  }
  return next;
}

function mergeValues(
  label: string,
  input: Record<string, string> | undefined,
  previous: Record<string, string> | undefined,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value !== SECRET_MASK) {
      merged[key] = value;
      continue;
    }
    const saved = previous?.[key];
    if (saved === undefined) {
      throw new Error(`${label}: cannot keep masked entry "${key}" because it was not saved`);
    }
    merged[key] = saved;
  }
  return merged;
}

function rejectMasked(label: string, input: Record<string, string> | undefined): void {
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === SECRET_MASK) {
      throw new Error(
        `${label}: masked entry "${key}" cannot be used with a different baseUrl or proxy`,
      );
    }
  }
}

function mergeAuth(
  id: string,
  input: ProviderConfig["auth"],
  previous: ProviderConfig["auth"],
  allowMask: boolean,
): ProviderConfig["auth"] {
  if (!input) return undefined;
  if (input.command !== SECRET_MASK) {
    if (input.args.some((arg) => arg.includes("[redacted"))) {
      throw new Error(
        `provider "${id}": re-enter auth command arguments after changing the auth command`,
      );
    }
    return input;
  }
  if (!allowMask || !previous) {
    throw new Error(
      `provider "${id}": cannot keep a masked auth command after changing baseUrl or proxy`,
    );
  }
  return { ...input, command: previous.command, args: [...previous.args] };
}

function mergeModelSecrets(
  label: string,
  input: ModelConfig,
  previous: ModelConfig | undefined,
  allowMask: boolean,
): ModelConfig {
  const next = { ...input };
  if (input.headers) {
    if (!allowMask) rejectMasked(`${label} headers`, input.headers);
    else next.headers = mergeValues(`${label} headers`, input.headers, previous?.headers);
  }
  if (input.variants) {
    next.variants = {};
    for (const [id, variant] of Object.entries(input.variants)) {
      const saved = previous?.variants?.[id];
      if (!variant.headers) {
        next.variants[id] = variant;
        continue;
      }
      if (!allowMask) {
        rejectMasked(`${label} variant "${id}" headers`, variant.headers);
        next.variants[id] = variant;
        continue;
      }
      next.variants[id] = {
        ...variant,
        headers: mergeValues(`${label} variant "${id}" headers`, variant.headers, saved?.headers),
      };
    }
  }
  return next;
}

export function mergeSecrets(
  input: HarnessConfig,
  current: HarnessConfig,
  clear: string[],
): HarnessConfig {
  const providers: Record<string, ProviderConfig> = {};
  for (const [id, provider] of Object.entries(input.providers)) {
    const previous = current.providers[id];
    const allowMask = previous ? sameDestination(provider, previous) : false;
    const clearKey = clear.includes(id);
    let apiKey = clearKey ? undefined : provider.apiKey;
    if (apiKey === SECRET_MASK) {
      if (!allowMask || !previous?.apiKey) {
        throw new Error(
          `provider "${id}": cannot keep a masked apiKey after changing baseUrl or proxy`,
        );
      }
      apiKey = previous.apiKey;
    }
    if (!clearKey && apiKey === undefined && allowMask) apiKey = previous?.apiKey;
    const auth = mergeAuth(id, provider.auth, previous?.auth, allowMask);
    const models: Record<string, ModelConfig> = {};
    for (const [modelId, model] of Object.entries(provider.models)) {
      models[modelId] = mergeModelSecrets(
        `provider "${id}" model "${modelId}"`,
        model,
        previous?.models[modelId],
        allowMask,
      );
    }
    if (!allowMask) rejectMasked(`provider "${id}" headers`, provider.headers);
    const next: ProviderConfig = {
      ...provider,
      headers: allowMask
        ? mergeValues(`provider "${id}" headers`, provider.headers, previous?.headers)
        : provider.headers,
      models,
    };
    delete next.apiKey;
    if (apiKey) next.apiKey = apiKey;
    delete next.auth;
    if (auth) next.auth = auth;
    providers[id] = next;
  }
  const servers: HarnessConfig["mcp"]["servers"] = {};
  for (const [id, server] of Object.entries(input.mcp.servers)) {
    const saved = current.mcp.servers[id];
    const same =
      saved !== undefined &&
      ("url" in server && "url" in saved
        ? server.url === saved.url
        : "command" in server &&
          "command" in saved &&
          server.command === saved.command &&
          JSON.stringify(server.args) === JSON.stringify(saved.args) &&
          server.cwd === saved.cwd);
    if (!same) rejectMasked(`mcp server "${id}" env`, server.env);
    const next = {
      ...server,
      env: mergeValues(`mcp server "${id}" env`, server.env, same ? saved?.env : undefined),
    };
    if ("headers" in next) {
      if (!same) rejectMasked(`mcp server "${id}" headers`, next.headers);
      next.headers = mergeValues(
        `mcp server "${id}" headers`,
        next.headers,
        same && saved && "headers" in saved ? saved.headers : undefined,
      );
    }
    servers[id] = next;
  }
  const hooks = structuredClone(input.hooks);
  for (const [event, entries] of Object.entries(hooks)) {
    const previous = current.hooks[event as keyof typeof hooks];
    for (const [index, hook] of entries.entries()) {
      const saved = previous[index];
      const same =
        hook.type === saved?.type && hook.url === saved?.url && hook.command === saved?.command;
      if (!same) {
        rejectMasked(`hook ${event} headers`, hook.headers);
        rejectMasked(`hook ${event} env`, hook.env);
      }
      hook.headers = mergeValues(
        `hook ${event} headers`,
        hook.headers,
        same ? saved?.headers : undefined,
      );
      hook.env = mergeValues(`hook ${event} env`, hook.env, same ? saved?.env : undefined);
    }
  }
  return { ...input, providers, mcp: { servers }, hooks };
}

function sameBaseUrl(left: string, right: string | undefined): boolean {
  if (!right) return false;
  return trimTrailingSlashes(left.trim()) === trimTrailingSlashes(right.trim());
}

function sameDestination(input: ProviderConfig, previous: ProviderConfig): boolean {
  return (
    sameBaseUrl(input.baseUrl, previous.baseUrl) && (input.proxy ?? "") === (previous.proxy ?? "")
  );
}

export function draftProviderConfig(
  input: unknown,
  current: HarnessConfig,
  providerId?: string,
): ProviderConfig {
  const parsed = ProviderConfigSchema.parse(input);
  const previous = providerId ? current.providers[providerId] : undefined;
  const allowMask = previous ? sameDestination(parsed, previous) : false;
  if (parsed.auth && parsed.auth.command !== SECRET_MASK) {
    throw new Error("provider draft cannot include auth.command; save the provider first");
  }
  if (parsed.auth?.command === SECRET_MASK && (!allowMask || !previous?.auth)) {
    throw new Error("provider draft cannot reuse a masked auth command");
  }
  if (parsed.apiKeyEnv && parsed.apiKeyEnv !== previous?.apiKeyEnv) {
    throw new Error("provider draft cannot change apiKeyEnv; save the provider first");
  }
  let apiKey = parsed.apiKey;
  if (apiKey === SECRET_MASK) {
    if (!allowMask || !previous?.apiKey) {
      throw new Error("provider draft cannot reuse a masked apiKey");
    }
    apiKey = previous.apiKey;
  }
  if (apiKey === undefined && allowMask) apiKey = previous?.apiKey;
  if (!allowMask) rejectMasked("provider draft headers", parsed.headers);
  const headers = allowMask
    ? mergeValues("provider draft headers", parsed.headers, previous?.headers)
    : parsed.headers;
  const auth =
    parsed.auth && previous?.auth
      ? { ...parsed.auth, command: previous.auth.command, args: [...previous.auth.args] }
      : undefined;
  const models: Record<string, ModelConfig> = {};
  for (const [id, model] of Object.entries(parsed.models)) {
    models[id] = mergeModelSecrets(
      `provider draft model "${id}"`,
      model,
      previous?.models[id],
      allowMask,
    );
  }
  const next: ProviderConfig = { ...parsed, headers, models };
  delete next.apiKey;
  if (apiKey) next.apiKey = apiKey;
  delete next.auth;
  if (auth) next.auth = auth;
  return next;
}

function addSecretHeaders(values: Set<string>, headers: Record<string, string> | undefined): void {
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (isSecretHeader(name)) values.add(value);
  }
}

export function providerSecrets(definition: ProviderConfig | undefined): string[] {
  if (!definition) return [];
  const values = new Set<string>();
  if (definition.apiKey) values.add(definition.apiKey);
  addSecretHeaders(values, definition.headers);
  if (definition.auth) {
    values.add(definition.auth.command);
    for (const arg of definition.auth.args) values.add(arg);
  }
  for (const model of Object.values(definition.models)) {
    addSecretHeaders(values, model.headers);
    for (const variant of Object.values(model.variants ?? {})) {
      addSecretHeaders(values, variant.headers);
    }
  }
  return [...values].filter((value) => value.length >= 4);
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  return redactKnown(text, secrets);
}

export function configSecrets(config: HarnessConfig): string[] {
  const values = new Set<string>();
  for (const provider of Object.values(config.providers)) {
    for (const secret of providerSecrets(provider)) values.add(secret);
    if (provider.apiKeyEnv) {
      const value = process.env[provider.apiKeyEnv];
      if (value) values.add(value);
    }
  }
  for (const server of Object.values(config.mcp.servers)) {
    for (const value of Object.values(server.env ?? {})) values.add(value);
    if ("headers" in server) {
      for (const value of Object.values(server.headers)) values.add(value);
    }
  }
  for (const hooks of Object.values(config.hooks)) {
    for (const hook of hooks) {
      for (const value of Object.values(hook.headers ?? {})) values.add(value);
      for (const value of Object.values(hook.env ?? {})) values.add(value);
    }
  }
  return [...values].filter((value) => value.length >= 4);
}

export function redactProviderError(error: unknown, definition?: ProviderConfig): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message, providerSecrets(definition));
}
