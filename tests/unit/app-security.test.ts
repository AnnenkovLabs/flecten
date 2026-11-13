import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configSecrets,
  draftProviderConfig,
  mergeSecrets,
  redactProviderError,
  redactSecrets,
  SECRET_MASK,
  sanitize,
} from "../../src/app/provider-secrets";
import { describeProviderError, parseProviderTestCommand } from "../../src/app/provider-state";
import { createAppService } from "../../src/app/service";
import { type HarnessConfig, HarnessConfigSchema } from "../../src/config/schema";
import { setSecretBackend } from "../../src/config/secrets";
import { MissingKeyError } from "../../src/errors";

const require = createRequire(import.meta.url);
const { isTrustedSenderUrl, validateAgentCommand, MAX_COMMAND_BYTES } =
  require("../../shell/preload.cjs") as {
    isTrustedSenderUrl(url: string, devOrigin?: string | null): boolean;
    validateAgentCommand(
      command: unknown,
      allowedTypes?: Set<string> | null,
      maxBytes?: number,
    ): string;
    MAX_COMMAND_BYTES: number;
  };

const dirs: string[] = [];
const savedEnv = {
  config: process.env.FLECTEN_CONFIG,
  provider: process.env.FLECTEN_PROVIDER,
  model: process.env.FLECTEN_MODEL,
};

beforeEach(() => {
  setSecretBackend("file");
  delete process.env.FLECTEN_CONFIG;
  delete process.env.FLECTEN_PROVIDER;
  delete process.env.FLECTEN_MODEL;
});

afterEach(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    const name = `FLECTEN_${key.toUpperCase()}`;
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-app-security-"));
  dirs.push(dir);
  return dir;
}

function secretConfig(): HarnessConfig {
  return HarnessConfigSchema.parse({
    useDefaults: false,
    provider: "test",
    model: "test-1",
    providers: {
      test: {
        protocol: "openai-chat",
        baseUrl: "https://example.test/v1",
        apiKey: "sk-test-secret-key",
        headers: {
          Authorization: "Bearer header-secret",
          "X-Trace": "trace-value",
        },
        auth: {
          command: "/bin/echo",
          args: ["--audience", "liquid", "--token=ghp_abcdefghijklmnopqrst"],
        },
        models: {
          "test-1": {
            name: "Test",
            headers: { "X-Model-Key": "sk-model-secret" },
            variants: {
              high: { headers: { Authorization: "Bearer variant-secret" } },
            },
          },
        },
      },
    },
    mcp: {
      servers: {
        docs: {
          command: "bun",
          enabled: false,
          env: { DOCS_TOKEN: "mcp-secret-value" },
        },
        remote: {
          url: "https://mcp.example.test/sse",
          enabled: false,
          headers: { Authorization: "Bearer mcp-header-secret" },
        },
      },
    },
  });
}

describe("settings sanitization", () => {
  test("removes keys, header values, auth commands and MCP env", () => {
    const safe = sanitize(secretConfig());
    const provider = safe.providers.test;
    if (!provider) throw new Error("test provider missing");
    expect(provider.apiKey).toBeUndefined();
    expect(provider.headers.Authorization).toBe(SECRET_MASK);
    expect(provider.headers["X-Trace"]).toBe(SECRET_MASK);
    expect(provider.auth?.command).toBe(SECRET_MASK);
    expect(JSON.stringify(provider.auth?.args)).not.toContain("ghp_abcdefghijklmnopqrst");
    expect(provider.models["test-1"]?.headers?.["X-Model-Key"]).toBe(SECRET_MASK);
    expect(provider.models["test-1"]?.variants?.high?.headers?.Authorization).toBe(SECRET_MASK);
    expect(safe.mcp.servers.docs?.env.DOCS_TOKEN).toBe(SECRET_MASK);
    const remote = safe.mcp.servers.remote;
    expect(remote && "headers" in remote ? remote.headers.Authorization : undefined).toBe(
      SECRET_MASK,
    );

    const text = JSON.stringify(safe);
    expect(text).not.toContain("sk-test-secret-key");
    expect(text).not.toContain("header-secret");
    expect(text).not.toContain("trace-value");
    expect(text).not.toContain("sk-model-secret");
    expect(text).not.toContain("variant-secret");
    expect(text).not.toContain("mcp-secret-value");
    expect(text).not.toContain("mcp-header-secret");
    expect(text).not.toContain("/bin/echo");
  });

  test("restores secrets when masked values are unchanged", () => {
    const original = secretConfig();
    const merged = mergeSecrets(sanitize(original), original, []);
    const provider = merged.providers.test;
    if (!provider) throw new Error("test provider missing");
    expect(provider.apiKey).toBe("sk-test-secret-key");
    expect(provider.headers.Authorization).toBe("Bearer header-secret");
    expect(provider.headers["X-Trace"]).toBe("trace-value");
    expect(provider.auth?.command).toBe("/bin/echo");
    expect(provider.auth?.args).toContain("--token=ghp_abcdefghijklmnopqrst");
    expect(provider.models["test-1"]?.headers?.["X-Model-Key"]).toBe("sk-model-secret");
    expect(provider.models["test-1"]?.variants?.high?.headers?.Authorization).toBe(
      "Bearer variant-secret",
    );
    expect(merged.mcp.servers.docs?.env.DOCS_TOKEN).toBe("mcp-secret-value");
  });

  test("rejects redacted auth args after changing the auth command", () => {
    const original = secretConfig();
    const safe = sanitize(original);
    const provider = safe.providers.test;
    if (!provider?.auth) throw new Error("test auth missing");
    provider.auth.command = "/bin/other";
    expect(() => mergeSecrets(safe, original, [])).toThrow("re-enter auth command arguments");
  });

  test("rejects a mask that has no saved value", () => {
    const original = secretConfig();
    const safe = sanitize(original);
    const provider = safe.providers.test;
    if (!provider) throw new Error("test provider missing");
    safe.providers.ghost = provider;
    expect(() => mergeSecrets(safe, original, [])).toThrow("masked");
  });

  test("does not reuse masked secrets for a new destination", () => {
    const original = secretConfig();
    const safe = sanitize(original);
    const provider = safe.providers.test;
    if (!provider) throw new Error("test provider missing");
    provider.baseUrl = "https://evil.test/v1";
    expect(() => mergeSecrets(safe, original, [])).toThrow("baseUrl or proxy");
  });
});

