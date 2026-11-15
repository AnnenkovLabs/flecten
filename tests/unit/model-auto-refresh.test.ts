import { expect, test } from "bun:test";
import { type ModelConfig, ModelConfigSchema } from "../../src/config/schema";
import { actualizeModels } from "../../src/providers/actualize";

test("automatic refresh updates supplied facts while preserving manual fields and clearing", () => {
  const baseline: Record<string, ModelConfig> = {
    model: {
      name: "Model",
      context: 32_000,
      output: 4_000,
      tools: true,
      vision: true,
      source: "api",
    },
  };
  const current: Record<string, ModelConfig> = {
    model: {
      ...baseline.model,
      name: "My model",
      context: 16_000,
      tools: false,
      vision: undefined,
      headers: { "x-tenant": "private" },
      disabled: true,
    },
  };
  const discovered: Record<string, ModelConfig> = {
    model: {
      name: "Renamed model",
      context: 64_000,
      output: 8_000,
      tools: true,
      vision: true,
      reasoning: true,
      structuredOutput: true,
      audio: true,
      pdf: true,
      computerUse: true,
      promptCache: true,
      parallelToolCalls: true,
      interleavedReasoning: true,
      source: "api",
    },
  };

  const result = actualizeModels(current, discovered, { baseline });

  expect(result.models.model).toEqual({
    ...discovered.model,
    name: "My model",
    context: 16_000,
    tools: false,
    vision: undefined,
    headers: { "x-tenant": "private" },
    disabled: true,
  });
  expect(result.updated[0]?.fields).toContain("output");
  expect(result.updated[0]?.fields).not.toContain("context");
  expect(current.model?.output).toBe(4_000);
});

test("automatic refresh preserves manual models and deletions, removes vanished automatic models", () => {
  const baseline: Record<string, ModelConfig> = {
    automatic: { name: "Automatic", tools: true },
    edited: { name: "Edited", tools: true },
    deleted: { name: "Deleted", tools: true },
  };
  const result = actualizeModels(
    {
      automatic: { ...baseline.automatic, verified: { text: true, at: "2026-11-15" } },
      edited: { ...baseline.edited, tools: false },
      manual: { name: "Manual", context: 1234 },
    },
    {
      deleted: { name: "Deleted", tools: true },
      added: { name: "New", tools: true },
    },
    { baseline },
  );

  expect(Object.keys(result.models).sort()).toEqual(["added", "edited", "manual"]);
  expect(result.models.edited?.tools).toBe(false);
  expect(result.removed).toEqual(["automatic"]);
  expect(result.added).toEqual(["added"]);
});

test("first automatic refresh protects existing facts and then tracks new automatic values", () => {
  const firstCatalog: Record<string, ModelConfig> = {
    model: { name: "Model", tools: true, context: 64_000, output: 4_000 },
  };
  const first = actualizeModels(
    { model: { name: "Custom", tools: false, context: 16_000 } },
    firstCatalog,
    {},
  );
  expect(first.models.model).toEqual({
    name: "Custom",
    tools: false,
    context: 16_000,
    output: 4_000,
  });

  const second = actualizeModels(
    first.models,
    { model: { name: "Model", tools: true, context: 128_000, output: 8_000 } },
    { baseline: firstCatalog },
  );
  expect(second.models.model).toEqual({
    name: "Custom",
    tools: false,
    context: 16_000,
    output: 8_000,
  });
});

test("overwrite permission refreshes manual facts and deletions but retains request options", () => {
  const result = actualizeModels(
    {
      model: {
        name: "Custom",
        tools: false,
        apiId: "upstream-model",
        disabled: true,
        headers: { tenant: "private" },
        extraBody: { temperature: 0 },
        variants: { fast: { name: "Fast", temperature: 0.2 } },
      },
      manual: { name: "Manual" },
    },
    {
      model: { name: "Model", tools: true, pdf: true },
      deleted: { name: "Restored" },
    },
    { baseline: { deleted: { name: "Deleted" } }, overwriteManual: true },
  );
  expect(result.models.model).toEqual({
    name: "Model",
    tools: true,
    pdf: true,
    apiId: "upstream-model",
    disabled: true,
    headers: { tenant: "private" },
    extraBody: { temperature: 0 },
    variants: { fast: { name: "Fast", temperature: 0.2 } },
  });
  expect(result.models.deleted).toEqual({ name: "Restored" });
  expect(result.removed).toEqual(["manual"]);
});

test("equivalent structured values stay automatic regardless of object key order", () => {
  const result = actualizeModels(
    { model: { cost: { output: 2, input: 1 }, reasoningLevels: ["low", "high"] } },
    { model: { cost: { input: 3, output: 4 }, reasoningLevels: ["low", "medium", "high"] } },
    {
      baseline: {
        model: { cost: { input: 1, output: 2 }, reasoningLevels: ["low", "high"] },
      },
    },
  );
  expect(result.models.model?.cost).toEqual({ input: 3, output: 4 });
  expect(result.models.model?.reasoningLevels).toEqual(["low", "medium", "high"]);
});

test("protected context and input limits cannot be invalidated by fresh automatic limits", () => {
  const baseline: Record<string, ModelConfig> = {
    reducedContext: { context: 128_000, input: 64_000, output: 4_000 },
    enlargedInput: { context: 128_000, input: 8_000, output: 4_000 },
    newLimits: { context: 128_000 },
  };
  const existing: Record<string, ModelConfig> = {
    reducedContext: { context: 8_000, input: 4_000, output: 4_000 },
    enlargedInput: { context: 128_000, input: 64_000, output: 4_000 },
    newLimits: { context: 8_000 },
  };
  const result = actualizeModels(
    existing,
    {
      reducedContext: { context: 128_000, input: 128_000, output: 65_000, pdf: true },
      enlargedInput: { context: 32_000, input: 16_000, output: 8_000, audio: true },
      newLimits: { context: 128_000, input: 128_000, output: 65_000, tools: true },
    },
    { baseline },
  );

  for (const id of Object.keys(existing)) {
    expect(ModelConfigSchema.safeParse(result.models[id]).success).toBe(true);
    expect(result.models[id]).toMatchObject(existing[id] as ModelConfig);
    expect(result.updated.find((entry) => entry.id === id)?.fields).not.toContain("context");
    expect(result.updated.find((entry) => entry.id === id)?.fields).not.toContain("input");
    expect(result.updated.find((entry) => entry.id === id)?.fields).not.toContain("output");
  }
  expect(result.models.newLimits?.input).toBeUndefined();
  expect(result.models.newLimits?.output).toBeUndefined();
  expect(result.models.reducedContext?.pdf).toBe(true);
  expect(result.models.enlargedInput?.audio).toBe(true);
  expect(result.models.newLimits?.tools).toBe(true);
});
