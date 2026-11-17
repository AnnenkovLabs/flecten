import { requestAgent } from "../desktop";
import { modelsCount } from "../format";
import { t } from "../i18n.svelte";
import type { SettingsStore } from "../settings.svelte";
import { clone, emptyProvider, hostName } from "../settings-utils";
import type { AgentEvent, DiscoverResult } from "../types";
import { mergeModels, providerWithBaseUrl, uniqueProviderId } from "./provider-draft";
import { providerEndpoint } from "./provider-protection.svelte";
import { providerIssue } from "./validation";

type Response = Extract<AgentEvent, { type: "response" }>;

/** Adds a custom provider to the draft, with optional API discovery. */
export async function addCustomProvider(host: SettingsStore): Promise<string | undefined> {
  const settings = host.settings;
  if (!settings || host.discovering) return;
  const baseUrl = host.custom.baseUrl.trim();
  const issue = providerIssue(emptyProvider(host.custom.protocol, baseUrl));
  if (issue) {
    host.error = issue;
    return;
  }
  host.discovering = true;
  host.error = "";
  host.discoverResult = null;
  try {
    const apiKey = host.custom.apiKey;
    const existing = providerWithBaseUrl(settings, baseUrl);
    const protection = await host.protection.inspect(
      baseUrl,
      existing ? settings.providers[existing]?.protection : undefined,
    );
    let result: DiscoverResult | undefined;
    if (host.custom.checkConnection) {
      const response = await requestAgent<Response>(
        {
          type: "provider.discover",
          protocol: host.custom.protocol,
          baseUrl,
          ...(apiKey ? { apiKey } : {}),
        },
        90_000,
      );
      result = response.result as DiscoverResult | undefined;
      if (!result) throw new Error("discovery did not return models");
      host.discoverResult = result;
    }
    const url = result?.baseUrl ?? baseUrl;
    if (protection) protection.checkedBaseUrl = providerEndpoint(url);
    const name = result?.providerName || hostName(url);
    const sameUrl = providerWithBaseUrl(settings, url);
    const current = sameUrl ? settings.providers[sameUrl] : undefined;
    if (sameUrl && current) {
      host.notice = result
        ? mergeModels(current, result.models, sameUrl)
        : t("Provider added without checking. Add models manually in the Models tab.");
      if (apiKey) current.apiKey = apiKey;
      if (protection) current.protection = protection;
      return sameUrl;
    }
    const id = uniqueProviderId(settings, result?.providerId ?? name);
    settings.providers[id] = {
      ...emptyProvider(result?.protocol ?? host.custom.protocol, url),
      name,
      ...(protection ? { protection } : {}),
      ...(apiKey ? { apiKey } : {}),
      models: clone(result?.models ?? {}),
      ...(result ? { modelMetadataBaseline: clone(result.models) } : {}),
    };
    host.notice = !result
      ? t("Provider added without checking. Add models manually in the Models tab.")
      : result.warnings.length > 0
        ? t("Added {0}: {1}, {2} without a catalog", [
            name,
            modelsCount(Object.keys(result.models).length),
            result.warnings.length,
          ])
        : t("Added {0}: {1}", [name, modelsCount(Object.keys(result.models).length)]);
    return id;
  } catch (error) {
    host.error = error instanceof Error ? error.message : String(error);
  } finally {
    host.discovering = false;
  }
}
