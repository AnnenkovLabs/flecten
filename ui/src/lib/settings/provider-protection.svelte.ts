import {
  type ProviderGatewayInspection,
  ProviderGatewayInspectionSchema,
  type ProviderProtection,
} from "../../../../shared/provider-protection";
import { requestAgent } from "../desktop";
import type { AgentEvent, HarnessSettings } from "../types";

type Response = Extract<AgentEvent, { type: "response" }>;

export function providerEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  while (url.pathname.length > 1 && url.pathname.endsWith("/"))
    url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

async function inspectEndpoint(baseUrl: string): Promise<ProviderGatewayInspection> {
  const response = await requestAgent<Response>({ type: "provider.inspect", baseUrl }, 30_000);
  return ProviderGatewayInspectionSchema.parse(response.result);
}

/** The draft cannot advance past a detected gateway until the human chooses a mode. */
export class ProviderProtectionDraft {
  pending = $state<{ baseUrl: string; inspection: ProviderGatewayInspection } | null>(null);
  #resolve: ((enabled: boolean) => void) | undefined;
  #decisions = new Map<string, ProviderProtection | undefined>();

  constructor(private readonly inspectRequest = inspectEndpoint) {}

  async inspect(
    baseUrl: string,
    current?: ProviderProtection,
  ): Promise<ProviderProtection | undefined> {
    const endpoint = providerEndpoint(baseUrl);
    if (current?.checkedBaseUrl === endpoint) return current;
    if (this.#decisions.has(endpoint)) return this.#decisions.get(endpoint) ?? current;
    const inspection = await this.inspectRequest(baseUrl);
    if (inspection.confidence === "unknown") {
      const decision = current ? { ...current, checkedBaseUrl: endpoint, inspection } : undefined;
      this.#decisions.set(endpoint, decision);
      return decision;
    }
    this.pending = { baseUrl: endpoint, inspection };
    const enabled = await new Promise<boolean>((resolve) => {
      this.#resolve = resolve;
    });
    const decision = { enabled, checkedBaseUrl: endpoint, inspection };
    this.#decisions.set(endpoint, decision);
    return decision;
  }

  decide(enabled: boolean): void {
    const resolve = this.#resolve;
    if (!resolve) return;
    this.#resolve = undefined;
    this.pending = null;
    resolve(enabled);
  }
}

export async function inspectChangedProviders(host: {
  settings: HarnessSettings | null;
  baseline: HarnessSettings | null;
  protection: ProviderProtectionDraft;
}): Promise<void> {
  for (const [id, provider] of Object.entries(host.settings?.providers ?? {})) {
    const previous = host.baseline?.providers[id];
    if (previous && providerEndpoint(previous.baseUrl) === providerEndpoint(provider.baseUrl))
      continue;
    let endpoint: string;
    do {
      endpoint = providerEndpoint(provider.baseUrl);
      const protection = await host.protection.inspect(provider.baseUrl, provider.protection);
      if (protection && endpoint === providerEndpoint(provider.baseUrl))
        provider.protection = protection;
    } while (endpoint !== providerEndpoint(provider.baseUrl));
  }
}
