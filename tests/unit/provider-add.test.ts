import { expect, test } from "bun:test";
import { ProviderProtectionDraft } from "../../ui/src/lib/settings/provider-protection.svelte";
import { SettingsStore } from "../../ui/src/lib/settings.svelte";
import { clone, emptyProvider } from "../../ui/src/lib/settings-utils";
import type { HarnessSettings } from "../../ui/src/lib/types";

function store(): SettingsStore {
  const host = new SettingsStore();
  host.protection = new ProviderProtectionDraft(async () => ({
    gateway: "unknown",
    confidence: "unknown",
    evidence: [],
    checkedAt: new Date().toISOString(),
  }));
  host.settings = {
    provider: "working",
    model: "working-model",
    providers: {
      working: {
        ...emptyProvider("openai-chat", "https://working.example/v1"),
        models: { "working-model": { tools: true } },
      },
    },
    maxOutputTokens: 0,
    context: { window: 128_000, reserve: 16_000 },
    loop: { maxTurns: 0, continuations: 2, parallelTools: true },
    tools: {
      maxOutputBytes: 50_000,
      maxOutputLines: 2000,
      bashTimeoutMs: 120_000,
      readLimitLines: 2000,
    },
  } satisfies HarnessSettings;
  host.baseline = clone(host.settings);
  host.addOpen = true;
  return host;
}

test("unchecked custom provider joins the savable draft after inspection without automatic model discovery", async () => {
  const host = store();
  expect(host.custom.checkConnection).toBe(true);
  host.custom.checkConnection = false;
  host.custom.baseUrl = "  https://agentrouter.example/v1  ";
  host.custom.apiKey = "fixture-key";
  host.test = async () => {
    throw new Error("Unchecked addition must not test the provider");
  };
  await host.discover();
  expect(host.provider).toMatchObject({
    protocol: "openai-chat",
    baseUrl: "https://agentrouter.example/v1",
    apiKey: "fixture-key",
    models: {},
  });
  expect(host.settings?.provider).toBe("working");
  expect(host.canSave).toBe(true);
  expect(host.error).toBe("");
  expect(host.discoverResult).toBeNull();
  expect(host.addOpen).toBe(false);
  expect(host.custom.checkConnection).toBe(true);
  expect(host.custom.apiKey).toBe("");
});

test("unchecked addition validates URLs and preserves an existing provider's models", async () => {
  const host = store();
  host.custom.checkConnection = false;
  for (const url of ["", "not a URL", "file:///tmp/provider"]) {
    host.custom.baseUrl = url;
    await host.discover();
    expect(host.error).not.toBe("");
    expect(Object.keys(host.settings?.providers ?? {})).toEqual(["working"]);
    expect(host.addOpen).toBe(true);
  }
  host.custom.baseUrl = "https://working.example/v1/";
  host.custom.apiKey = "replacement-fixture-key";
  await host.discover();
  expect(Object.keys(host.settings?.providers ?? {})).toEqual(["working"]);
  expect(host.selected).toBe("working");
  expect(host.provider?.models).toEqual({ "working-model": { tools: true } });
  expect(host.provider?.apiKey).toBe("replacement-fixture-key");
  expect(host.error).toBe("");
});
