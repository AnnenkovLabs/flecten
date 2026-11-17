import { expect, test } from "bun:test";
import type { ProviderGatewayInspection } from "../../shared/provider-protection";
import { ProviderConfigSchema } from "../../src/config/schema";
import { ProviderProtectionDraft } from "../../ui/src/lib/settings/provider-protection.svelte";
import { SettingsStore } from "../../ui/src/lib/settings.svelte";
import { emptyProvider } from "../../ui/src/lib/settings-utils";

const inspection: ProviderGatewayInspection = {
  gateway: "new-api",
  confidence: "confirmed",
  evidence: [{ id: "new-api-version", source: "/api/status", detail: "X-New-Api-Version header" }],
  checkedAt: "2026-11-17T12:00:00.000Z",
};

for (const enabled of [true, false]) {
  test(`custom addition waits for explicit protection decision: ${enabled}`, async () => {
    const host = new SettingsStore();
    host.settings = {
      provider: "working",
      model: "model",
      providers: {
        working: {
          ...emptyProvider("openai-chat", "https://working.test/v1"),
          models: { model: {} },
        },
      },
      maxOutputTokens: 0,
      context: { window: 128000, reserve: 16000 },
      loop: { maxTurns: 0, continuations: 2, parallelTools: true },
      tools: {
        maxOutputBytes: 50000,
        maxOutputLines: 2000,
        bashTimeoutMs: 120000,
        readLimitLines: 2000,
      },
    };
    host.protection = new ProviderProtectionDraft(async () => inspection);
    host.open = true;
    host.addOpen = true;
    host.custom = {
      protocol: "openai-chat",
      baseUrl: "https://relay.test/v1",
      apiKey: "fixture-key",
      checkConnection: false,
    };
    const adding = host.discover();
    await Promise.resolve();
    expect(host.protection.pending?.inspection.gateway).toBe("new-api");
    expect(Object.keys(host.settings.providers)).toEqual(["working"]);
    expect(host.canSave).toBe(false);
    host.close();
    expect(host.open).toBe(true);
    host.protection.decide(enabled);
    await adding;
    expect(host.provider?.protection).toMatchObject({ enabled, inspection });
    expect(host.provider?.apiKey).toBe("fixture-key");
    expect(host.addOpen).toBe(false);
    expect(ProviderConfigSchema.parse(host.provider).protection?.enabled).toBe(enabled);
  });
}

test("a decision is bound to the normalized endpoint and changing it asks again", async () => {
  let inspections = 0;
  const draft = new ProviderProtectionDraft(async () => {
    inspections++;
    return inspection;
  });
  const first = draft.inspect("https://relay.test/v1/");
  await Promise.resolve();
  draft.decide(false);
  const current = await first;
  expect(await draft.inspect("https://relay.test/v1", current)).toEqual(current);
  expect(inspections).toBe(1);
  const changed = draft.inspect("https://other.test/v1", current);
  await Promise.resolve();
  expect(draft.pending?.baseUrl).toBe("https://other.test/v1");
  draft.decide(true);
  expect((await changed)?.enabled).toBe(true);
  expect(inspections).toBe(2);
  expect(
    await new ProviderProtectionDraft(async () => ({
      ...inspection,
      gateway: "unknown",
      confidence: "unknown",
    })).inspect("https://unknown.test/"),
  ).toBeUndefined();
});
