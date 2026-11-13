import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../../src/config/defaults";
import { HarnessConfigSchema, ProviderConfigSchema } from "../../src/config/schema";

const base = {
  provider: "primary",
  model: "primary-model",
  providers: {
    primary: { protocol: "openai-chat", baseUrl: "http://127.0.0.1:1/v1" },
  },
};

function withFailover(failover: unknown): unknown {
  return { ...base, failover };
}

function issues(input: unknown): string[] {
  const parsed = HarnessConfigSchema.safeParse(input);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("failover config", () => {
  test("parses an enabled failover with targets and tuning", () => {
    const parsed = HarnessConfigSchema.parse(
      withFailover({
        enabled: true,
        retryBudget: 0,
        cooldownMs: 1_500,
        failureThreshold: 2,
        providers: [{ provider: "backup", model: "backup-model" }],
      }),
    );

    expect(parsed.failover).toEqual({
      enabled: true,
      retryBudget: 0,
      cooldownMs: 1_500,
      failureThreshold: 2,
      providers: [{ provider: "backup", model: "backup-model" }],
    });
  });

  test("parses without failover but ships a disabled default", () => {
    expect(HarnessConfigSchema.parse(base).failover).toBeUndefined();
    expect(defaultConfig().failover).toEqual({
      enabled: false,
      providers: [],
      retryBudget: 2,
      cooldownMs: 30_000,
      failureThreshold: 3,
    });
  });

  test("allows disabling failover with an empty target list", () => {
    const parsed = HarnessConfigSchema.parse(withFailover({ enabled: false, providers: [] }));

    expect(parsed.failover?.enabled).toBe(false);
    expect(parsed.failover?.providers).toEqual([]);
  });

  test("rejects enabled failover without targets", () => {
    expect(issues(withFailover({ enabled: true, providers: [] }))).toContain(
      "failover.providers: enabled failover requires at least one provider/model target",
    );
  });

  test("rejects empty provider and model names", () => {
    expect(
      issues(withFailover({ enabled: true, providers: [{ provider: "", model: "m" }] })),
    ).not.toEqual([]);
    expect(
      issues(withFailover({ enabled: true, providers: [{ provider: "p", model: "" }] })),
    ).not.toEqual([]);
  });

  test("rejects negative or fractional budgets and thresholds", () => {
    const target = [{ provider: "p", model: "m" }];

    expect(issues(withFailover({ enabled: true, retryBudget: -1, providers: target }))).not.toEqual(
      [],
    );
    expect(
      issues(withFailover({ enabled: true, retryBudget: 1.5, providers: target })),
    ).not.toEqual([]);
    expect(issues(withFailover({ enabled: true, cooldownMs: 0, providers: target }))).not.toEqual(
      [],
    );
    expect(
      issues(withFailover({ enabled: true, failureThreshold: 1.5, providers: target })),
    ).not.toEqual([]);
    expect(
      issues(withFailover({ enabled: true, failureThreshold: -2, providers: target })),
    ).not.toEqual([]);
  });

  test("preserves unknown provider names for runtime resolution", () => {
    const parsed = HarnessConfigSchema.parse(
      withFailover({
        enabled: true,
        providers: [{ provider: "not-configured", model: "ghost-model" }],
      }),
    );

    expect(Object.keys(parsed.providers)).toEqual(["primary"]);
    expect(parsed.failover?.providers).toEqual([
      { provider: "not-configured", model: "ghost-model" },
    ]);
  });

  test("parses model-level failover models and rejects empty entries", () => {
    const parsed = ProviderConfigSchema.parse({
      protocol: "openai-chat",
      baseUrl: "http://127.0.0.1:1/v1",
      models: { "primary-model": { failoverModels: ["alt-model"] } },
    });

    expect(parsed.models["primary-model"]?.failoverModels).toEqual(["alt-model"]);
    expect(
      ProviderConfigSchema.safeParse({
        protocol: "openai-chat",
        baseUrl: "http://127.0.0.1:1/v1",
        models: { "primary-model": { failoverModels: [""] } },
      }).success,
    ).toBe(false);
  });
});
