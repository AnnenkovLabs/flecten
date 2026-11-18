import { isDeepStrictEqual } from "node:util";
import type { HarnessConfig, ModelConfig, ProviderConfig } from "../config/schema";
import { DiagnosticsRuntime } from "../observability/runtime";
import { actualizeModels } from "../providers/actualize";
import { catalogStatus, syncCatalog } from "../providers/catalog";
import { discoverProvider } from "../providers/discovery";
import { resolveApiKey } from "../providers/registry";
import { configSecrets, providerSecrets, redactSecrets } from "./provider-secrets";

const HOUR_MS = 60 * 60 * 1000;

interface RefreshContext {
  cwd: string;
  config(): HarnessConfig;
  commit(next: HarnessConfig | (() => HarnessConfig)): Promise<void>;
  onRefresh?: (() => void) | undefined;
}

function connection(provider: ProviderConfig) {
  const {
    protocol,
    baseUrl,
    proxy,
    headers,
    apiKey,
    apiKeyEnv,
    auth,
    transport,
    transportTimeoutMs,
  } = provider;
  return {
    protocol,
    baseUrl,
    proxy,
    headers,
    apiKey,
    apiKeyEnv,
    auth,
    transport,
    transportTimeoutMs,
  };
}

/** The service owns both timers; hourly refresh reads saved settings and never probes a model. */
export function providerAutoRefresh(context: RefreshContext) {
  const diagnostics = new DiagnosticsRuntime(context.cwd);
  let closed = false;
  let pending: Promise<void> | undefined;
  let catalogPending: Promise<unknown> = Promise.resolve();

  function failure(error: unknown, provider?: ProviderConfig): void {
    diagnostics.record({
      type: "error",
      code: "provider_refresh_failed",
      message: redactSecrets(error instanceof Error ? error.message : String(error), [
        ...configSecrets(context.config()),
        ...providerSecrets(provider),
      ]),
    });
  }

  async function refreshProvider(id: string, started: ProviderConfig): Promise<void> {
    const apiKey = resolveApiKey(id, started);
    const result = await discoverProvider(context.cwd, {
      protocol: started.protocol,
      baseUrl: started.baseUrl,
      headers: started.headers,
      ...(apiKey ? { apiKey } : {}),
      ...(started.proxy ? { proxy: started.proxy } : {}),
      ...(started.transportTimeoutMs ? { transportTimeoutMs: started.transportTimeoutMs } : {}),
    });
    if (Object.keys(result.models).length === 0) {
      throw new Error(`Provider ${id} returned no models; saved models were kept.`);
    }
    if (closed) return;
    let changed = false;
    await context.commit(() => {
      const current = context.config();
      const provider = current.providers[id];
      if (
        closed ||
        !provider?.modelAutoRefresh?.enabled ||
        !isDeepStrictEqual(connection(provider), connection(started))
      )
        return current;
      const next = structuredClone(current);
      const target = next.providers[id] as ProviderConfig;
      const refreshed = actualizeModels(started.models, result.models, {
        ...(started.modelMetadataBaseline ? { baseline: started.modelMetadataBaseline } : {}),
        overwriteManual: target.modelAutoRefresh?.overwriteManual ?? false,
      });
      // A user edit saved while discovery was running takes priority even in overwrite mode.
      target.models = actualizeModels(provider.models, refreshed.models, {
        baseline: started.models,
      }).models;
      const activeModel = provider.models[next.model];
      if (next.provider === id && !target.models[next.model] && activeModel)
        target.models[next.model] = activeModel;
      target.modelMetadataBaseline = { ...provider.modelMetadataBaseline, ...result.models };
      for (const [modelId, incoming] of Object.entries(result.models)) {
        const currentModel: ModelConfig | undefined = provider.models[modelId];
        if (!currentModel) continue;
        const startedModel = started.models[modelId];
        const previous = started.modelMetadataBaseline?.[modelId];
        const snapshot = { ...previous, ...incoming } as Record<string, unknown>;
        for (const key of new Set([
          ...Object.keys(currentModel),
          ...Object.keys(previous ?? {}),
          ...Object.keys(incoming),
        ])) {
          const field = key as keyof typeof currentModel;
          const changedDuringRefresh = !isDeepStrictEqual(
            currentModel[field],
            startedModel?.[field],
          );
          const manual = !isDeepStrictEqual(startedModel?.[field], previous?.[field]);
          const rejected =
            incoming[field] !== undefined &&
            !isDeepStrictEqual(refreshed.models[modelId]?.[field], incoming[field]);
          if (
            !changedDuringRefresh &&
            !rejected &&
            (!manual || target.modelAutoRefresh?.overwriteManual)
          )
            continue;
          // A matching API value must not erase the history of a protected manual edit.
          if (previous?.[field] === undefined) delete snapshot[key];
          else snapshot[key] = previous[field];
        }
        target.modelMetadataBaseline[modelId] = snapshot;
      }
      for (const id of refreshed.removed) {
        if (!target.models[id] && provider.models[id]) delete target.modelMetadataBaseline[id];
      }
      if (
        next.provider === id &&
        next.variant &&
        !target.models[next.model]?.variants?.[next.variant]
      )
        delete next.variant;
      changed = true;
      return next;
    });
    if (changed && !closed) context.onRefresh?.();
  }

  async function run(): Promise<void> {
    const providers = Object.entries(context.config().providers)
      .filter(([, provider]) => provider.modelAutoRefresh?.enabled)
      .map(([id, provider]) => [id, structuredClone(provider)] as const);
    if (providers.length === 0) return;
    await syncCatalog(context.cwd);
    for (const [id, provider] of providers) {
      if (closed) break;
      try {
        await refreshProvider(id, provider);
      } catch (error) {
        failure(error, provider);
      }
    }
  }

  function refresh(): Promise<void> {
    if (closed) return Promise.resolve();
    if (pending) return pending;
    pending = run()
      .catch((error: unknown) => failure(error))
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }

  const providerTimer = setInterval(() => void refresh(), HOUR_MS);
  providerTimer.unref?.();

  const catalog = context.config().catalog;
  const catalogTimer = catalog.autoRefresh
    ? setInterval(
        () => {
          if (!context.config().catalog.autoRefresh) return;
          catalogPending = syncCatalog(context.cwd).catch((error: unknown) => failure(error));
        },
        Math.max(catalog.ttlMs, HOUR_MS),
      )
    : undefined;
  catalogTimer?.unref?.();
  if (catalog.autoRefresh) {
    catalogPending = catalogStatus(context.cwd)
      .then((status) => (status.stale ? syncCatalog(context.cwd) : status))
      .catch((error: unknown) => failure(error));
  }

  return {
    refresh,
    async dispose(): Promise<void> {
      closed = true;
      clearInterval(providerTimer);
      if (catalogTimer) clearInterval(catalogTimer);
      await Promise.all([pending, catalogPending]);
      await diagnostics.flush();
    },
  };
}
