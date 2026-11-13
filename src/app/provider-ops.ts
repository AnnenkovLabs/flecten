import { randomUUID } from "node:crypto";
import type { HarnessConfig, ProviderConfig } from "../config/schema";
import { actualizeModels } from "../providers/actualize";
import { catalogProviders, formatModelName } from "../providers/catalog";
import { discoverProvider, testProvider } from "../providers/discovery";
import { type ProbeResult, probeModel } from "../providers/probe";
import { resolveApiKey } from "../providers/registry";
import { draftProviderConfig, redactProviderError } from "./provider-secrets";
import type { AppInfo, AppService, CatalogSummary } from "./service-types";

const DRAFT_TTL_MS = 5 * 60_000;

export interface ProviderOpsContext {
  cwd: string;
  config(): HarnessConfig;
  /** Saves the config, reloads it from disk and applies it to the running app. */
  commit(next: HarnessConfig): Promise<void>;
  info(): AppInfo;
}

type ProviderOps = Pick<
  AppService,
  "test" | "registerDraft" | "catalogList" | "catalogProvider" | "probeModel" | "actualizeProvider"
> & { clearDrafts(): void };

function verifiedEntry(probe: ProbeResult) {
  return {
    text: probe.text,
    tools: probe.tools,
    ...(probe.reasoning ? { reasoning: true } : {}),
    at: new Date().toISOString(),
  };
}

/** Provider checks, drafts, probes and model refresh: everything that talks to a provider. */
export function providerOps(context: ProviderOpsContext): ProviderOps {
  const drafts = new Map<string, { provider: ProviderConfig; expiresAt: number }>();

  function pruneDrafts(): void {
    const now = Date.now();
    for (const [token, draft] of drafts) {
      if (draft.expiresAt <= now) drafts.delete(token);
    }
  }

  return {
    clearDrafts: () => drafts.clear(),
    async test(input) {
      pruneDrafts();
      const config = context.config();
      let definition: ProviderConfig | undefined;
      if (input.draftToken) {
        definition = drafts.get(input.draftToken)?.provider;
        if (!definition) throw new Error("provider draft token is invalid or expired");
      } else if (input.providerId) {
        definition = config.providers[input.providerId];
        if (!definition) throw new Error(`unknown provider: ${input.providerId}`);
      }
      if (!definition) throw new Error("providerId or draftToken is required");
      const result = await testProvider(
        definition,
        input.model,
        input.providerId ?? input.draftToken,
      );
      return result.ok
        ? result
        : { ...result, message: redactProviderError(result.message, definition) };
    },
    registerDraft(input) {
      pruneDrafts();
      const provider = draftProviderConfig(input.provider, context.config(), input.providerId);
      const draftToken = randomUUID();
      drafts.set(draftToken, { provider, expiresAt: Date.now() + DRAFT_TTL_MS });
      return { draftToken };
    },
    async catalogList(): Promise<CatalogSummary[]> {
      const providers = await catalogProviders(context.cwd);
      return providers.map((entry) => ({
        id: entry.id,
        name: entry.name,
        protocol: entry.protocol,
        baseUrl: entry.baseUrl,
        ...(entry.apiKeyEnv ? { apiKeyEnv: entry.apiKeyEnv } : {}),
        modelCount: Object.keys(entry.models).length,
      }));
    },
    async catalogProvider(id) {
      const providers = await catalogProviders(context.cwd);
      const found = providers.find((entry) => entry.id === id);
      return found ? { ...found, models: found.models } : undefined;
    },
    async probeModel(id, model) {
      const config = structuredClone(context.config());
      const definition = config.providers[id];
      if (!definition) throw new Error(`unknown provider: ${id}`);
      const probed = await probeModel(definition, model);
      const result = probed.error
        ? { ...probed, error: redactProviderError(probed.error, definition) }
        : probed;
      const current = definition.models[model];
      definition.models[model] = {
        ...(current ?? { name: formatModelName(model) }),
        verified: verifiedEntry(result),
      };
      await context.commit(config);
      return { result, info: context.info() };
    },
    async actualizeProvider(id) {
      const config = context.config();
      const current = config.providers[id];
      if (!current) throw new Error(`unknown provider: ${id}`);
      const apiKey = resolveApiKey(id, current);
      const result = await discoverProvider(context.cwd, {
        protocol: current.protocol,
        baseUrl: current.baseUrl,
        ...(apiKey ? { apiKey } : {}),
        headers: current.headers,
      });
      const discovered = result.models;
      const modelIds = Object.keys(discovered);
      if (modelIds.length === 0) {
        throw new Error("Провайдер не вернул ни одной модели; изменения не применены");
      }
      const next = structuredClone(config);
      const definition = next.providers[id];
      if (!definition) throw new Error(`unknown provider: ${id}`);
      const merged = actualizeModels(definition.models, discovered);
      const active = id === next.provider;
      const warnings = [...result.warnings];
      const removed = merged.removed.filter((modelId) => {
        if (!(active && modelId === next.model)) return true;
        const kept = definition.models[modelId];
        if (kept) merged.models[modelId] = kept;
        warnings.push(
          `Активная модель ${modelId} больше не приходит от провайдера. Она оставлена в списке, выберите другую вручную.`,
        );
        return false;
      });
      definition.models = merged.models;
      const probedModel = active ? next.model : (modelIds[0] as string);
      if (active && next.variant && !definition.models[probedModel]?.variants?.[next.variant]) {
        delete next.variant;
      }
      let probe: ProbeResult;
      try {
        probe = await probeModel(definition, probedModel);
      } catch (error) {
        probe = {
          text: false,
          tools: false,
          latencyMs: 0,
          error: redactProviderError(error, definition),
        };
      }
      if (probe.error) probe.error = redactProviderError(probe.error, definition);
      definition.models[probedModel] = {
        ...(definition.models[probedModel] ?? { name: formatModelName(probedModel) }),
        verified: verifiedEntry(probe),
      };
      await context.commit(next);
      return {
        providerId: id,
        info: context.info(),
        models: modelIds.length,
        added: merged.added,
        updated: merged.updated.map((entry) => entry.id),
        removed,
        warnings,
        probedModel,
        probe,
      };
    },
  };
}
