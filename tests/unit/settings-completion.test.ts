import { describe, expect, test } from "bun:test";
import { providerView } from "../../src/app/provider-state";
import { defaultConfig } from "../../src/config/defaults";
import { ProviderConfigSchema } from "../../src/config/schema";
import { openAiModel } from "../../src/providers/discovery-models";
import { resolveApiKey } from "../../src/providers/registry";
import { elicitationContent, elicitationFields } from "../../ui/src/lib/settings/elicitation";
import { refreshedDraftModels } from "../../ui/src/lib/settings/provider-draft";
import {
  firstModelIssue,
  modelIssues,
  prepareSettingsForSave,
  settingsIssue,
} from "../../ui/src/lib/settings/validation";
import { clone } from "../../ui/src/lib/settings-utils";
import type { HarnessSettings } from "../../ui/src/lib/types";

describe("remaining settings paths", () => {
  test("refresh adopts catalog data while preserving edited, deleted and added draft models", () => {
    const baseline = {
      kept: { name: "Original", context: 8000 },
      removed: { name: "Remove" },
      local: { name: "Old" },
    };
    const fresh = {
      kept: { name: "Original", context: 64000, tools: true },
      removed: { name: "Remove" },
      added: { name: "New" },
    };
    const draft = {
      kept: { name: "Mine", context: 8000 },
      local: { name: "Edited" },
      custom: { name: "Custom" },
    };
    expect(refreshedDraftModels(fresh, draft, baseline)).toEqual({
      kept: { name: "Mine", context: 64000, tools: true },
      local: { name: "Edited" },
      custom: { name: "Custom" },
      added: { name: "New" },
    });
    expect(fresh.kept.name).toBe("Original");
  });

  test("model validation reports issues without blocking Save for the rest of settings", () => {
    const baseline = defaultConfig() as unknown as HarnessSettings;
    const baselineProvider = baseline.providers[baseline.provider];
    if (!baselineProvider) throw new Error("default provider is missing");
    baselineProvider.models[baseline.model] = { name: "Original", context: 64000, output: 8192 };
    const config = clone(baseline);
    const provider = config.providers[config.provider];
    if (!provider) throw new Error("default provider is missing");

    // Automatic token budget mode without an explicit budget is valid.
    expect(modelIssues({ reasoningMode: "budget" })).toEqual({});
    expect(
      openAiModel({ id: "qwen-3.7-max", reasoning_options: [{ type: "budget_tokens", min: -1 }] }),
    ).not.toHaveProperty("reasoningBudget");

    // Cleared number inputs (null) are treated as empty rather than invalid.
    expect(modelIssues({ context: null as unknown as number })).toEqual({});

    // A broken model surfaces in modelIssues/firstModelIssue, but does not block settingsIssue.
    provider.models[config.model] = { name: "Broken", context: 1000, output: 1001 };
    provider.models["new-broken"] = { name: "New Broken", context: 1000, output: 2000 };
    provider.models["good-model"] = { name: "Good", context: 10000, output: 2000 };
    expect(settingsIssue(config)).toBe("");
    expect(firstModelIssue(config)).toContain("Broken");

    const prepared = prepareSettingsForSave(config, baseline);
    expect(prepared.skippedModels).toHaveLength(2);
    const preparedProvider = prepared.config.providers[config.provider];
    if (!preparedProvider) throw new Error("prepared provider is missing");
    expect(ProviderConfigSchema.safeParse(preparedProvider).success).toBe(true);
    expect(preparedProvider.models[config.model]).toEqual(
      baseline.providers[config.provider]?.models[config.model],
    );
    expect(preparedProvider.models["new-broken"]).toEqual({ name: "New Broken", context: 1000 });
    expect(preparedProvider.models["good-model"]).toEqual({
      name: "Good",
      context: 10000,
      output: 2000,
    });

    expect(
      modelIssues({ output: 1000, reasoningMode: "budget", reasoningBudget: 1001 }).reasoningBudget,
    ).toBeTruthy();
    expect(
      modelIssues({ context: 10000, output: 1000, reasoningMode: "budget", reasoningBudget: 500 }),
    ).toEqual({});
  });

  test("environment key has priority and the renderer sees its exact source without its value", () => {
    const env = "FLECTEN_SETTINGS_TEST_KEY";
    const previous = process.env[env];
    process.env[env] = "environment-secret";
    try {
      const definition = ProviderConfigSchema.parse({
        protocol: "openai-chat",
        baseUrl: "https://example.test",
        apiKeyEnv: env,
        apiKey: "stored-secret",
        auth: { command: "this-command-must-not-run" },
      });
      expect(resolveApiKey("settings-test", definition)).toBe("environment-secret");
      const view = providerView("settings-test", definition, false, "model");
      expect(view.keySource).toBe("env");
      expect(JSON.stringify(view)).not.toContain("environment-secret");
      expect(JSON.stringify(view)).not.toContain("stored-secret");
    } finally {
      if (previous === undefined) delete process.env[env];
      else process.env[env] = previous;
    }
  });

  test("elicitation form preserves typed values and validates required fields and bounds", () => {
    const fields = elicitationFields({
      id: "request",
      server: "docs",
      createdAt: 1,
      mode: "form",
      message: "Choose",
      requestedSchema: {
        type: "object",
        required: ["name", "count", "enabled"],
        properties: {
          name: { type: "string", minLength: 2 },
          count: { type: "integer", minimum: 1, maximum: 3 },
          enabled: { type: "boolean" },
        },
      },
    });
    expect(elicitationContent(fields, { name: "ok", count: 2 })).toEqual({
      content: { name: "ok", count: 2, enabled: false },
    });
    expect(elicitationContent(fields, { name: "ok", count: 10 })).toHaveProperty("error");
    expect(elicitationContent(fields, { count: 2 })).toHaveProperty("error");
  });
});