describe("provider test boundary", () => {
  test("accepts only providerId/model or a draft token", () => {
    expect(
      parseProviderTestCommand({ type: "provider.test", model: "test-1", providerId: "test" }),
    ).toEqual({ model: "test-1", providerId: "test" });
    expect(
      parseProviderTestCommand({ type: "provider.test", model: "test-1", draftToken: "draft" }),
    ).toEqual({ model: "test-1", draftToken: "draft" });
    expect(() => parseProviderTestCommand({ type: "provider.test", model: "test-1" })).toThrow(
      "required",
    );
    expect(() =>
      parseProviderTestCommand({
        type: "provider.test",
        model: "test-1",
        providerId: "test",
        baseUrl: "https://evil.test",
      }),
    ).toThrow('does not accept "baseUrl"');
    expect(() =>
      parseProviderTestCommand({
        type: "provider.test",
        model: "test-1",
        providerId: "test",
        provider: { baseUrl: "https://evil.test" },
      }),
    ).toThrow('does not accept "provider"');
    expect(() =>
      parseProviderTestCommand({
        type: "provider.test",
        model: "test-1",
        providerId: "test",
        auth: { command: "/bin/sh" },
      }),
    ).toThrow('does not accept "auth"');
  });

  test("draft providers cannot inject auth commands or env keys", () => {
    const config = secretConfig();
    expect(() =>
      draftProviderConfig(
        {
          protocol: "openai-chat",
          baseUrl: "https://example.test/v1",
          auth: { command: "/bin/sh" },
        },
        config,
      ),
    ).toThrow("auth.command");
    expect(() =>
      draftProviderConfig(
        {
          protocol: "openai-chat",
          baseUrl: "https://evil.test/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
        config,
      ),
    ).toThrow("apiKeyEnv");
    expect(() =>
      draftProviderConfig(
        {
          protocol: "openai-chat",
          baseUrl: "https://example.test/v1",
          apiKeyEnv: "AWS_SECRET_ACCESS_KEY",
        },
        config,
        "test",
      ),
    ).toThrow("apiKeyEnv");
    expect(() =>
      draftProviderConfig(
        {
          protocol: "openai-chat",
          baseUrl: "https://example.test/v1",
          proxy: "http://127.0.0.1:9999",
          headers: { Authorization: SECRET_MASK },
        },
        config,
        "test",
      ),
    ).toThrow("baseUrl or proxy");
  });

  test("a draft to another destination keeps variants that carry plain headers", () => {
    const draft = draftProviderConfig(
      {
        protocol: "openai-chat",
        baseUrl: "https://other.test/v1",
        models: { "test-1": { variants: { fast: { headers: { "X-Tier": "fast" } } } } },
      },
      secretConfig(),
      "test",
    );
    expect(draft.models["test-1"]?.variants?.fast?.headers).toEqual({ "X-Tier": "fast" });
  });

  test("a missing key is described from the typed error, not from its text", () => {
    const missing = new MissingKeyError("openai", "OPENAI_API_KEY");
    expect(describeProviderError(missing, "openai")).toContain("нужен ключ OPENAI_API_KEY");
    expect(describeProviderError(new Error("model needs FOO_KEY"), "x")).toBe(
      "model needs FOO_KEY",
    );
  });

  test("rejects unknown draft tokens", async () => {
    const dir = await tempDir();
    const service = await createAppService(dir);
    try {
      await expect(service.test({ draftToken: "missing", model: "test-1" })).rejects.toThrow(
        "invalid or expired",
      );
    } finally {
      await service.dispose();
    }
  });
});

describe("settings.get", () => {
  test("returns masked metadata and no secrets", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "flecten.config.json"), JSON.stringify(secretConfig()));
    const service = await createAppService(dir);
    try {
      const payload = service.settings();
      const provider = payload.config.providers.test;
      if (!provider) throw new Error("test provider missing");
      expect(provider.apiKey).toBeUndefined();
      expect(provider.headers.Authorization).toBe(SECRET_MASK);
      expect(provider.auth?.command).toBe(SECRET_MASK);
      expect(payload.config.mcp.servers.docs?.env.DOCS_TOKEN).toBe(SECRET_MASK);
      const remote = payload.config.mcp.servers.remote;
      expect(remote && "headers" in remote ? remote.headers.Authorization : undefined).toBe(
        SECRET_MASK,
      );

      const view = payload.info.providers.find((entry) => entry.id === "test");
      expect(view).toMatchObject({
        apiKeySet: true,
        keySource: "command",
        headersSet: true,
        headersCount: 2,
        authCommandSet: true,
      });
      expect(view && "apiKey" in view).toBe(false);
      expect(view && "headers" in view).toBe(false);
      expect(view && "auth" in view).toBe(false);
      expect(JSON.stringify(payload)).not.toContain("sk-test-secret-key");
      expect(JSON.stringify(payload)).not.toContain("header-secret");
      expect(JSON.stringify(payload)).not.toContain("mcp-secret-value");
      expect(JSON.stringify(payload)).not.toContain("mcp-header-secret");
    } finally {
      await service.dispose();
    }
  });

  test("keeps JSON valid when a saved secret contains quotes", () => {
    const secret = 'ab"cd\\ef';
    const input = JSON.stringify({ output: `prefix ${secret} suffix`, safe: "ok" });
    const output = redactSecrets(input, [secret]);
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.output).not.toContain(secret);
    expect(parsed.safe).toBe("ok");
  });

  test("collects provider and MCP secrets for event redaction", () => {
    const secrets = configSecrets(secretConfig());
    expect(secrets).toContain("sk-test-secret-key");
    expect(secrets.some((value) => value.includes("header-secret"))).toBe(true);
    expect(secrets).toContain("mcp-secret-value");
    expect(secrets.some((value) => value.includes("mcp-header-secret"))).toBe(true);
  });
});

describe("shell sender validation", () => {
  test("accepts only the app frame or the configured dev origin", () => {
    expect(isTrustedSenderUrl("liquid://app/index.html")).toBe(true);
    expect(isTrustedSenderUrl("liquid://app")).toBe(true);
    expect(isTrustedSenderUrl("file:///tmp/index.html")).toBe(false);
    expect(isTrustedSenderUrl("file:///tmp/index.html", "null")).toBe(false);
    expect(isTrustedSenderUrl("https://evil.test/index.html")).toBe(false);
    expect(isTrustedSenderUrl("liquid://other/index.html")).toBe(false);
    expect(isTrustedSenderUrl("not a url")).toBe(false);
    expect(isTrustedSenderUrl("https://dev.test:5173/index.html", "https://dev.test:5173")).toBe(
      true,
    );
    expect(isTrustedSenderUrl("https://other.test/index.html", "https://dev.test:5173")).toBe(
      false,
    );
  });

  test("rejects malformed and oversized commands", () => {
    const types = new Set(["run", "settings.save"]);
    expect(validateAgentCommand({ type: "run", prompt: "hello" }, types)).toBe("");
    expect(validateAgentCommand({ type: "shell", prompt: "x" }, types)).toContain(
      "unknown command",
    );
    expect(validateAgentCommand({ type: "run", prompt: "x", requestId: 5 }, types)).toContain(
      "requestId",
    );
    expect(validateAgentCommand({ type: "run", prompt: "x".repeat(200_001) }, types)).toContain(
      "prompt",
    );
    expect(
      validateAgentCommand(
        { type: "settings.save", config: { padding: "x".repeat(MAX_COMMAND_BYTES) } },
        types,
      ),
    ).toContain("too large");
  });
});

describe("secret redaction", () => {
  test("provider errors never echo keys, headers or auth commands", () => {
    const definition = secretConfig().providers.test;
    const message = redactProviderError(
      new Error("failed sk-test-secret-key with Bearer header-secret via /bin/echo"),
      definition,
    );
    expect(message).not.toContain("sk-test-secret-key");
    expect(message).not.toContain("header-secret");
    expect(message).not.toContain("/bin/echo");
    expect(message).toContain("[redacted]");
  });
});

describe("project trust", () => {
  test("executable project config requires an explicit accept", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, "flecten.config.json"),
      JSON.stringify({
        useDefaults: false,
        provider: "test",
        model: "test-1",
        providers: {
          test: {
            protocol: "openai-chat",
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test-secret-key",
          },
        },
        hooks: { preToolUse: [{ command: "true" }] },
      }),
    );
    const service = await createAppService(dir);
    try {
      expect(service.info().trustRequired).toBe(true);
      expect(service.info().trustAccepted).toBe(false);
      const accepted = await service.acceptTrust();
      expect(accepted.trustAccepted).toBe(true);
    } finally {
      await service.dispose();
    }
  });
});
